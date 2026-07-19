import { Buffer } from "node:buffer";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { AsyncEventQueue, cancellableAsyncIterator } from "./queue";
import type {
  RealtimeAsrBackend,
  RealtimeAsrEvent,
  RealtimeAsrGapReason,
  RealtimeAsrSession,
  RealtimeAsrSessionOptions,
  RealtimeAsrSpeakerSpan,
  RealtimeAsrWord,
} from "./types";

const PROTOCOL_VERSION = 1;
const FRAME_PCM = 1;
const FRAME_GAP = 2;
const FRAME_END = 3;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_LENGTH = 8_192;
const DEFAULT_STARTUP_TIMEOUT_MS = 600_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;
const EVENT_HIGH_WATER = 256;
const PROCESS_TERMINATION_TIMEOUT_MS = 2_000;
const EVENT_LOW_WATER = 128;

export type MoonshineModelArch =
  | "base"
  | "base-streaming"
  | "medium-streaming"
  | "small-streaming"
  | "tiny"
  | "tiny-streaming";

export interface MoonshineAsrOptions {
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly workerPath?: string | URL;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly language?: string;
  readonly modelArch?: MoonshineModelArch;
  readonly modelPath?: string;
  readonly cacheDir?: string;
  readonly updateIntervalMs?: number;
  readonly wordTimestamps?: boolean;
  readonly speakerDiarization?: boolean;
  readonly startupTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
}

interface MoonshineConfig {
  readonly command: string;
  readonly commandArgs: readonly string[];
  readonly workerPath: string;
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly language: string;
  readonly modelArch: MoonshineModelArch;
  readonly modelPath?: string;
  readonly cacheDir?: string;
  readonly updateIntervalMs: number;
  readonly wordTimestamps: boolean;
  readonly speakerDiarization: boolean;
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
}

interface ExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export function createMoonshineAsrBackend(options: MoonshineAsrOptions = {}): RealtimeAsrBackend {
  const config = normalizeOptions(options);
  return {
    id: "moonshine",
    async open(sessionOptions: RealtimeAsrSessionOptions = {}): Promise<RealtimeAsrSession> {
      if (sessionOptions.signal?.aborted) throw abortError(sessionOptions.signal.reason);
      await access(config.workerPath).catch(() => {
        throw new Error("Moonshine startup failed: sidecar script was not found");
      });
      if (sessionOptions.signal?.aborted) throw abortError(sessionOptions.signal.reason);
      return MoonshineAsrSession.start(config, sessionOptions.signal);
    },
  };
}

class MoonshineAsrSession implements RealtimeAsrSession {
  readonly backend = "moonshine";

  private readonly config: MoonshineConfig;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly events: AsyncEventQueue<RealtimeAsrEvent>;
  private readonly lines: ReadlineInterface;
  private readonly readyPromise: Promise<void>;
  private readonly exitPromise: Promise<ExitResult>;
  private readonly parentSignal: AbortSignal | undefined;
  private readonly parentAbortListener?: () => void;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private resolveExit!: (result: ExitResult) => void;
  private readySettled = false;
  private hasExited = false;
  private sawEnded = false;
  private sequence = 0;
  private stderrTail = "";
  private pendingByte: number | undefined;
  private stdoutPaused = false;
  private writeChain: Promise<void> = Promise.resolve();
  private closePromise?: Promise<void>;
  private state: "closed" | "closing" | "failed" | "open" | "starting" = "starting";

  private constructor(config: MoonshineConfig, parentSignal?: AbortSignal) {
    this.config = config;
    this.parentSignal = parentSignal;
    this.events = new AsyncEventQueue((size) => this.updateOutputBackpressure(size));
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.exitPromise = new Promise<ExitResult>((resolve) => {
      this.resolveExit = resolve;
    });

    this.child = spawn(config.command, workerArguments(config), {
      cwd: config.workingDirectory,
      env: config.environment ? { ...process.env, ...config.environment } : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.lines = createInterface({ input: this.child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => this.captureStderr(chunk));
    this.child.stdin.on("error", () => this.fail(new Error("Moonshine sidecar input failed")));
    this.child.on("error", () => this.handleProcessError());
    this.child.on("close", (code, signal) => this.handleExit({ code, signal }));

    if (parentSignal) {
      this.parentAbortListener = () => {
        void this.abort(parentSignal.reason);
      };
      parentSignal.addEventListener("abort", this.parentAbortListener, { once: true });
      if (parentSignal.aborted) void this.abort(parentSignal.reason);
    }
  }

  static async start(
    config: MoonshineConfig,
    parentSignal?: AbortSignal,
  ): Promise<MoonshineAsrSession> {
    const session = new MoonshineAsrSession(config, parentSignal);
    try {
      await session.waitUntilReady();
      return session;
    } catch (error) {
      await session.abort(error).catch(() => undefined);
      throw error;
    }
  }

  async write(pcm: Uint8Array): Promise<void> {
    this.assertOpen();
    if (pcm.byteLength === 0) return;

    let bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    if (this.pendingByte !== undefined) {
      bytes = Buffer.concat([Buffer.from([this.pendingByte]), bytes]);
      this.pendingByte = undefined;
    }
    if (bytes.byteLength % 2 !== 0) {
      this.pendingByte = bytes[bytes.byteLength - 1];
      bytes = bytes.subarray(0, -1);
    }

    for (let offset = 0; offset < bytes.byteLength; offset += MAX_FRAME_BYTES) {
      await this.scheduleFrame(FRAME_PCM, bytes.subarray(offset, offset + MAX_FRAME_BYTES));
    }
  }

  async markGap(reason: RealtimeAsrGapReason, message?: string): Promise<void> {
    this.assertOpen();
    if (this.pendingByte !== undefined) {
      const error = new RangeError("PCM input must reach a complete 16-bit sample before a gap");
      await this.abort(error);
      throw error;
    }
    const payload = Buffer.from(
      JSON.stringify({
        reason,
        message: message ?? (reason === "source" ? "Audio source reconnected" : "ASR gap"),
      }),
    );
    await this.scheduleFrame(FRAME_GAP, payload);
  }

  close(): Promise<void> {
    this.closePromise ??= this.finishClose();
    return this.closePromise;
  }

  async abort(reason?: unknown): Promise<void> {
    if (this.state === "closed" || this.state === "failed") {
      await this.terminateProcess();
      return;
    }
    if (this.state === "starting" && reason !== undefined) {
      this.rejectStartup(abortError(reason));
    }
    this.state = reason === undefined ? "closed" : "failed";
    this.detachParentSignal();
    this.lines.close();
    this.child.stdin.destroy();
    if (reason === undefined) {
      this.events.close();
    } else {
      this.events.fail(abortError(reason));
    }
    await this.terminateProcess();
  }

  [Symbol.asyncIterator](): AsyncIterator<RealtimeAsrEvent> {
    return cancellableAsyncIterator(this.events[Symbol.asyncIterator](), async (reason) =>
      this.abort(reason),
    );
  }

  private async waitUntilReady(): Promise<void> {
    const timedOut = Promise.withResolvers<never>();
    const timeout = setTimeout(
      () => timedOut.reject(new Error("Moonshine startup timed out")),
      this.config.startupTimeoutMs,
    );
    try {
      await Promise.race([this.readyPromise, timedOut.promise]);
      this.state = "open";
    } finally {
      clearTimeout(timeout);
    }
  }

  private async finishClose(): Promise<void> {
    if (this.state === "closed") return;
    this.assertOpen();
    if (this.pendingByte !== undefined) {
      const error = new RangeError("PCM input must end on a complete 16-bit sample");
      await this.abort(error);
      throw error;
    }

    this.state = "closing";
    try {
      await this.scheduleFrame(FRAME_END, Buffer.alloc(0));
      this.child.stdin.end();
      const result = await this.waitForExit(this.config.shutdownTimeoutMs);
      if (!result || result.code !== 0 || !this.sawEnded) {
        await this.terminateProcess();
        throw new Error("Moonshine shutdown failed");
      }
      this.state = "closed";
      this.detachParentSignal();
      this.events.close();
    } catch (error) {
      this.fail(error);
      throw new Error("Moonshine shutdown failed", { cause: error });
    }
  }

  private scheduleFrame(type: number, payload: Buffer): Promise<void> {
    const operation = this.writeChain.then(() => this.writeFrame(type, payload));
    this.writeChain = operation.catch(() => undefined);
    return operation;
  }

  private async writeFrame(type: number, payload: Buffer): Promise<void> {
    if (payload.byteLength > MAX_FRAME_BYTES) throw new RangeError("Moonshine frame is too large");
    if (this.hasExited) throw new Error("Moonshine sidecar exited before input completed");

    const header = Buffer.allocUnsafe(5);
    header.writeUInt8(type, 0);
    header.writeUInt32LE(payload.byteLength, 1);
    await this.writeChunk(header);
    if (payload.byteLength > 0) await this.writeChunk(payload);
  }

  private writeChunk(chunk: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(chunk, (error) => {
        if (error) {
          reject(new Error("Moonshine sidecar input failed"));
        } else {
          resolve();
        }
      });
    });
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.fail(new Error("Moonshine sidecar returned invalid JSON"));
      return;
    }
    if (!isRecord(message) || typeof message["type"] !== "string") {
      this.fail(new Error("Moonshine sidecar returned an invalid message"));
      return;
    }

    const type = message["type"];
    if (type === "status") return;
    if (type === "ready") {
      if (message["protocolVersion"] !== PROTOCOL_VERSION) {
        this.rejectStartup(new Error("Moonshine sidecar protocol mismatch"));
      } else if (!this.readySettled) {
        this.readySettled = true;
        this.events.push({
          type: "status",
          backend: this.backend,
          sequence: ++this.sequence,
          generation: 0,
          state: "ready",
        });
        this.resolveReady();
      }
      return;
    }
    if (type === "event") {
      try {
        const event = parseWorkerEvent(message["event"], this.backend, ++this.sequence);
        this.events.push(event);
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    if (type === "ended") {
      this.sawEnded = true;
      return;
    }
    if (type === "error") {
      const code = typeof message["code"] === "string" ? message["code"] : "runtime";
      const error =
        code === "missing_dependency"
          ? new Error("Moonshine startup failed: install moonshine-voice for the configured Python")
          : new Error(
              this.readySettled ? "Moonshine transcription failed" : "Moonshine startup failed",
            );
      if (this.readySettled) {
        this.fail(error);
      } else {
        this.rejectStartup(error);
      }
      return;
    }
    this.fail(new Error("Moonshine sidecar returned an unknown message"));
  }

  private captureStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString("utf8")).slice(-MAX_STDERR_LENGTH);
  }

  private handleProcessError(): void {
    const error = new Error(
      this.readySettled
        ? "Moonshine sidecar process failed"
        : "Moonshine startup failed: could not start the configured command",
    );
    if (this.readySettled) {
      this.fail(error);
    } else {
      this.rejectStartup(error);
    }
  }

  private handleExit(result: ExitResult): void {
    if (this.hasExited) return;
    this.hasExited = true;
    this.resolveExit(result);
    this.lines.close();
    if (!this.readySettled) {
      this.rejectStartup(new Error("Moonshine startup failed: sidecar exited before ready"));
      return;
    }
    if (this.state === "closing") {
      if (result.code === 0 && this.sawEnded) {
        this.state = "closed";
        this.events.close();
      }
      return;
    }
    if (this.state === "open") this.fail(new Error("Moonshine sidecar exited unexpectedly"));
  }

  private rejectStartup(error: Error): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.rejectReady(error);
  }

  private fail(error: unknown): void {
    if (this.state === "closed" || this.state === "failed") return;
    this.state = "failed";
    this.detachParentSignal();
    this.events.fail(safeMoonshineError(error));
    void this.terminateProcess();
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new Error("Moonshine ASR session is not open");
  }

  private async terminateProcess(): Promise<void> {
    if (this.hasExited) return;
    if (process.platform === "win32") {
      if (this.child.pid !== undefined) await killWindowsProcessTree(this.child.pid);
    } else {
      signalProcessGroup(this.child, "SIGTERM");
    }
    if (await this.waitForExit(this.config.shutdownTimeoutMs)) return;

    if (process.platform !== "win32") signalProcessGroup(this.child, "SIGKILL");
    this.child.kill("SIGKILL");
    await this.waitForExit(PROCESS_TERMINATION_TIMEOUT_MS);
  }

  private async waitForExit(timeoutMs: number): Promise<ExitResult | undefined> {
    if (this.hasExited) return this.exitPromise;
    const elapsed = Promise.withResolvers<undefined>();
    const timeout = setTimeout(() => elapsed.resolve(undefined), timeoutMs);
    try {
      return await Promise.race([this.exitPromise, elapsed.promise]);
    } finally {
      clearTimeout(timeout);
    }
  }
  private updateOutputBackpressure(size: number): void {
    if (!this.stdoutPaused && size >= EVENT_HIGH_WATER) {
      this.stdoutPaused = true;
      this.child.stdout.pause();
    } else if (this.stdoutPaused && size <= EVENT_LOW_WATER) {
      this.stdoutPaused = false;
      this.child.stdout.resume();
    }
  }

  private detachParentSignal(): void {
    if (this.parentSignal && this.parentAbortListener) {
      this.parentSignal.removeEventListener("abort", this.parentAbortListener);
    }
  }
}

function signalProcessGroup(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (child.pid === undefined) {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    child.kill(signal);
  }
}

function killWindowsProcessTree(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    killer.once("error", finish);
    killer.once("close", finish);
  });
}

function normalizeOptions(options: MoonshineAsrOptions): MoonshineConfig {
  const command = (options.command ?? "python").trim();
  if (!command) throw new Error("Moonshine command must not be empty");
  const language = (options.language ?? "en").trim();
  if (!language) throw new Error("Moonshine language must not be empty");
  if (options.modelPath !== undefined && options.modelPath.trim() === "") {
    throw new Error("Moonshine modelPath must not be empty");
  }
  if (options.modelPath && options.modelArch === undefined) {
    throw new Error("Moonshine modelArch is required with a custom modelPath");
  }

  const workerPath = options.workerPath ?? new URL("./moonshine-worker.py", import.meta.url);
  return {
    command,
    commandArgs: options.commandArgs ? [...options.commandArgs] : [],
    workerPath: workerPath instanceof URL ? fileURLToPath(workerPath) : workerPath,
    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    language,
    modelArch: options.modelArch ?? "medium-streaming",
    ...(options.modelPath ? { modelPath: options.modelPath } : {}),
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    updateIntervalMs: positiveInteger(options.updateIntervalMs ?? 500, "updateIntervalMs"),
    wordTimestamps: options.wordTimestamps ?? true,
    speakerDiarization: options.speakerDiarization ?? false,
    startupTimeoutMs: positiveInteger(
      options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      "startupTimeoutMs",
    ),
    shutdownTimeoutMs: positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      "shutdownTimeoutMs",
    ),
  };
}

function workerArguments(config: MoonshineConfig): string[] {
  return [
    ...config.commandArgs,
    config.workerPath,
    "--protocol-version",
    String(PROTOCOL_VERSION),
    "--language",
    config.language,
    "--model-arch",
    config.modelArch,
    "--update-interval-ms",
    String(config.updateIntervalMs),
    ...(config.modelPath ? ["--model-path", config.modelPath] : []),
    ...(config.cacheDir ? ["--cache-dir", config.cacheDir] : []),
    ...(config.wordTimestamps ? ["--word-timestamps"] : []),
    ...(config.speakerDiarization ? ["--speaker-diarization"] : []),
  ];
}

function parseWorkerEvent(value: unknown, backend: string, sequence: number): RealtimeAsrEvent {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    throw new Error("Moonshine sidecar returned an invalid event");
  }
  const generation = nonnegativeEventInteger(value["generation"], "generation");
  const startMs = nonnegativeEventInteger(value["startMs"], "startMs");
  const durationMs = nonnegativeEventInteger(value["durationMs"], "durationMs");

  if (value["type"] === "gap") {
    const reason = value["reason"];
    if (reason !== "source" && reason !== "backend") {
      throw new Error("Moonshine sidecar returned an invalid gap reason");
    }
    if (typeof value["message"] !== "string" || typeof value["recoverable"] !== "boolean") {
      throw new Error("Moonshine sidecar returned an invalid gap event");
    }
    return {
      type: "gap",
      backend,
      sequence,
      generation,
      startMs,
      durationMs,
      reason,
      message: value["message"],
      recoverable: value["recoverable"],
    };
  }

  if (value["type"] !== "partial" && value["type"] !== "final") {
    throw new Error("Moonshine sidecar returned an invalid transcript event type");
  }
  if (
    typeof value["segmentId"] !== "string" ||
    typeof value["text"] !== "string" ||
    (value["timing"] !== "model" && value["timing"] !== "estimated")
  ) {
    throw new Error("Moonshine sidecar returned an invalid transcript event");
  }
  const revision = positiveEventInteger(value["revision"], "revision");
  const words = parseWords(value["words"]);
  const speakers = parseSpeakers(value["speakers"]);
  const latencyMs = optionalNonnegativeInteger(value["latencyMs"]);
  return {
    type: value["type"],
    backend,
    sequence,
    generation,
    segmentId: value["segmentId"],
    revision,
    text: value["text"],
    timing: value["timing"],
    startMs,
    durationMs,
    ...(words ? { words } : {}),
    ...(speakers ? { speakers } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

function parseWords(value: unknown): readonly RealtimeAsrWord[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Moonshine sidecar returned invalid words");
  const words: RealtimeAsrWord[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["text"] !== "string") {
      throw new Error("Moonshine sidecar returned an invalid word");
    }
    const startMs = nonnegativeEventInteger(entry["startMs"], "word startMs");
    const durationMs = nonnegativeEventInteger(entry["durationMs"], "word durationMs");
    const confidence = optionalNumber(entry["confidence"]);
    words.push({
      text: entry["text"],
      startMs,
      durationMs,
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }
  return words.length > 0 ? words : undefined;
}

function parseSpeakers(value: unknown): readonly RealtimeAsrSpeakerSpan[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Moonshine sidecar returned invalid speakers");
  const speakers: RealtimeAsrSpeakerSpan[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry["speakerId"] !== "string") {
      throw new Error("Moonshine sidecar returned an invalid speaker span");
    }
    const speakerIndex = nonnegativeEventInteger(entry["speakerIndex"], "speaker index");
    const startMs = nonnegativeEventInteger(entry["startMs"], "speaker startMs");
    const durationMs = nonnegativeEventInteger(entry["durationMs"], "speaker durationMs");
    const textStart = optionalNonnegativeInteger(entry["textStart"]);
    const textEnd = optionalNonnegativeInteger(entry["textEnd"]);
    speakers.push({
      speakerId: entry["speakerId"],
      speakerIndex,
      startMs,
      durationMs,
      ...(textStart !== undefined ? { textStart } : {}),
      ...(textEnd !== undefined ? { textEnd } : {}),
    });
  }
  return speakers.length > 0 ? speakers : undefined;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function positiveEventInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Moonshine sidecar returned invalid ${name}`);
  }
  return value;
}

function nonnegativeEventInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Moonshine sidecar returned invalid ${name}`);
  }
  return value;
}

function optionalNonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeMoonshineError(error: unknown): Error {
  if (error instanceof RangeError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  return new Error("Moonshine transcription failed");
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("ASR session aborted");
  error.name = "AbortError";
  return error;
}

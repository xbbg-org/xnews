import { Buffer } from "node:buffer";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { extractYoutubeVideoId, youtubeWatchUrl } from "../sources/youtubetranscript";
import {
  REALTIME_ASR_SAMPLE_RATE,
  type RealtimeAsrBackend,
  type RealtimeAsrEvent,
  type RealtimeAsrSession,
  type RealtimeAsrSessionOptions,
} from "./types";

const DEFAULT_FORMAT = "bestaudio/best";
const DEFAULT_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const MAX_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8_192;
const PROCESS_TERMINATION_TIMEOUT_MS = 2_000;

export interface YoutubeRealtimeTranscriptOptions {
  readonly backend: RealtimeAsrBackend;
  readonly signal?: AbortSignal;
  readonly ytDlpCommand?: string;
  /** Arguments prepended before xnews' generated yt-dlp arguments, e.g. `["yt-dlp"]` for `uvx`. */
  readonly ytDlpArgs?: readonly string[];
  readonly ffmpegCommand?: string;
  /** Arguments prepended before xnews' generated FFmpeg arguments. */
  readonly ffmpegArgs?: readonly string[];
  readonly format?: string;
  readonly reconnectAttempts?: number;
  readonly reconnectDelayMs?: number;
  readonly commandTimeoutMs?: number;
}

interface YoutubePipelineConfig {
  readonly backend: RealtimeAsrBackend;
  readonly signal?: AbortSignal;
  readonly ytDlpCommand: string;
  readonly ytDlpArgs: readonly string[];
  readonly ffmpegCommand: string;
  readonly ffmpegArgs: readonly string[];
  readonly format: string;
  readonly reconnectAttempts: number;
  readonly reconnectDelayMs: number;
  readonly commandTimeoutMs: number;
}

interface YoutubeAudioInfo {
  readonly audioUrl: string;
  readonly isLive: boolean;
}

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

type MediaChild = ChildProcessByStdio<null, Readable, Readable>;

/**
 * Resolves and decodes YouTube audio, then yields realtime ASR events from the
 * explicitly selected backend. Requires caller-installed yt-dlp and FFmpeg.
 */
export async function* transcribeYoutubeRealtime(
  video: string,
  options: YoutubeRealtimeTranscriptOptions,
): AsyncGenerator<RealtimeAsrEvent> {
  const videoId = extractYoutubeVideoId(video);
  if (!videoId) throw new Error("Could not extract a YouTube video ID");
  const config = normalizeOptions(options);
  const controller = new AbortController();
  const parentAbort = (): void => controller.abort(config.signal?.reason);
  config.signal?.addEventListener("abort", parentAbort, { once: true });
  if (config.signal?.aborted) controller.abort(config.signal.reason);

  let session: RealtimeAsrSession | undefined;
  let pump: Promise<void> | undefined;
  let completed = false;
  try {
    await preflightCommands(config, controller.signal);
    const sessionOptions: RealtimeAsrSessionOptions = { signal: controller.signal };
    session = await config.backend.open(sessionOptions);
    pump = pumpYoutubeAudio(videoId, session, config, controller.signal).catch(async (error) => {
      await session?.abort(error).catch(() => undefined);
      throw error;
    });
    void pump.catch(() => undefined);

    for await (const event of session) yield event;
    await pump;
    completed = true;
  } finally {
    config.signal?.removeEventListener("abort", parentAbort);
    if (!completed) {
      await session?.abort().catch(() => undefined);
      controller.abort();
      await pump?.catch(() => undefined);
    }
  }
}

async function pumpYoutubeAudio(
  videoId: string,
  session: RealtimeAsrSession,
  config: YoutubePipelineConfig,
  signal: AbortSignal,
): Promise<void> {
  let info = await resolveYoutubeAudio(videoId, config, signal);
  let reconnects = 0;

  while (true) {
    const result = await decodeYoutubeAudio(info, session, config, signal);
    if (signal.aborted) throw abortError(signal.reason);
    if (!info.isLive) {
      if (result.code === 0) {
        await session.close();
        return;
      }
      await session.close();
      throw new Error(`FFmpeg decode failed with exit code ${result.code ?? "unknown"}`);
    }

    if (reconnects >= config.reconnectAttempts) {
      await session.close();
      throw new Error(`FFmpeg live decode failed after ${config.reconnectAttempts} reconnects`);
    }
    await session.markGap("source", "YouTube live audio source interrupted; reconnecting");
    reconnects += 1;
    await abortableDelay(config.reconnectDelayMs, signal);

    while (true) {
      try {
        info = await resolveYoutubeAudio(videoId, config, signal);
        break;
      } catch (error) {
        if (signal.aborted) throw abortError(signal.reason);
        if (reconnects >= config.reconnectAttempts) throw error;
        reconnects += 1;
        await abortableDelay(config.reconnectDelayMs, signal);
      }
    }
  }
}

async function preflightCommands(
  config: YoutubePipelineConfig,
  signal: AbortSignal,
): Promise<void> {
  await runCommandText(
    config.ytDlpCommand,
    [...config.ytDlpArgs, "--version"],
    "yt-dlp preflight",
    signal,
    config.commandTimeoutMs,
    64 * 1024,
  );
  await runCommandText(
    config.ffmpegCommand,
    [...config.ffmpegArgs, "-version"],
    "FFmpeg preflight",
    signal,
    config.commandTimeoutMs,
    64 * 1024,
  );
}

async function resolveYoutubeAudio(
  videoId: string,
  config: YoutubePipelineConfig,
  signal: AbortSignal,
): Promise<YoutubeAudioInfo> {
  const output = await runCommandText(
    config.ytDlpCommand,
    [
      ...config.ytDlpArgs,
      "--no-playlist",
      "--no-warnings",
      "--no-download",
      "--dump-single-json",
      "--format",
      config.format,
      youtubeWatchUrl(videoId),
    ],
    "yt-dlp resolve",
    signal,
    config.commandTimeoutMs,
    MAX_METADATA_BYTES,
  );

  let metadata: unknown;
  try {
    metadata = JSON.parse(output);
  } catch {
    throw new Error("yt-dlp resolve returned invalid JSON");
  }
  if (!isRecord(metadata)) throw new Error("yt-dlp resolve returned invalid metadata");

  const audioUrl = selectedAudioUrl(metadata);
  if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
    throw new Error("yt-dlp resolve did not return an HTTP audio URL");
  }
  const liveStatus = typeof metadata["live_status"] === "string" ? metadata["live_status"] : "";
  return {
    audioUrl,
    isLive: metadata["is_live"] === true || liveStatus === "is_live",
  };
}

function selectedAudioUrl(metadata: Record<string, unknown>): string | undefined {
  if (typeof metadata["url"] === "string") return metadata["url"];
  for (const field of ["requested_downloads", "requested_formats"] as const) {
    const selected = metadata[field];
    if (!Array.isArray(selected)) continue;
    for (const entry of selected) {
      if (isRecord(entry) && typeof entry["url"] === "string") return entry["url"];
    }
  }
  return undefined;
}

async function decodeYoutubeAudio(
  info: YoutubeAudioInfo,
  session: RealtimeAsrSession,
  config: YoutubePipelineConfig,
  signal: AbortSignal,
): Promise<ProcessResult> {
  const reconnectArguments = info.isLive
    ? []
    : [
        "-reconnect",
        "1",
        "-reconnect_streamed",
        "1",
        "-reconnect_on_network_error",
        "1",
        "-reconnect_on_http_error",
        "4xx,5xx",
      ];
  const child = spawn(
    config.ffmpegCommand,
    [
      ...config.ffmpegArgs,
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "warning",
      ...reconnectArguments,
      "-i",
      info.audioUrl,
      "-vn",
      "-acodec",
      "pcm_s16le",
      "-ac",
      "1",
      "-ar",
      String(REALTIME_ASR_SAMPLE_RATE),
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    },
  );
  const closed = childClosed(child);
  const exit = processExit(child, closed, "FFmpeg decode", signal);
  void exit.catch(() => undefined);
  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-MAX_DIAGNOSTIC_BYTES);
  });

  try {
    for await (const chunk of child.stdout) {
      if (signal.aborted) throw abortError(signal.reason);
      if (chunk instanceof Uint8Array && chunk.byteLength > 0) await session.write(chunk);
    }
    return await exit;
  } catch (error) {
    await terminateChild(child, closed);
    await exit.catch(() => undefined);
    throw error;
  } finally {
    void stderrTail;
  }
}

async function runCommandText(
  command: string,
  arguments_: readonly string[],
  stage: string,
  signal: AbortSignal,
  timeoutMs: number,
  maximumBytes: number,
): Promise<string> {
  if (signal.aborted) throw abortError(signal.reason);
  const child = spawn(command, arguments_, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const closed = childClosed(child);
  const termination = Promise.withResolvers<Error>();
  const stdoutChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let exceeded = false;
  let stderrTail = "";
  let terminationError: Error | undefined;
  const terminate = (error: Error): void => {
    if (terminationError) return;
    terminationError = error;
    termination.resolve(error);
  };
  const abort = (): void => terminate(abortError(signal.reason));
  const timeout = setTimeout(() => terminate(new Error(`${stage} timed out`)), timeoutMs);

  signal.addEventListener("abort", abort, { once: true });
  child.stdout.on("data", (chunk: Buffer) => {
    if (exceeded) return;
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > maximumBytes) {
      exceeded = true;
      terminate(new Error(`${stage} output exceeded ${maximumBytes} bytes`));
      return;
    }
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-MAX_DIAGNOSTIC_BYTES);
  });
  child.on("error", () => terminate(new Error(`${stage} could not start`)));
  if (signal.aborted) abort();

  try {
    const outcome = await Promise.race([
      closed.then((result) => ({ type: "closed" as const, result })),
      termination.promise.then((error) => ({ type: "terminate" as const, error })),
    ]);
    if (outcome.type === "terminate") {
      await terminateChild(child, closed);
      await closed;
      throw outcome.error;
    }
    if (terminationError) throw terminationError;
    if (outcome.result.code !== 0) {
      throw new Error(`${stage} failed with exit code ${outcome.result.code ?? "unknown"}`);
    }
    return Buffer.concat(stdoutChunks, stdoutBytes).toString("utf8");
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    void stderrTail;
  }
}

function processExit(
  child: MediaChild,
  closed: Promise<ProcessResult>,
  stage: string,
  signal: AbortSignal,
): Promise<ProcessResult> {
  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    let terminalError: Error | undefined;
    const finish = (error: Error | undefined, result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    };
    const abort = (): void => {
      terminalError ??= abortError(signal.reason);
      void terminateChild(child, closed).catch(() => undefined);
    };

    signal.addEventListener("abort", abort, { once: true });
    child.on("error", () => {
      terminalError ??= new Error(`${stage} could not start`);
    });
    void closed.then((result) => finish(terminalError, result));
    if (signal.aborted) abort();
  });
}

function childClosed(child: MediaChild): Promise<ProcessResult> {
  const closed = Promise.withResolvers<ProcessResult>();
  child.once("close", (code, signal) => closed.resolve({ code, signal }));
  return closed.promise;
}

async function terminateChild(child: MediaChild, closed: Promise<ProcessResult>): Promise<void> {
  if (
    (child.exitCode !== null || child.signalCode !== null) &&
    (await waitForChildClose(closed, PROCESS_TERMINATION_TIMEOUT_MS))
  ) {
    return;
  }

  if (process.platform === "win32") {
    if (child.pid !== undefined) await killWindowsProcessTree(child.pid);
  } else {
    signalProcessGroup(child, "SIGTERM");
    if (await waitForChildClose(closed, PROCESS_TERMINATION_TIMEOUT_MS)) return;
    signalProcessGroup(child, "SIGKILL");
  }
  if (await waitForChildClose(closed, PROCESS_TERMINATION_TIMEOUT_MS)) return;

  child.kill("SIGKILL");
  if (!(await waitForChildClose(closed, PROCESS_TERMINATION_TIMEOUT_MS))) {
    throw new Error("Media subprocess did not terminate");
  }
}

function signalProcessGroup(child: MediaChild, signal: NodeJS.Signals): void {
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

async function waitForChildClose(
  closed: Promise<ProcessResult>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<boolean>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([closed.then(() => true), elapsed]);
  } finally {
    if (timeout) clearTimeout(timeout);
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

function normalizeOptions(options: YoutubeRealtimeTranscriptOptions): YoutubePipelineConfig {
  if (!options.backend || typeof options.backend.open !== "function") {
    throw new Error("A realtime ASR backend is required");
  }
  const ytDlpCommand = (options.ytDlpCommand ?? "yt-dlp").trim();
  const ffmpegCommand = (options.ffmpegCommand ?? "ffmpeg").trim();
  const format = (options.format ?? DEFAULT_FORMAT).trim();
  if (!ytDlpCommand) throw new Error("ytDlpCommand must not be empty");
  if (!ffmpegCommand) throw new Error("ffmpegCommand must not be empty");
  if (!format) throw new Error("format must not be empty");

  return {
    backend: options.backend,
    ...(options.signal ? { signal: options.signal } : {}),
    ytDlpCommand,
    ytDlpArgs: options.ytDlpArgs ? [...options.ytDlpArgs] : [],
    ffmpegCommand,
    ffmpegArgs: options.ffmpegArgs ? [...options.ffmpegArgs] : [],
    format,
    reconnectAttempts: nonnegativeInteger(
      options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS,
      "reconnectAttempts",
    ),
    reconnectDelayMs: nonnegativeInteger(
      options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
      "reconnectDelayMs",
    ),
    commandTimeoutMs: positiveInteger(
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      "commandTimeoutMs",
    ),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("YouTube transcription aborted");
  error.name = "AbortError";
  return error;
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal.reason);
  const pending = Promise.withResolvers<void>();
  const timeout = setTimeout(pending.resolve, ms);
  const abort = (): void => pending.reject(abortError(signal.reason));
  signal.addEventListener("abort", abort, { once: true });
  try {
    await pending.promise;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

import { Buffer } from "node:buffer";
import type { SourceFetch } from "../types";
import { AsyncEventQueue, cancellableAsyncIterator } from "./queue";
import {
  REALTIME_ASR_BYTES_PER_SAMPLE,
  REALTIME_ASR_CHANNELS,
  REALTIME_ASR_SAMPLE_RATE,
  type RealtimeAsrBackend,
  type RealtimeAsrEvent,
  type RealtimeAsrFinalEvent,
  type RealtimeAsrGapReason,
  type RealtimeAsrSession,
  type RealtimeAsrSessionOptions,
  type RealtimeAsrUsage,
  type RealtimeAsrWord,
} from "./types";

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
const DEFAULT_MODEL = "deepgram/nova-3";
const DEFAULT_WINDOW_MS = 15_000;
const DEFAULT_OVERLAP_MS = 1_500;
const DEFAULT_MAX_PENDING_CHUNKS = 2;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const BYTES_PER_MILLISECOND =
  (REALTIME_ASR_SAMPLE_RATE * REALTIME_ASR_CHANNELS * REALTIME_ASR_BYTES_PER_SAMPLE) / 1_000;
const MAX_DEDUPLICATION_WORDS = 48;
const MAX_BUFFERED_EVENTS = 32;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type OpenRouterFailureMode = "gap" | "throw";
export type OpenRouterResponseFormat = "json" | "verbose_json";
export type OpenRouterTimestampGranularity = "segment" | "word";

export interface OpenRouterAsrOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly language?: string;
  readonly endpoint?: string;
  readonly windowMs?: number;
  readonly overlapMs?: number;
  readonly maxPendingChunks?: number;
  readonly retryCount?: number;
  readonly retryDelayMs?: number;
  readonly timeoutMs?: number;
  readonly failureMode?: OpenRouterFailureMode;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly timestampGranularities?: readonly OpenRouterTimestampGranularity[];
  readonly fetch?: SourceFetch;
}

interface OpenRouterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly language: string;
  readonly endpoint: string;
  readonly windowMs: number;
  readonly overlapMs: number;
  readonly maxPendingChunks: number;
  readonly retryCount: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
  readonly failureMode: OpenRouterFailureMode;
  readonly responseFormat?: OpenRouterResponseFormat;
  readonly timestampGranularities?: readonly OpenRouterTimestampGranularity[];
  readonly fetch: SourceFetch;
}

interface AudioChunk {
  readonly bytes: Buffer;
  readonly startByte: number;
}

type OpenRouterAttemptResponse =
  | {
      readonly ok: true;
      readonly payload: unknown;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly retryAfterMs?: number;
    };

interface ParsedTranscription {
  readonly text: string;
  readonly language?: string;
  readonly words?: readonly ParsedWord[];
  readonly usage?: RealtimeAsrUsage;
}

interface ParsedWord {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly confidence?: number;
}

class HttpStatusError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(status: number, retryAfterMs?: number) {
    super(`OpenRouter transcription failed with HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs;
  }
}

export function createOpenRouterAsrBackend(options: OpenRouterAsrOptions): RealtimeAsrBackend {
  const config = normalizeOptions(options);
  return {
    id: "openrouter",
    open(sessionOptions: RealtimeAsrSessionOptions = {}): Promise<RealtimeAsrSession> {
      if (sessionOptions.signal?.aborted) {
        return Promise.reject(abortError(sessionOptions.signal.reason));
      }
      return Promise.resolve(new OpenRouterAsrSession(config, sessionOptions.signal));
    },
  };
}

class OpenRouterAsrSession implements RealtimeAsrSession {
  readonly backend = "openrouter";

  private readonly config: OpenRouterConfig;
  private readonly events = new AsyncEventQueue<RealtimeAsrEvent>();
  private readonly controller = new AbortController();
  private readonly capacityWaiters: Array<() => void> = [];
  private readonly idleWaiters: Array<() => void> = [];
  private readonly jobs: AudioChunk[] = [];
  private readonly parentSignal: AbortSignal | undefined;
  private readonly parentAbortListener?: () => void;
  private buffer = Buffer.alloc(0);
  private bufferStartByte = 0;
  private totalBytes = 0;
  private coveredUntilByte = 0;
  private generation = 0;
  private sequence = 0;
  private chunkIndex = 0;
  private processing = false;
  private processPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private state: "closed" | "closing" | "failed" | "open" = "open";
  private failure?: Error;
  private previousTokens: readonly string[] = [];

  constructor(config: OpenRouterConfig, parentSignal?: AbortSignal) {
    this.config = config;
    this.parentSignal = parentSignal;
    this.events.push({
      type: "status",
      backend: this.backend,
      sequence: ++this.sequence,
      generation: this.generation,
      state: "ready",
    });
    if (parentSignal) {
      this.parentAbortListener = () => {
        void this.abort(parentSignal.reason);
      };
      parentSignal.addEventListener("abort", this.parentAbortListener, { once: true });
      if (parentSignal.aborted) void this.abort(parentSignal.reason);
    }
  }

  async write(pcm: Uint8Array): Promise<void> {
    this.assertOpen();
    if (pcm.byteLength === 0) return;

    const input = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const windowBytes = this.config.windowMs * BYTES_PER_MILLISECOND;
    const hopBytes = (this.config.windowMs - this.config.overlapMs) * BYTES_PER_MILLISECOND;
    let inputOffset = 0;
    while (inputOffset < input.byteLength) {
      const take = Math.min(windowBytes - this.buffer.byteLength, input.byteLength - inputOffset);
      const incoming = input.subarray(inputOffset, inputOffset + take);
      this.buffer =
        this.buffer.byteLength === 0
          ? Buffer.from(incoming)
          : Buffer.concat([this.buffer, incoming], this.buffer.byteLength + incoming.byteLength);
      this.totalBytes += take;
      inputOffset += take;
      if (this.buffer.byteLength < windowBytes) continue;

      await this.waitForCapacity();
      this.assertOpen();
      const startByte = this.bufferStartByte;
      this.enqueue({ bytes: Buffer.from(this.buffer), startByte });
      this.coveredUntilByte = Math.max(this.coveredUntilByte, startByte + windowBytes);
      this.buffer = Buffer.from(this.buffer.subarray(hopBytes));
      this.bufferStartByte += hopBytes;
    }
  }

  async markGap(reason: RealtimeAsrGapReason, message?: string): Promise<void> {
    this.assertOpen();
    if (this.totalBytes % REALTIME_ASR_BYTES_PER_SAMPLE !== 0) {
      const error = new RangeError("PCM input must reach a complete 16-bit sample before a gap");
      this.fail(error);
      throw error;
    }
    await this.enqueueTail();
    await this.waitForIdle();
    this.throwIfFailed();

    this.events.push({
      type: "gap",
      backend: this.backend,
      sequence: ++this.sequence,
      generation: this.generation,
      startMs: bytesToMilliseconds(this.totalBytes),
      durationMs: 0,
      reason,
      message: message ?? (reason === "source" ? "Audio source reconnected" : "ASR chunk skipped"),
      recoverable: true,
    });
    await this.events.waitForSizeBelow(MAX_BUFFERED_EVENTS);
    this.throwIfFailed();
    this.generation += 1;
    this.previousTokens = [];
    this.resetBufferAtCurrentPosition();
  }

  close(): Promise<void> {
    this.closePromise ??= this.finishClose();
    return this.closePromise;
  }

  async abort(reason?: unknown): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "failed") {
      await this.processPromise?.catch(() => undefined);
      return;
    }
    this.state = reason === undefined ? "closed" : "failed";
    this.controller.abort(reason);
    this.jobs.splice(0);
    this.wakeCapacityWaiters();
    this.wakeIdleWaiters();
    this.detachParentSignal();
    if (reason === undefined) {
      this.events.close();
    } else {
      this.events.fail(abortError(reason));
    }
    await this.processPromise?.catch(() => undefined);
  }

  [Symbol.asyncIterator](): AsyncIterator<RealtimeAsrEvent> {
    return cancellableAsyncIterator(this.events[Symbol.asyncIterator](), async (reason) =>
      this.abort(reason),
    );
  }

  private async finishClose(): Promise<void> {
    if (this.state === "closed") return;
    if (this.state === "failed") {
      this.throwIfFailed();
      return;
    }

    this.state = "closing";
    try {
      if (this.totalBytes % REALTIME_ASR_BYTES_PER_SAMPLE !== 0) {
        throw new RangeError("PCM input must end on a complete 16-bit sample");
      }
      await this.enqueueTail();
      await this.waitForIdle();
      this.throwIfFailed();
      this.state = "closed";
      this.detachParentSignal();
      this.events.close();
    } catch (error) {
      const failure = safeSessionError(error);
      this.fail(failure);
      throw failure;
    }
  }

  private async enqueueTail(): Promise<void> {
    const hasUncoveredAudio =
      this.buffer.byteLength > 0 &&
      (this.coveredUntilByte === 0 || this.totalBytes > this.coveredUntilByte);
    if (!hasUncoveredAudio) return;

    await this.waitForCapacity();
    this.throwIfFailed();
    this.enqueue({ bytes: Buffer.from(this.buffer), startByte: this.bufferStartByte });
    this.coveredUntilByte = this.totalBytes;
    this.buffer = Buffer.alloc(0);
    this.bufferStartByte = this.totalBytes;
  }

  private enqueue(chunk: AudioChunk): void {
    this.jobs.push(chunk);
    if (!this.processing) {
      this.processPromise = this.processJobs();
      void this.processPromise.catch(() => undefined);
    }
  }

  private async processJobs(): Promise<void> {
    this.processing = true;
    try {
      while (this.jobs.length > 0 && !this.controller.signal.aborted) {
        const chunk = this.jobs.shift();
        if (!chunk) break;
        await this.processChunk(chunk);
        this.wakeCapacityWaiters();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.processing = false;
      this.wakeCapacityWaiters();
      this.wakeIdleWaiters();
    }
  }

  private async processChunk(chunk: AudioChunk): Promise<void> {
    let result: ParsedTranscription;
    try {
      result = await this.requestTranscription(chunk.bytes);
    } catch (error) {
      if (this.config.failureMode === "gap" && !this.controller.signal.aborted) {
        this.events.push({
          type: "gap",
          backend: this.backend,
          sequence: ++this.sequence,
          generation: this.generation,
          startMs: bytesToMilliseconds(chunk.startByte),
          durationMs: bytesToMilliseconds(chunk.bytes.byteLength),
          reason: "backend",
          message: "OpenRouter transcription chunk failed",
          recoverable: true,
        });
        await this.events.waitForSizeBelow(MAX_BUFFERED_EVENTS);
        this.throwIfFailed();
        this.generation += 1;
        this.previousTokens = [];
        return;
      }
      throw error;
    }

    const tokens = splitWords(result.text);
    const duplicateWords =
      this.config.overlapMs === 0 ? 0 : matchingBoundaryWords(this.previousTokens, tokens);
    this.previousTokens = tokens;
    if (duplicateWords >= tokens.length) return;

    const remainingTokens = tokens.slice(duplicateWords);
    const text = remainingTokens.join(" ").trim();
    if (!text) return;

    const chunkStartMs = bytesToMilliseconds(chunk.startByte);
    const chunkDurationMs = bytesToMilliseconds(chunk.bytes.byteLength);
    const words = trimResponseWords(result.words, duplicateWords, chunkStartMs);
    const estimatedTrimMs =
      tokens.length === 0 ? 0 : Math.round((duplicateWords / tokens.length) * chunkDurationMs);
    const startMs = words?.[0]?.startMs ?? chunkStartMs + estimatedTrimMs;
    const lastWord = words?.at(-1);
    const endMs = lastWord
      ? lastWord.startMs + lastWord.durationMs
      : chunkStartMs + chunkDurationMs;

    const event: RealtimeAsrFinalEvent = {
      type: "final",
      backend: this.backend,
      sequence: ++this.sequence,
      generation: this.generation,
      segmentId: `openrouter:${this.generation}:${this.chunkIndex++}`,
      revision: 1,
      text,
      timing: words ? "model" : "estimated",
      startMs,
      durationMs: Math.max(0, endMs - startMs),
      ...(words ? { words } : {}),
      ...(result.language ? { language: result.language } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
    };
    this.events.push(event);
    await this.events.waitForSizeBelow(MAX_BUFFERED_EVENTS);
    this.throwIfFailed();
  }

  private async requestTranscription(pcm: Buffer): Promise<ParsedTranscription> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      input_audio: {
        data: encodeWave(pcm).toString("base64"),
        format: "wav",
      },
      language: this.config.language,
      ...(this.config.responseFormat ? { response_format: this.config.responseFormat } : {}),
      ...(this.config.timestampGranularities
        ? { timestamp_granularities: this.config.timestampGranularities }
        : {}),
    };

    let lastStatus: number | undefined;
    for (let attempt = 0; attempt <= this.config.retryCount; attempt += 1) {
      if (this.controller.signal.aborted) throw abortError(this.controller.signal.reason);
      try {
        const response = await this.fetchWithTimeout(JSON.stringify(body));
        if (!response.ok) {
          const statusError = new HttpStatusError(response.status, response.retryAfterMs);
          lastStatus = response.status;
          if (!statusError.retryable || attempt >= this.config.retryCount) throw statusError;
          await abortableDelay(
            statusError.retryAfterMs ?? this.config.retryDelayMs * (attempt + 1),
            this.controller.signal,
          );
          continue;
        }
        return parseTranscription(response.payload);
      } catch (error) {
        if (this.controller.signal.aborted) throw abortError(this.controller.signal.reason);
        if (error instanceof HttpStatusError) throw error;
        if (attempt >= this.config.retryCount) {
          throw new Error(
            lastStatus === undefined
              ? "OpenRouter transcription request failed"
              : `OpenRouter transcription failed with HTTP ${lastStatus}`,
            { cause: error },
          );
        }
        await abortableDelay(this.config.retryDelayMs * (attempt + 1), this.controller.signal);
      }
    }
    throw new Error("OpenRouter transcription request failed");
  }

  private async fetchWithTimeout(body: string): Promise<OpenRouterAttemptResponse> {
    const requestController = new AbortController();
    const abortRequest = (): void => requestController.abort(this.controller.signal.reason);
    this.controller.signal.addEventListener("abort", abortRequest, { once: true });
    const timeout = setTimeout(
      () => requestController.abort(new Error("OpenRouter transcription timed out")),
      this.config.timeoutMs,
    );
    let response: Response | undefined;
    try {
      response = await this.config.fetch(this.config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body,
        signal: requestController.signal,
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        return {
          ok: false,
          status: response.status,
          ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
        };
      }
      return {
        ok: true,
        payload: await readBoundedJson(response, requestController.signal),
      };
    } finally {
      clearTimeout(timeout);
      this.controller.signal.removeEventListener("abort", abortRequest);
      if (requestController.signal.aborted) {
        void response?.body?.cancel(requestController.signal.reason).catch(() => undefined);
      }
    }
  }

  private async waitForCapacity(): Promise<void> {
    while (this.pendingCount() >= this.config.maxPendingChunks) {
      await new Promise<void>((resolve) => this.capacityWaiters.push(resolve));
      this.throwIfFailed();
      if (this.controller.signal.aborted) throw abortError(this.controller.signal.reason);
    }
  }

  private async waitForIdle(): Promise<void> {
    while (this.processing || this.jobs.length > 0) {
      await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
      this.throwIfFailed();
    }
  }

  private pendingCount(): number {
    return this.jobs.length + (this.processing ? 1 : 0);
  }

  private wakeCapacityWaiters(): void {
    if (this.pendingCount() >= this.config.maxPendingChunks) return;
    for (const resolve of this.capacityWaiters.splice(0)) resolve();
  }

  private wakeIdleWaiters(): void {
    if (this.processing || this.jobs.length > 0) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private resetBufferAtCurrentPosition(): void {
    this.buffer = Buffer.alloc(0);
    this.bufferStartByte = this.totalBytes;
    this.coveredUntilByte = this.totalBytes;
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new Error("OpenRouter ASR session is not open");
    this.throwIfFailed();
  }

  private throwIfFailed(): void {
    if (this.failure) throw this.failure;
  }

  private fail(error: unknown): void {
    if (this.state === "closed" || this.state === "failed") return;
    this.failure = safeSessionError(error);
    this.state = "failed";
    this.controller.abort(this.failure);
    this.jobs.splice(0);
    this.wakeCapacityWaiters();
    this.wakeIdleWaiters();
    this.detachParentSignal();
    this.events.fail(this.failure);
  }

  private detachParentSignal(): void {
    if (this.parentSignal && this.parentAbortListener) {
      this.parentSignal.removeEventListener("abort", this.parentAbortListener);
    }
  }
}

function normalizeOptions(options: OpenRouterAsrOptions): OpenRouterConfig {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("OpenRouter API key is required");

  const model = (options.model ?? DEFAULT_MODEL).trim();
  if (!model) throw new Error("OpenRouter model must not be empty");
  const language = (options.language ?? "en").trim();
  if (!language) throw new Error("OpenRouter language must not be empty");
  const endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).trim();
  let endpointUrl: URL;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    throw new Error("OpenRouter endpoint must be a valid URL");
  }
  if (
    endpointUrl.protocol !== "https:" ||
    endpointUrl.origin !== "https://openrouter.ai" ||
    endpointUrl.username ||
    endpointUrl.password
  ) {
    throw new Error("OpenRouter endpoint must use the https://openrouter.ai origin");
  }
  const normalizedEndpoint = endpointUrl.toString();

  const windowMs = positiveInteger(options.windowMs ?? DEFAULT_WINDOW_MS, "windowMs");
  const overlapMs = nonnegativeInteger(options.overlapMs ?? DEFAULT_OVERLAP_MS, "overlapMs");
  if (overlapMs >= windowMs) throw new RangeError("overlapMs must be smaller than windowMs");
  const responseFormat = options.responseFormat;
  if (
    responseFormat !== undefined &&
    responseFormat !== "json" &&
    responseFormat !== "verbose_json"
  ) {
    throw new Error('OpenRouter responseFormat must be "json" or "verbose_json"');
  }
  const timestampGranularities = options.timestampGranularities;
  if (
    timestampGranularities?.some(
      (granularity) => granularity !== "segment" && granularity !== "word",
    )
  ) {
    throw new Error('OpenRouter timestamp granularity must be "segment" or "word"');
  }
  if (timestampGranularities && responseFormat !== "verbose_json") {
    throw new Error('OpenRouter timestampGranularities require responseFormat "verbose_json"');
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new Error("No fetch implementation is available");

  return {
    apiKey,
    model,
    language,
    endpoint: normalizedEndpoint,
    windowMs,
    overlapMs,
    maxPendingChunks: positiveInteger(
      options.maxPendingChunks ?? DEFAULT_MAX_PENDING_CHUNKS,
      "maxPendingChunks",
    ),
    retryCount: nonnegativeInteger(options.retryCount ?? DEFAULT_RETRY_COUNT, "retryCount"),
    retryDelayMs: nonnegativeInteger(
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      "retryDelayMs",
    ),
    timeoutMs: positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs"),
    failureMode: options.failureMode ?? "throw",
    ...(responseFormat ? { responseFormat } : {}),
    ...(timestampGranularities ? { timestampGranularities: [...timestampGranularities] } : {}),
    fetch: fetchImplementation,
  };
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`OpenRouter transcription response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("OpenRouter transcription returned an empty response");

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await readBodyChunk(reader, signal);
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error(`OpenRouter transcription response exceeded ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(Buffer.from(result.value));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks, totalBytes).toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("OpenRouter transcription returned invalid JSON", { cause: error });
  }
}

type OpenRouterBodyReadResult =
  | ReadableStreamDefaultReadValueResult<Uint8Array>
  | ReadableStreamDefaultReadDoneResult;

function readBodyChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<OpenRouterBodyReadResult> {
  if (signal.aborted) return Promise.reject(abortError(signal.reason));
  const pending = Promise.withResolvers<OpenRouterBodyReadResult>();
  const abort = (): void => {
    void reader.cancel(signal.reason).catch(() => undefined);
    pending.reject(abortError(signal.reason));
  };
  signal.addEventListener("abort", abort, { once: true });
  void reader.read().then(
    (result) => {
      signal.removeEventListener("abort", abort);
      pending.resolve(result);
      return undefined;
    },
    (error: unknown) => {
      signal.removeEventListener("abort", abort);
      pending.reject(error);
      return undefined;
    },
  );
  if (signal.aborted) abort();
  return pending.promise;
}

function encodeWave(pcm: Buffer): Buffer {
  const wave = Buffer.allocUnsafe(44 + pcm.byteLength);
  wave.write("RIFF", 0, "ascii");
  wave.writeUInt32LE(36 + pcm.byteLength, 4);
  wave.write("WAVE", 8, "ascii");
  wave.write("fmt ", 12, "ascii");
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(REALTIME_ASR_CHANNELS, 22);
  wave.writeUInt32LE(REALTIME_ASR_SAMPLE_RATE, 24);
  wave.writeUInt32LE(
    REALTIME_ASR_SAMPLE_RATE * REALTIME_ASR_CHANNELS * REALTIME_ASR_BYTES_PER_SAMPLE,
    28,
  );
  wave.writeUInt16LE(REALTIME_ASR_CHANNELS * REALTIME_ASR_BYTES_PER_SAMPLE, 32);
  wave.writeUInt16LE(REALTIME_ASR_BYTES_PER_SAMPLE * 8, 34);
  wave.write("data", 36, "ascii");
  wave.writeUInt32LE(pcm.byteLength, 40);
  pcm.copy(wave, 44);
  return wave;
}

function parseTranscription(payload: unknown): ParsedTranscription {
  if (!isRecord(payload) || typeof payload["text"] !== "string") {
    throw new Error("OpenRouter transcription response did not contain text");
  }
  const language = typeof payload["language"] === "string" ? payload["language"] : undefined;
  const words = parseWords(payload["words"]);
  const usage = parseUsage(payload["usage"]);
  return {
    text: payload["text"],
    ...(language ? { language } : {}),
    ...(words ? { words } : {}),
    ...(usage ? { usage } : {}),
  };
}

function parseWords(value: unknown): readonly ParsedWord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const words: ParsedWord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const text =
      typeof entry["word"] === "string"
        ? entry["word"]
        : typeof entry["text"] === "string"
          ? entry["text"]
          : undefined;
    const start = numberValue(entry["start"]);
    const end = numberValue(entry["end"]);
    const confidence = numberValue(entry["confidence"]);
    if (!text || start === undefined || end === undefined || end < start) continue;
    words.push({
      text,
      startSeconds: start,
      endSeconds: end,
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }
  return words.length > 0 ? words : undefined;
}

function parseUsage(value: unknown): RealtimeAsrUsage | undefined {
  if (!isRecord(value)) return undefined;
  const costUsd = numberValue(value["cost"]);
  const audioSeconds = numberValue(value["audio_seconds"]);
  const inputTokens = numberValue(value["prompt_tokens"] ?? value["input_tokens"]);
  const outputTokens = numberValue(value["completion_tokens"] ?? value["output_tokens"]);
  if (
    costUsd === undefined &&
    audioSeconds === undefined &&
    inputTokens === undefined &&
    outputTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(audioSeconds !== undefined ? { audioSeconds } : {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
  };
}

function trimResponseWords(
  words: readonly ParsedWord[] | undefined,
  duplicateWords: number,
  chunkStartMs: number,
): readonly RealtimeAsrWord[] | undefined {
  if (!words || duplicateWords >= words.length) return undefined;
  const trimmed = words.slice(duplicateWords).map((word) => ({
    text: word.text,
    startMs: chunkStartMs + Math.round(word.startSeconds * 1_000),
    durationMs: Math.max(0, Math.round((word.endSeconds - word.startSeconds) * 1_000)),
    ...(word.confidence !== undefined ? { confidence: word.confidence } : {}),
  }));
  return trimmed.length > 0 ? trimmed : undefined;
}

function splitWords(text: string): readonly string[] {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/) : [];
}

function matchingBoundaryWords(previous: readonly string[], current: readonly string[]): number {
  const maximum = Math.min(previous.length, current.length, MAX_DEDUPLICATION_WORDS);
  for (let count = maximum; count > 0; count -= 1) {
    let matches = true;
    for (let index = 0; index < count; index += 1) {
      const left = normalizeWord(previous[previous.length - count + index] ?? "");
      const right = normalizeWord(current[index] ?? "");
      if (!left || left !== right) {
        matches = false;
        break;
      }
    }
    if (matches) return count;
  }
  return 0;
}

function normalizeWord(word: string): string {
  return word.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function bytesToMilliseconds(bytes: number): number {
  return Math.round(bytes / BYTES_PER_MILLISECOND);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeSessionError(error: unknown): Error {
  if (error instanceof HttpStatusError) return error;
  if (error instanceof RangeError) return error;
  if (error instanceof Error && error.name === "AbortError") return error;
  return new Error("OpenRouter transcription failed");
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("ASR session aborted");
  error.name = "AbortError";
  return error;
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw abortError(signal.reason);
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timeout);
      reject(abortError(signal.reason));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

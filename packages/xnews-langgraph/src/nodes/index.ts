import { Buffer } from "node:buffer";

import {
  buildNewsFeedResult,
  fetchDataRelease,
  fetchEventSnapshot,
  transcribePcmStream,
  type DataProviderResult,
  type EventProviderResult,
  type EventRecord,
  type NewsFeedResult,
  type NewsItem,
  type NewsProvider,
  type NewsSubjectInput,
  type RealtimeAsrEvent,
} from "@xbbg/xnews";

import { collectBoundedAsync, finiteStepSignal } from "../bounded-async.js";
import {
  requireRuntimeContext,
  runtimeSecretValues,
  sourceFetchOptions,
  type XnewsRuntimeContext,
} from "../context.js";
import { isSensitiveDataKey } from "../credential-keys.js";
import { redactText } from "../digest.js";
import { isRecord } from "../type-guards.js";

const DEFAULT_MAX_SEEN_IDS = 10_000;
const DEFAULT_MAX_ASR_EVENTS = 1_000;
const DEFAULT_MAX_ASR_CHUNKS_PER_STEP = 32;
const DEFAULT_MAX_ASR_EVENTS_PER_STEP = 4_000;
const MAX_ASR_EVENTS_PER_STEP = 10_000;

export interface XnewsNodeRuntime {
  readonly context?: XnewsRuntimeContext | undefined;
}

export type XnewsNode<State, Update> = (
  state: Readonly<State>,
  runtime?: XnewsNodeRuntime,
) => Promise<Update>;

export interface XnewsNewsNodeOptions {
  readonly subject: NewsSubjectInput;
  readonly sources?: readonly NewsProvider[] | undefined;
  readonly limit?: number | undefined;
  readonly since?: string | undefined;
  readonly until?: string | undefined;
  readonly secForms?: readonly string[] | undefined;
  readonly maxSeenIds?: number | undefined;
}

export interface XnewsNewsNodeState {
  readonly seenIds?: readonly string[] | undefined;
  readonly addedItems?: readonly NewsItem[] | undefined;
  readonly result?: NewsFeedResult | undefined;
}

export interface XnewsNewsNodeUpdate {
  readonly seenIds: readonly string[];
  readonly addedItems: readonly NewsItem[];
  readonly result: NewsFeedResult;
}

/** One news poll. Seen ids checkpoint after success, so consumed items do not replay. */
export function createXnewsNewsNode(
  options: XnewsNewsNodeOptions,
): XnewsNode<XnewsNewsNodeState, XnewsNewsNodeUpdate> {
  const maxSeenIds = normalizePositiveInteger(options.maxSeenIds, DEFAULT_MAX_SEEN_IDS);
  return async (state, runtime = {}) => {
    const context = requireRuntimeContext(runtime.context);
    throwIfAborted(context);
    let result: NewsFeedResult;
    try {
      result = await buildNewsFeedResult({
        subject: options.subject,
        ...sourceFetchOptions(context),
        ...(options.sources === undefined ? {} : { sources: options.sources }),
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.since === undefined ? {} : { since: options.since }),
        ...(options.until === undefined ? {} : { until: options.until }),
        ...(options.secForms === undefined ? {} : { secForms: options.secForms }),
        ...(context.credentials?.openAlexApiKey === undefined
          ? {}
          : { openAlexApiKey: context.credentials.openAlexApiKey }),
      });
    } catch (error) {
      throw redactNodeError(error, context);
    }
    throwIfAborted(context);
    const seen = new Set(state.seenIds ?? []);
    const addedItems = result.items.filter((item) => !seen.has(item.id));
    for (const item of addedItems) seen.add(item.id);
    const boundedSeen = [...seen].slice(-maxSeenIds);
    return redactNodeData({ seenIds: boundedSeen, addedItems, result }, context);
  };
}

export interface XnewsDataWatchNodeOptions {
  readonly source: string;
}

export interface XnewsDataWatchNodeState {
  readonly sinceAsOf?: string | undefined;
  readonly sinceSequence?: number | undefined;
  readonly result?: DataProviderResult<unknown> | undefined;
  readonly release?: DataProviderResult<unknown>["release"] | undefined;
  readonly failureCount?: number | undefined;
  readonly lastFailureKey?: string | undefined;
}

export interface XnewsDataWatchNodeUpdate extends XnewsDataWatchNodeState {
  readonly emitted: boolean;
  readonly failureCount: number;
}

/** One data poll. Sequence wins over date when the publisher supplies both. */
export function createXnewsDataWatchNode(
  options: XnewsDataWatchNodeOptions,
): XnewsNode<XnewsDataWatchNodeState, XnewsDataWatchNodeUpdate> {
  return async (state, runtime = {}) => {
    const context = requireRuntimeContext(runtime.context);
    throwIfAborted(context);
    const source = context.dataSources?.[options.source];
    if (source === undefined) throw new Error("Data source is not bound");
    let result: DataProviderResult<unknown>;
    try {
      result = await fetchDataRelease(source, {
        ...sourceFetchOptions(context),
        ...(state.sinceAsOf === undefined ? {} : { ifNewerThan: state.sinceAsOf }),
        ...(state.sinceSequence === undefined ? {} : { afterSequence: state.sinceSequence }),
      });
    } catch (error) {
      throw redactNodeError(error, context);
    }
    throwIfAborted(context);
    const failureKey = providerFailureKey(result);
    if (failureKey !== undefined) {
      return redactNodeData(
        {
          ...state,
          result,
          emitted: false,
          failureCount: failureKey === state.lastFailureKey ? (state.failureCount ?? 0) + 1 : 1,
          lastFailureKey: failureKey,
        },
        context,
      );
    }
    const release = result.release;
    const emitted = release !== undefined && isNewDataRelease(release, state);
    return redactNodeData(
      {
        ...state,
        result,
        ...(emitted && release !== undefined
          ? {
              release,
              sinceAsOf: release.asOf,
              ...(release.sequence === undefined ? {} : { sinceSequence: release.sequence }),
            }
          : {}),
        emitted,
        failureCount: 0,
        lastFailureKey: undefined,
      },
      context,
    );
  };
}

export interface XnewsEventWatchNodeOptions {
  readonly source: string;
  readonly minSeverity?: "extreme" | "severe" | "moderate" | "minor" | "unknown" | undefined;
  readonly countryCodes?: readonly string[] | undefined;
  readonly maxSeenIds?: number | undefined;
}

export interface XnewsEventWatchNodeState {
  readonly seenIds?: readonly string[] | undefined;
  readonly result?: EventProviderResult<string> | undefined;
  readonly addedEvents?: readonly EventRecord<string>[] | undefined;
  readonly failureCount?: number | undefined;
  readonly lastFailureKey?: string | undefined;
}

export interface XnewsEventWatchNodeUpdate extends XnewsEventWatchNodeState {
  readonly seenIds: readonly string[];
  readonly addedEvents: readonly EventRecord<string>[];
  readonly result: EventProviderResult<string>;
  readonly failureCount: number;
}

/** One event poll. `result.events` is authoritative current state; `addedEvents` is only the delta. */
export function createXnewsEventWatchNode(
  options: XnewsEventWatchNodeOptions,
): XnewsNode<XnewsEventWatchNodeState, XnewsEventWatchNodeUpdate> {
  const maxSeenIds = normalizePositiveInteger(options.maxSeenIds, DEFAULT_MAX_SEEN_IDS);
  return async (state, runtime = {}) => {
    const context = requireRuntimeContext(runtime.context);
    throwIfAborted(context);
    const source = context.eventSources?.[options.source];
    if (source === undefined) throw new Error("Event source is not bound");
    let result: EventProviderResult<string>;
    try {
      result = await fetchEventSnapshot(source, {
        ...sourceFetchOptions(context),
        ...(options.minSeverity === undefined ? {} : { minSeverity: options.minSeverity }),
        ...(options.countryCodes === undefined ? {} : { countryCodes: options.countryCodes }),
      });
    } catch (error) {
      throw redactNodeError(error, context);
    }
    throwIfAborted(context);
    const seen = new Set(state.seenIds ?? []);
    const addedEvents = result.events.filter((event) => !seen.has(event.id));
    for (const event of addedEvents) seen.add(event.id);
    const boundedSeen = [...seen].slice(-maxSeenIds);
    const failureKey = providerFailureKey(result);
    return redactNodeData(
      {
        seenIds: boundedSeen,
        result,
        addedEvents,
        failureCount:
          failureKey === undefined
            ? 0
            : failureKey === state.lastFailureKey
              ? (state.failureCount ?? 0) + 1
              : 1,
        ...(failureKey === undefined ? {} : { lastFailureKey: failureKey }),
      },
      context,
    );
  };
}

export interface XnewsRealtimeAsrChunk {
  readonly id: string;
  /** Base64-encoded mono 16 kHz s16le PCM. Serializable checkpoint payload. */
  readonly pcmBase64: string;
}

export interface XnewsRealtimeAsrNodeOptions {
  readonly backend: string;
  readonly maxEvents?: number | undefined;
  readonly maxEventsPerStep?: number | undefined;
  readonly maxConsumedChunkIds?: number | undefined;
  readonly maxChunksPerStep?: number | undefined;
}

export interface XnewsRealtimeAsrNodeState {
  readonly queuedChunks?: readonly XnewsRealtimeAsrChunk[] | undefined;
  readonly consumedChunkIds?: readonly string[] | undefined;
  readonly events?: readonly RealtimeAsrEvent[] | undefined;
  readonly generation?: number | undefined;
  readonly lastSequence?: number | undefined;
  readonly failureCount?: number | undefined;
}

export interface XnewsRealtimeAsrNodeUpdate {
  readonly queuedChunks: readonly XnewsRealtimeAsrChunk[];
  readonly consumedChunkIds: readonly string[];
  readonly events: readonly RealtimeAsrEvent[];
  readonly generation: number;
  readonly lastSequence?: number | undefined;
  readonly failureCount: number;
}

/**
 * Drains the queued chunks through a newly opened invocation-local session.
 * Backend/session/socket handles are never returned and therefore never checkpointed.
 * After process loss, queued chunks open a new session and replay; consumed chunks do not.
 */
export function createXnewsRealtimeAsrNode(
  options: XnewsRealtimeAsrNodeOptions,
): XnewsNode<XnewsRealtimeAsrNodeState, XnewsRealtimeAsrNodeUpdate> {
  const maxEvents = normalizePositiveInteger(options.maxEvents, DEFAULT_MAX_ASR_EVENTS);
  const maxEventsPerStep = Math.min(
    normalizePositiveInteger(options.maxEventsPerStep, DEFAULT_MAX_ASR_EVENTS_PER_STEP),
    MAX_ASR_EVENTS_PER_STEP,
  );
  const maxConsumedChunkIds = normalizePositiveInteger(
    options.maxConsumedChunkIds,
    DEFAULT_MAX_SEEN_IDS,
  );
  const maxChunksPerStep = normalizePositiveInteger(
    options.maxChunksPerStep,
    DEFAULT_MAX_ASR_CHUNKS_PER_STEP,
  );
  return async (state, runtime = {}) => {
    const context = requireRuntimeContext(runtime.context);
    throwIfAborted(context);
    const allQueued = state.queuedChunks ?? [];
    const queued = allQueued.slice(0, maxChunksPerStep);
    const remainingQueued = allQueued.slice(maxChunksPerStep);
    if (queued.length === 0) {
      return redactNodeData(
        {
          queuedChunks: [],
          consumedChunkIds: (state.consumedChunkIds ?? []).slice(-maxConsumedChunkIds),
          events: state.events ?? [],
          generation: state.generation ?? 0,
          ...(state.lastSequence === undefined ? {} : { lastSequence: state.lastSequence }),
          failureCount: state.failureCount ?? 0,
        },
        context,
      );
    }
    const backend = context.realtimeAsrBackends?.[options.backend];
    if (backend === undefined) throw new Error("Realtime ASR backend is not bound");
    const chunks = queued.map((chunk) => new Uint8Array(Buffer.from(chunk.pcmBase64, "base64")));
    let emitted: readonly RealtimeAsrEvent[];
    try {
      const signal = finiteStepSignal(context.signal, context.timeoutMs);
      const collected = await collectBoundedAsync(
        transcribePcmStream(finiteChunks(chunks), { backend, signal }),
        maxEventsPerStep,
        signal,
      );
      if (collected.truncated) throw new RangeError("Realtime ASR event limit exceeded");
      emitted = collected.items;
      throwIfAborted(context);
    } catch (error) {
      throw redactNodeError(error, context);
    }
    const events = [...(state.events ?? []), ...emitted].slice(-maxEvents);
    const nextLastSequence = emitted.at(-1)?.sequence ?? state.lastSequence;
    return redactNodeData(
      {
        queuedChunks: remainingQueued,
        consumedChunkIds: [
          ...(state.consumedChunkIds ?? []),
          ...queued.map((chunk) => chunk.id),
        ].slice(-maxConsumedChunkIds),
        events,
        generation: (state.generation ?? 0) + 1,
        ...(nextLastSequence === undefined ? {} : { lastSequence: nextLastSequence }),
        failureCount: 0,
      },
      context,
    );
  };
}

function isNewDataRelease(
  release: { readonly asOf: string; readonly sequence?: number },
  state: XnewsDataWatchNodeState,
): boolean {
  if (release.sequence !== undefined)
    return state.sinceSequence === undefined || release.sequence > state.sinceSequence;
  return state.sinceAsOf === undefined || release.asOf > state.sinceAsOf;
}

function providerFailureKey(result: {
  readonly status: string;
  readonly error?: {
    readonly code?: string | undefined;
    readonly status?: number | undefined;
    readonly message: string;
  };
}): string | undefined {
  if (result.status !== "error" && result.status !== "disabled" && result.status !== "unsupported")
    return undefined;
  return `${result.status}:${result.error?.code ?? ""}:${result.error?.status ?? ""}`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function throwIfAborted(context: XnewsRuntimeContext): void {
  if (context.signal?.aborted !== true) return;
  if (context.signal.reason instanceof Error) {
    throw redactNodeError(context.signal.reason, context);
  }
  throw new DOMException("The operation was aborted", "AbortError");
}

async function* finiteChunks(chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

function redactNodeData<T extends object>(value: T, context: XnewsRuntimeContext): T {
  try {
    const cloned = structuredClone(value);
    if (!isRecord(cloned)) throw new TypeError("Expected cloned node data to be an object");
    const secrets = runtimeSecretValues(context);
    for (const [entryKey, entryValue] of Object.entries(cloned)) {
      const sensitive = isSensitiveDataKey(entryKey);
      const outputKey = sensitive ? "[REDACTED]" : redactText(entryKey, secrets);
      if (outputKey !== entryKey) Reflect.deleteProperty(cloned, entryKey);
      Reflect.set(cloned, outputKey, redactNodeValue(entryValue, secrets, entryKey));
    }
    return cloned;
  } catch (error) {
    throw redactNodeError(error, context);
  }
}

function redactNodeValue(value: unknown, secrets: readonly string[], key?: string): unknown {
  if (key !== undefined && isSensitiveDataKey(key)) return "[REDACTED]";
  if (key === "warnings" && Array.isArray(value)) {
    return value.map(() => "Provider warning");
  }
  if (key === "error" && isRecord(value)) {
    return {
      ...("code" in value ? { code: stableNodeErrorCode(value["code"]) } : {}),
      ...("status" in value && typeof value["status"] === "number"
        ? { status: value["status"] }
        : {}),
    };
  }
  if (typeof value === "string") return redactText(value, secrets);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: safeNodeErrorName(value.name), message: "Node operation failed" };
  }
  if (Array.isArray(value)) return value.map((item) => redactNodeValue(item, secrets));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const outputKey = isSensitiveDataKey(entryKey) ? "[REDACTED]" : redactText(entryKey, secrets);
    output[outputKey] = redactNodeValue(entryValue, secrets, entryKey);
  }
  return output;
}

function redactNodeError(error: unknown, _context: XnewsRuntimeContext): Error {
  const name = error instanceof Error ? safeNodeErrorName(error.name) : "Error";
  const message = name === "AbortError" ? "The operation was aborted" : "Node operation failed";
  const output = new Error(message);
  output.name = name;
  return output;
}

function safeNodeErrorName(name: string): string {
  return name === "AbortError" || name === "Error" || name === "RangeError" || name === "TypeError"
    ? name
    : "Error";
}

function stableNodeErrorCode(value: unknown): string {
  const code = String(value);
  return code === "config" ||
    code === "network" ||
    code === "http_status" ||
    code === "timeout" ||
    code === "aborted"
    ? code
    : "unknown";
}

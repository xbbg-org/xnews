import type {
  DataSource,
  EventSource,
  RealtimeAsrBackend,
  SourceFetchOptions,
  WorkFile,
  WorkRecord,
  WorksSource,
} from "@xbbg/xnews";
import { z } from "zod/v3";

import { isRecord } from "./type-guards.js";

type XnewsSourceFetch = NonNullable<SourceFetchOptions["fetch"]>;

export interface XnewsCredentials {
  readonly openAlexApiKey?: string | undefined;
  readonly annasArchiveKey?: string | undefined;
  readonly privateValues?: readonly string[] | undefined;
  readonly byProvider?: Readonly<Record<string, string>> | undefined;
}

export interface XnewsOcrRuntimeConfig {
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  readonly prompt?: string | undefined;
  readonly imageMode?: "base" | "gundam" | undefined;
  readonly customLogitProcessor?: string | undefined;
  readonly pagesPerRequest?: number | undefined;
  readonly extraBody?: Readonly<Record<string, unknown>> | undefined;
}

export interface XnewsDigestCaps {
  readonly maxItems?: number | undefined;
  readonly maxCharacters?: number | undefined;
  readonly maxWarnings?: number | undefined;
  readonly maxSources?: number | undefined;
}

/** Host-controlled values. None are accepted through a model-callable schema. */
export interface XnewsRuntimeContext {
  readonly fetch?: XnewsSourceFetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly redirect?: RequestRedirect | undefined;
  readonly allowCrossOriginRedirects?: boolean | undefined;
  readonly userAgent?: string | undefined;
  readonly secUserAgent?: string | undefined;
  readonly msrbAcceptTermsOfUse?: boolean | undefined;
  readonly credentials?: XnewsCredentials | undefined;
  readonly mirrors?: readonly string[] | undefined;
  readonly dataSources?: Readonly<Record<string, DataSource<unknown>>> | undefined;
  readonly eventSources?: Readonly<Record<string, EventSource<string>>> | undefined;
  readonly worksSources?: Readonly<Record<string, WorksSource>> | undefined;
  readonly workRecords?: Readonly<Record<string, WorkRecord>> | undefined;
  readonly workFiles?: Readonly<Record<string, WorkFile>> | undefined;
  readonly binaryArtifacts?: Readonly<Record<string, Uint8Array>> | undefined;
  readonly realtimeAsrBackends?: Readonly<Record<string, RealtimeAsrBackend>> | undefined;
  readonly ocr?: XnewsOcrRuntimeConfig | undefined;
  readonly digestCaps?: Readonly<Record<string, XnewsDigestCaps>> | undefined;
  /** Total byte budget for binary fields retained in one host-only artifact. */
  readonly artifactByteCap?: number | undefined;
}

export interface XnewsToolOptions {
  readonly digestCaps?: Readonly<Record<string, XnewsDigestCaps>> | undefined;
  readonly artifactByteCap?: number | undefined;
}

export const DEFAULT_XNEWS_ARTIFACT_BYTE_CAP = 8 * 1024 * 1024;
const RuntimeEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const RuntimePhoneCandidate = /(?<![\w])(?:\+?\d[\d().\s-]{5,}\d)(?![\w])/gu;

const RuntimeString = z.string().min(1).max(8_192);
const RuntimeNonnegativeInteger = z.number().int().nonnegative();
const hasString = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  typeof value[key] === "string";
const hasFunction = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  typeof value[key] === "function";
const hasOptionalString = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  value[key] === undefined || typeof value[key] === "string";
const hasOptionalFiniteNumber = (value: Readonly<Record<string, unknown>>, key: string): boolean =>
  value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key]));
const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");
const isDataSource = (value: unknown): value is DataSource<unknown> =>
  isRecord(value) &&
  hasString(value, "provider") &&
  hasString(value, "dataset") &&
  hasFunction(value, "requestUrls") &&
  hasFunction(value, "fetchRelease");
const isEventSource = (value: unknown): value is EventSource<string> =>
  isRecord(value) &&
  hasString(value, "provider") &&
  hasString(value, "dataset") &&
  hasFunction(value, "requestUrls") &&
  hasFunction(value, "fetchSnapshot");
const isWorksSource = (value: unknown): value is WorksSource =>
  isRecord(value) &&
  hasString(value, "provider") &&
  hasFunction(value, "requestUrls") &&
  hasFunction(value, "search");
const WORK_AVAILABILITY = new Set([
  "open-access",
  "public-domain",
  "preview",
  "borrow",
  "metadata-only",
  "unknown",
]);
const WORK_IDENTITY_KEYS = [
  "isbn13",
  "isbn10",
  "doi",
  "oclc",
  "lccn",
  "openLibraryId",
  "md5",
] as const;
const WORK_RECORD_OPTIONAL_STRING_KEYS = [
  "subtitle",
  "publisher",
  "edition",
  "series",
  "language",
  "format",
  "addedAt",
  "modifiedAt",
] as const;
const WORK_RECORD_OPTIONAL_NUMBER_KEYS = ["publishedYear", "pageCount", "sizeBytes"] as const;
const isWorkIdentity = (value: unknown): boolean =>
  isRecord(value) &&
  (value["origin"] === "record" || value["origin"] === "resolved") &&
  typeof value["confidence"] === "number" &&
  Number.isFinite(value["confidence"]) &&
  value["confidence"] >= 0 &&
  value["confidence"] <= 1 &&
  WORK_IDENTITY_KEYS.every((key) => hasOptionalString(value, key));
const isWorkRecordProvenance = (value: unknown): boolean =>
  isRecord(value) && hasString(value, "provider") && hasString(value, "url");
const isWorkRecord = (value: unknown): value is WorkRecord =>
  isRecord(value) &&
  hasString(value, "provider") &&
  hasString(value, "sourceId") &&
  hasString(value, "title") &&
  hasString(value, "url") &&
  isStringArray(value["authors"]) &&
  isStringArray(value["warnings"]) &&
  Array.isArray(value["provenance"]) &&
  value["provenance"].every(isWorkRecordProvenance) &&
  isWorkIdentity(value["identity"]) &&
  typeof value["availability"] === "string" &&
  WORK_AVAILABILITY.has(value["availability"]) &&
  WORK_RECORD_OPTIONAL_STRING_KEYS.every((key) => hasOptionalString(value, key)) &&
  WORK_RECORD_OPTIONAL_NUMBER_KEYS.every((key) => hasOptionalFiniteNumber(value, key));
const isWorkFile = (value: unknown): value is WorkFile =>
  isRecord(value) &&
  hasString(value, "url") &&
  hasString(value, "label") &&
  hasString(value, "provider") &&
  hasOptionalString(value, "fileName") &&
  hasOptionalString(value, "format") &&
  hasOptionalFiniteNumber(value, "sizeBytes");
const isRealtimeAsrBackend = (value: unknown): value is RealtimeAsrBackend =>
  isRecord(value) && hasString(value, "id") && hasFunction(value, "open");
const RuntimeFetchSchema = z.custom<XnewsSourceFetch>(
  (value) => typeof value === "function",
  "Expected a fetch implementation",
);
const RuntimeSignalSchema = z.custom<AbortSignal>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    "aborted" in value &&
    typeof value.aborted === "boolean" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function",
  "Expected an AbortSignal",
);
const RuntimePrivateValuesSchema = z.custom<readonly string[]>(
  (value) => z.array(RuntimeString).max(64).safeParse(value).success,
  "Expected at most 64 private strings",
);
const RuntimeMirrorsSchema = z.custom<readonly string[]>(
  (value) => z.array(z.string().url().max(2_048)).max(16).safeParse(value).success,
  "Expected at most 16 mirror URLs",
);

type XnewsRuntimeContextZodShape = {
  [Key in keyof XnewsRuntimeContext]-?: z.ZodOptional<
    z.ZodType<Exclude<XnewsRuntimeContext[Key], undefined>>
  >;
};

const XnewsRuntimeContextShape: XnewsRuntimeContextZodShape = {
  fetch: RuntimeFetchSchema.optional(),
  signal: RuntimeSignalSchema.optional(),
  timeoutMs: RuntimeNonnegativeInteger.optional(),
  maxResponseBytes: RuntimeNonnegativeInteger.optional(),
  redirect: z.enum(["follow", "error", "manual"]).optional(),
  allowCrossOriginRedirects: z.boolean().optional(),
  userAgent: RuntimeString.optional(),
  secUserAgent: RuntimeString.optional(),
  msrbAcceptTermsOfUse: z.boolean().optional(),
  credentials: z
    .object({
      openAlexApiKey: RuntimeString.optional(),
      annasArchiveKey: RuntimeString.optional(),
      privateValues: RuntimePrivateValuesSchema.optional(),
      byProvider: z.record(RuntimeString).optional(),
    })
    .strict()
    .optional(),
  mirrors: RuntimeMirrorsSchema.optional(),
  dataSources: z.record(z.custom<DataSource<unknown>>(isDataSource)).optional(),
  eventSources: z.record(z.custom<EventSource<string>>(isEventSource)).optional(),
  worksSources: z.record(z.custom<WorksSource>(isWorksSource)).optional(),
  workRecords: z.record(z.custom<WorkRecord>(isWorkRecord)).optional(),
  workFiles: z.record(z.custom<WorkFile>(isWorkFile)).optional(),
  binaryArtifacts: z
    .record(z.custom<Uint8Array>((value) => value instanceof Uint8Array))
    .optional(),
  realtimeAsrBackends: z.record(z.custom<RealtimeAsrBackend>(isRealtimeAsrBackend)).optional(),
  ocr: z
    .object({
      baseUrl: z.string().url().max(2_048),
      apiKey: RuntimeString.optional(),
      model: RuntimeString.optional(),
      prompt: z.string().max(16_000).optional(),
      imageMode: z.enum(["base", "gundam"]).optional(),
      customLogitProcessor: RuntimeString.optional(),
      pagesPerRequest: z.number().int().positive().max(100).optional(),
      extraBody: z.record(z.unknown()).optional(),
    })
    .strict()
    .optional(),
  digestCaps: z
    .record(
      z
        .object({
          maxItems: RuntimeNonnegativeInteger.optional(),
          maxCharacters: RuntimeNonnegativeInteger.optional(),
          maxWarnings: RuntimeNonnegativeInteger.optional(),
          maxSources: RuntimeNonnegativeInteger.optional(),
        })
        .strict(),
    )
    .optional(),
  artifactByteCap: RuntimeNonnegativeInteger.optional(),
};

export const XnewsRuntimeContextSchema: z.ZodObject<
  typeof XnewsRuntimeContextShape,
  "strict",
  z.ZodTypeAny,
  XnewsRuntimeContext,
  XnewsRuntimeContext
> = z.object(XnewsRuntimeContextShape).strict();

export function sourceFetchOptions(context: XnewsRuntimeContext): SourceFetchOptions {
  return {
    ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
    ...(context.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: context.maxResponseBytes }),
    ...(context.redirect === undefined ? {} : { redirect: context.redirect }),
    ...(context.allowCrossOriginRedirects === undefined
      ? {}
      : { allowCrossOriginRedirects: context.allowCrossOriginRedirects }),
    ...(context.userAgent === undefined ? {} : { userAgent: context.userAgent }),
    ...(context.secUserAgent === undefined ? {} : { secUserAgent: context.secUserAgent }),
    ...(context.msrbAcceptTermsOfUse === undefined
      ? {}
      : { msrbAcceptTermsOfUse: context.msrbAcceptTermsOfUse }),
  };
}

export function requireRuntimeContext(value: unknown): XnewsRuntimeContext {
  if (value === undefined) return {};
  const result = XnewsRuntimeContextSchema.strip().safeParse(value);
  if (!result.success) throw new TypeError("Invalid xnews runtime context");
  return result.data;
}

export function runtimeSecretValues(context: XnewsRuntimeContext): readonly string[] {
  const values = new Set<string>();
  const visited = new WeakSet<object>();
  let remainingNestedValues = 512;
  const add = (value: string | undefined): void => {
    if (value !== undefined && value.length > 0) values.add(value);
  };
  const addNestedStrings = (value: unknown, depth = 0): void => {
    if (remainingNestedValues <= 0 || depth > 8) return;
    remainingNestedValues -= 1;
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) return;
    visited.add(value);
    for (const key of Object.keys(value).slice(0, 128)) {
      let item: unknown;
      try {
        item = Reflect.get(value, key);
      } catch {
        continue;
      }
      addNestedStrings(item, depth + 1);
    }
  };
  const addOperatorValue = (value: string | undefined): void => {
    add(value);
    if (value === undefined) return;
    for (const match of value.matchAll(RuntimeEmail)) add(match[0]);
    for (const match of value.matchAll(RuntimePhoneCandidate)) {
      const candidate = match[0];
      const digitCount = candidate.replace(/\D/gu, "").length;
      if (digitCount >= 10 && digitCount <= 15) add(candidate);
    }
  };
  addOperatorValue(context.secUserAgent);
  addOperatorValue(context.userAgent);
  add(context.credentials?.openAlexApiKey);
  add(context.credentials?.annasArchiveKey);
  for (const value of context.credentials?.privateValues ?? []) add(value);
  for (const value of Object.values(context.credentials?.byProvider ?? {})) add(value);
  addNestedStrings(context.ocr);
  for (const value of context.mirrors ?? []) add(value);
  return [...values].toSorted(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
}

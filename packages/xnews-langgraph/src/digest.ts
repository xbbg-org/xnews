import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import {
  DEFAULT_XNEWS_ARTIFACT_BYTE_CAP,
  runtimeSecretValues,
  type XnewsDigestCaps,
  type XnewsRuntimeContext,
  type XnewsToolOptions,
} from "./context.js";
import { isSensitiveDataKey } from "./credential-keys.js";
import type { XnewsToolName } from "./registry.js";
import { isRecord } from "./type-guards.js";

const REDACTED = "[REDACTED]";
// A capability URL carries its secret in a credential-named query parameter. Path segments
// are public routing — a Google News article id or a Federal Register slug — and a
// host-supplied URL is already covered by value.
const SENSITIVE_QUERY_KEY =
  /(?:^|[_-])(?:api[_-]?key|key|access[_-]?token|auth|credential|password|secret|session|sig(?:nature)?|token)(?:$|[_-])/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/giu;
const MAX_SUMMARY_KEYS = 20;
const MAX_SUMMARY_STRING = 512;

export interface XnewsDigestOmissions {
  readonly items: number;
  readonly warnings: number;
  readonly sources: number;
  readonly characters: number;
}

export interface XnewsToolDigest {
  readonly version: 1;
  readonly tool: XnewsToolName;
  readonly operation: string;
  readonly status: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly items: readonly unknown[];
  readonly warnings: readonly string[];
  readonly sources: readonly string[];
  readonly omissions: XnewsDigestOmissions;
  readonly truncated: boolean;
}

export interface XnewsByteArtifact {
  readonly kind: "bytes";
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly truncated: boolean;
  readonly omittedBytes: number;
  readonly bytes?: Uint8Array | undefined;
}

export interface XnewsToolArtifact {
  readonly version: 1;
  readonly tool: XnewsToolName;
  readonly operation: string;
  readonly digest: XnewsToolDigest;
  readonly data: unknown;
  readonly binary: {
    readonly capBytes: number;
    readonly retainedBytes: number;
    readonly omittedBytes: number;
    readonly truncatedFields: number;
  };
}

export interface XnewsToolOutputOptions {
  readonly tool: XnewsToolName;
  readonly operation: string;
  readonly status: string;
  readonly data: unknown;
  readonly items?: readonly unknown[] | undefined;
  readonly warnings?: readonly string[] | undefined;
  readonly sources?: readonly string[] | undefined;
  readonly counts?: Readonly<Record<string, number>> | undefined;
  readonly context: XnewsRuntimeContext;
  readonly options?: XnewsToolOptions | undefined;
}

interface BinaryBudget {
  readonly cap: number;
  retained: number;
  omitted: number;
  truncatedFields: number;
}

const DEFAULT_DIGEST_CAPS: Readonly<Record<XnewsToolName, Required<XnewsDigestCaps>>> = {
  xnews_news: { maxItems: 12, maxCharacters: 8_000, maxWarnings: 8, maxSources: 12 },
  xnews_research: { maxItems: 10, maxCharacters: 8_000, maxWarnings: 8, maxSources: 12 },
  xnews_data: { maxItems: 8, maxCharacters: 6_000, maxWarnings: 8, maxSources: 8 },
  xnews_events: { maxItems: 12, maxCharacters: 7_000, maxWarnings: 8, maxSources: 10 },
  xnews_works: { maxItems: 10, maxCharacters: 7_000, maxWarnings: 8, maxSources: 10 },
  xnews_files: { maxItems: 8, maxCharacters: 4_000, maxWarnings: 8, maxSources: 8 },
  xnews_extract: { maxItems: 8, maxCharacters: 6_000, maxWarnings: 8, maxSources: 4 },
  xnews_ocr: { maxItems: 8, maxCharacters: 6_000, maxWarnings: 8, maxSources: 4 },
  xnews_transcribe: { maxItems: 12, maxCharacters: 7_000, maxWarnings: 8, maxSources: 6 },
  xnews_catalog: { maxItems: 20, maxCharacters: 8_000, maxWarnings: 4, maxSources: 8 },
};

/** The identity a citation handle is derived from. */
export interface XnewsCitationScope {
  readonly tool: string;
  /** Provider that issued the id, where the record names one. */
  readonly provider?: string | undefined;
  readonly id: string;
}

/**
 * Gives an item a short citation handle.
 *
 * A news item's own id is `provider|guid|title` and runs to hundreds of characters, so a model
 * asked to cite it truncates at the `provider|guid` boundary: measured live, every citation from
 * three providers failed to match the id it was shown, while matching once the title was
 * stripped. `ref` is a short digest of the item's identity — quotable exactly, stable across
 * calls, and derived rather than assigned so identical tool output stays byte-identical.
 *
 * The hash is taken from the raw item, never the summarized copy: a summary truncates a string
 * past 512 characters, and a ref hashed from the truncation could not be recomputed from the
 * record a host holds.
 */
function withCitationRef(tool: string, raw: unknown, summarized: unknown): unknown {
  if (!isRecord(summarized)) return summarized;
  // `WorkRecord` names its provider-native identifier `sourceId`; events and news items use `id`.
  // A row with neither — a data release row, an extracted page — has no stable identity to hash,
  // and inventing one from its contents would change the handle whenever the provider did.
  const id = isRecord(raw) ? (raw["id"] ?? raw["sourceId"]) : undefined;
  if (typeof id !== "string" || id.length === 0) return summarized;
  const provider = isRecord(raw) ? raw["provider"] : undefined;
  // `ref` is reserved. An upstream record carrying its own `ref` would otherwise choose the handle
  // a citation resolves through, and provider payloads are attacker-influenced.
  return {
    ...summarized,
    ref: citationRef({ tool, id, ...(typeof provider === "string" ? { provider } : {}) }),
  };
}

/**
 * The handle a host resolves a citation with; recomputable from the record a host holds.
 *
 * The identity is namespaced, not the bare id: an event id is unique only within its provider, so
 * two providers reporting alert `1` in one `across` result would otherwise share a handle and
 * resolve to whichever arrived first. 96 bits, not the 48 a shorter prefix would give, because
 * provider content is attacker-influenced and grinding a 48-bit collision is roughly 2^24 work.
 */
export function citationRef(scope: XnewsCitationScope): string {
  const identity = [scope.tool, scope.provider ?? "", scope.id].join("\u0000");
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

export function createXnewsToolOutput(
  input: XnewsToolOutputOptions,
): readonly [content: string, artifact: XnewsToolArtifact] {
  const secrets = runtimeSecretValues(input.context);
  const caps = resolveDigestCaps(input.tool, input.context, input.options);
  const itemValues = input.items ?? [];
  const warningValues = input.warnings ?? [];
  const sourceValues = input.sources ?? [];
  const selectedItems = itemValues
    .slice(0, caps.maxItems)
    .map((item) => withCitationRef(input.tool, item, summarizeValue(item, secrets)));
  const warnings = warningValues.slice(0, caps.maxWarnings).map(() => "Provider warning");
  const sources = sourceValues
    .slice(0, caps.maxSources)
    .map((source) => redactUrl(source, secrets));
  const itemOmitted = Math.max(0, itemValues.length - selectedItems.length);
  const warningOmitted = Math.max(0, warningValues.length - warnings.length);
  const sourceOmitted = Math.max(0, sourceValues.length - sources.length);
  const counts = sortedCounts(input.counts ?? {});

  let digest: XnewsToolDigest = {
    version: 1,
    tool: input.tool,
    operation: input.operation,
    status: redactText(input.status, secrets),
    counts,
    items: selectedItems,
    warnings,
    sources,
    omissions: {
      items: itemOmitted,
      warnings: warningOmitted,
      sources: sourceOmitted,
      characters: 0,
    },
    truncated: itemOmitted + warningOmitted + sourceOmitted > 0,
  };
  let content = stableStringify(digest);
  while (content.length > caps.maxCharacters && digest.items.length > 0) {
    digest = withOneLessItem(digest);
    content = stableStringify(digest);
  }
  while (content.length > caps.maxCharacters && digest.warnings.length > 0) {
    digest = withOneLessWarning(digest);
    content = stableStringify(digest);
  }
  while (content.length > caps.maxCharacters && digest.sources.length > 0) {
    digest = withOneLessSource(digest);
    content = stableStringify(digest);
  }
  if (content.length > caps.maxCharacters) {
    const minimal = {
      version: 1 as const,
      tool: input.tool,
      operation: input.operation,
      status: redactText(input.status, secrets),
      counts,
      items: [] as readonly unknown[],
      warnings: [] as readonly string[],
      sources: [] as readonly string[],
      omissions: {
        items: itemValues.length,
        warnings: warningValues.length,
        sources: sourceValues.length,
        characters: content.length - caps.maxCharacters,
      },
      truncated: true,
    };
    digest = minimal;
    content = stableStringify(minimal);
  }

  const cap = normalizeByteCap(
    input.context.artifactByteCap ??
      input.options?.artifactByteCap ??
      DEFAULT_XNEWS_ARTIFACT_BYTE_CAP,
  );
  const budget: BinaryBudget = { cap, retained: 0, omitted: 0, truncatedFields: 0 };
  const data = sanitizeArtifact(input.data, secrets, budget);
  return [
    content,
    {
      version: 1,
      tool: input.tool,
      operation: input.operation,
      digest,
      data,
      binary: {
        capBytes: cap,
        retainedBytes: budget.retained,
        omittedBytes: budget.omitted,
        truncatedFields: budget.truncatedFields,
      },
    },
  ];
}

export function failureXnewsToolOutput(
  tool: XnewsToolName,
  operation: string,
  error: unknown,
  context: XnewsRuntimeContext,
  options?: XnewsToolOptions,
): readonly [content: string, artifact: XnewsToolArtifact] {
  const code = errorCode(error);
  const message = code === "aborted" ? "Operation aborted" : `Operation failed (${code})`;
  return createXnewsToolOutput({
    tool,
    operation,
    status: code === "aborted" ? "aborted" : "error",
    data: { error: { code } },
    warnings: [message],
    counts: {},
    context,
    ...(options === undefined ? {} : { options }),
  });
}

export function redactText(value: string, secrets: readonly string[] = []): string {
  const urlsRedacted = value.replace(URL_IN_TEXT, (candidate) => redactUrl(candidate, secrets));
  return redactSecretText(urlsRedacted, secrets);
}

export function redactSecretText(value: string, secrets: readonly string[] = []): string {
  let result = value;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.replaceAll(secret, REDACTED);
  }
  return result.replace(BEARER, REDACTED);
}

export function redactUrl(value: string, secrets: readonly string[] = []): string {
  const redacted = redactSecretText(value, secrets);
  let url: URL;
  try {
    url = new URL(redacted);
  } catch {
    return redacted;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return REDACTED;
  if (url.username.length > 0) url.username = REDACTED;
  if (url.password.length > 0) url.password = REDACTED;
  for (const key of new Set(url.searchParams.keys())) {
    if (!SENSITIVE_QUERY_KEY.test(key)) continue;
    const valueCount = url.searchParams.getAll(key).length;
    url.searchParams.delete(key);
    for (let index = 0; index < valueCount; index += 1) {
      url.searchParams.append(key, REDACTED);
    }
  }
  return url.toString();
}

export function stableStringify(value: unknown): string {
  try {
    const output = JSON.stringify(sortJson(value));
    if (output === undefined) throw new TypeError("Value is not JSON serializable");
    return output;
  } catch (error) {
    if (error instanceof TypeError && error.message === "Value is not JSON serializable")
      throw error;
    throw new TypeError("Value is not JSON serializable", { cause: error });
  }
}

function sanitizeArtifact(
  value: unknown,
  secrets: readonly string[],
  budget: BinaryBudget,
  key?: string,
): unknown {
  if (key !== undefined && isSensitiveDataKey(key)) return REDACTED;
  if (typeof value === "string")
    return looksLikeUrl(value) ? redactUrl(value, secrets) : redactText(value, secrets);
  if (value instanceof Uint8Array) return binaryArtifact(value, budget);
  if (value instanceof URL) return redactUrl(value.toString(), secrets);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: safeErrorName(value.name),
      message: redactText(value.message, secrets),
      ...("code" in value ? { code: redactText(String(value.code), secrets) } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeArtifact(item, secrets, budget));
  }
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const entryKey of Object.keys(value).toSorted()) {
    const redactedKey = redactText(entryKey, secrets);
    const outputKey =
      isSensitiveDataKey(entryKey) || redactedKey !== entryKey ? REDACTED : entryKey;
    output[outputKey] = sanitizeArtifact(value[entryKey], secrets, budget, entryKey);
  }
  return output;
}

function binaryArtifact(bytes: Uint8Array, budget: BinaryBudget): XnewsByteArtifact {
  const hash = createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
  const retained = budget.retained + bytes.byteLength <= budget.cap;
  if (retained) budget.retained += bytes.byteLength;
  else {
    budget.omitted += bytes.byteLength;
    budget.truncatedFields += 1;
  }
  return {
    kind: "bytes",
    sizeBytes: bytes.byteLength,
    sha256: hash,
    truncated: !retained,
    omittedBytes: retained ? 0 : bytes.byteLength,
    ...(retained ? { bytes } : {}),
  };
}

function summarizeValue(value: unknown, secrets: readonly string[], depth = 0): unknown {
  if (typeof value === "string") {
    const redacted = looksLikeUrl(value) ? redactUrl(value, secrets) : redactText(value, secrets);
    return redacted.length <= MAX_SUMMARY_STRING
      ? redacted
      : `${redacted.slice(0, MAX_SUMMARY_STRING)}…`;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Uint8Array) {
    return {
      kind: "bytes",
      sizeBytes: value.byteLength,
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }
  if (Array.isArray(value)) {
    if (depth >= 2) return { itemCount: value.length };
    return value.slice(0, 8).map((item) => summarizeValue(item, secrets, depth + 1));
  }
  if (value === undefined) return "undefined";
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function")
    return String(value);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  const keys = Object.keys(value).toSorted().slice(0, MAX_SUMMARY_KEYS);
  for (const key of keys) {
    const redactedKey = redactText(key, secrets);
    const sensitive = isSensitiveDataKey(key);
    const outputKey = sensitive || redactedKey !== key ? REDACTED : key;
    result[outputKey] = sensitive ? REDACTED : summarizeValue(value[key], secrets, depth + 1);
  }
  const omittedKeys = Object.keys(value).length - keys.length;
  if (omittedKeys > 0) result["omittedKeys"] = omittedKeys;
  return result;
}

function resolveDigestCaps(
  tool: XnewsToolName,
  context: XnewsRuntimeContext,
  options: XnewsToolOptions | undefined,
): Required<XnewsDigestCaps> {
  const defaults = DEFAULT_DIGEST_CAPS[tool];
  const configured = {
    ...defaults,
    ...options?.digestCaps?.[tool],
    ...context.digestCaps?.[tool],
  };
  return {
    maxItems: positiveCap(configured.maxItems, defaults.maxItems),
    maxCharacters: Math.max(256, positiveCap(configured.maxCharacters, defaults.maxCharacters)),
    maxWarnings: positiveCap(configured.maxWarnings, defaults.maxWarnings),
    maxSources: positiveCap(configured.maxSources, defaults.maxSources),
  };
}

function positiveCap(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function normalizeByteCap(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : DEFAULT_XNEWS_ARTIFACT_BYTE_CAP;
}

function sortedCounts(counts: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(counts).toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function withOneLessItem(digest: XnewsToolDigest): XnewsToolDigest {
  return {
    ...digest,
    items: digest.items.slice(0, -1),
    omissions: { ...digest.omissions, items: digest.omissions.items + 1 },
    truncated: true,
  };
}

function withOneLessWarning(digest: XnewsToolDigest): XnewsToolDigest {
  return {
    ...digest,
    warnings: digest.warnings.slice(0, -1),
    omissions: { ...digest.omissions, warnings: digest.omissions.warnings + 1 },
    truncated: true,
  };
}

function withOneLessSource(digest: XnewsToolDigest): XnewsToolDigest {
  return {
    ...digest,
    sources: digest.sources.slice(0, -1),
    omissions: { ...digest.omissions, sources: digest.omissions.sources + 1 },
    truncated: true,
  };
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    result[key] = sortJson(value[key]);
  }
  return result;
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z\d+.-]*:\/\//iu.test(value);
}

function errorCode(
  error: unknown,
): "config" | "network" | "http_status" | "timeout" | "aborted" | "unknown" {
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  if (typeof error !== "object" || error === null || !("code" in error)) return "unknown";
  const code = String(error.code);
  if (
    code === "config" ||
    code === "network" ||
    code === "http_status" ||
    code === "timeout" ||
    code === "aborted"
  )
    return code;
  return "unknown";
}

function safeErrorName(name: string): string {
  return name === "AbortError" ||
    name === "Error" ||
    name === "RangeError" ||
    name === "SyntaxError" ||
    name === "TypeError"
    ? name
    : "Error";
}

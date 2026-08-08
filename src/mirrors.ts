/**
 * Mirror pools: caller-supplied lists of origins for catalogs whose domains
 * rotate.
 *
 * The list format is an INI-ish text file:
 *
 * ```text
 * # Lines starting with # are comments.
 * [libgen]
 * https://example.org          # a trailing comment becomes the label
 * example.net                  # a bare host is read as https://example.net
 *
 * [annas-archive]
 * https://example.com
 * ```
 *
 * Entries before the first `[pool]` header land in `DEFAULT_MIRROR_POOL`.
 * `parseMirrorList` is pure; only `loadMirrorList` touches the filesystem.
 */

import { readFile } from "node:fs/promises";
import { XnewsFetchError } from "./errors.js";
import type { ProviderErrorCode } from "./types.js";

/** One origin from a mirror list. */
export interface Mirror {
  /** Absolute origin, normalized without a trailing slash. */
  readonly baseUrl: string;
  /** Free-text label from the entry's trailing comment, when it had one. */
  readonly label?: string;
}

/** Parsed mirror list. Pools are keyed by their `[section]` name. */
export interface MirrorList {
  readonly pools: Readonly<Record<string, readonly Mirror[]>>;
  /** Rejected or corrected entries, one message each. */
  readonly warnings: readonly string[];
  /** Where the list came from, for provenance in errors. */
  readonly source: string;
}

/** Environment variable naming the mirror list file. */
export const MIRRORS_FILE_ENV = "XNEWS_MIRRORS_FILE";

/** File `loadMirrorList` reads when given no path and no environment override. */
export const DEFAULT_MIRRORS_FILE = "mirrors.local.txt";

/** Pool that receives entries written before the first `[section]` header. */
export const DEFAULT_MIRROR_POOL = "default";

const SECTION = /^\[([^\]]+)\]$/;

/**
 * Parses mirror-list text. Never throws: a malformed entry is dropped and
 * explained in `warnings`, so one bad line cannot cost you the whole file.
 *
 * Entries must be HTTPS. `src/http.ts` refuses plaintext requests, so an
 * `http://` origin would fail at request time; rejecting it here turns a
 * per-request failure into one parse-time warning.
 */
export function parseMirrorList(text: string, source = "<inline>"): MirrorList {
  const pools = new Map<string, Mirror[]>();
  const warnings: string[] = [];
  let pool = DEFAULT_MIRROR_POOL;

  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;

    const section = SECTION.exec(line);
    if (section !== null) {
      pool = (section[1] ?? "").trim().toLowerCase();
      if (pool === "") {
        warnings.push(`${source}:${lineNumber}: empty pool name; using "${DEFAULT_MIRROR_POOL}"`);
        pool = DEFAULT_MIRROR_POOL;
      }
      if (!pools.has(pool)) pools.set(pool, []);
      continue;
    }

    const hash = line.indexOf("#");
    const label = hash === -1 ? undefined : line.slice(hash + 1).trim();
    const candidate = (hash === -1 ? line : line.slice(0, hash)).trim();
    if (candidate === "") continue;

    const baseUrl = normalizeOrigin(candidate);
    if (baseUrl === undefined) {
      warnings.push(`${source}:${lineNumber}: not a usable https origin: ${candidate}`);
      continue;
    }

    const entries = pools.get(pool) ?? [];
    if (entries.some((entry) => entry.baseUrl === baseUrl)) {
      warnings.push(`${source}:${lineNumber}: duplicate origin in pool "${pool}": ${baseUrl}`);
      continue;
    }
    entries.push({ baseUrl, ...(label === undefined || label === "" ? {} : { label }) });
    pools.set(pool, entries);
  }

  return {
    pools: Object.fromEntries(pools),
    warnings,
    source,
  };
}

/** Entries in one pool, or an empty list when the pool is absent. */
export function mirrorPool(list: MirrorList, pool: string): readonly Mirror[] {
  return list.pools[pool.toLowerCase()] ?? [];
}

/** Origins in one pool, in list order — the shape adapters take. */
export function mirrorBaseUrls(list: MirrorList, pool: string): readonly string[] {
  return mirrorPool(list, pool).map((mirror) => mirror.baseUrl);
}

/** Path `loadMirrorList` reads when called with no argument. */
export function resolveMirrorsFile(path?: string): string {
  return path ?? process.env[MIRRORS_FILE_ENV] ?? DEFAULT_MIRRORS_FILE;
}

/**
 * Reads and parses a mirror list. Throws a `config`-coded `XnewsFetchError`
 * when the file cannot be read: a caller that asked for a list and silently
 * got none would otherwise dial nothing and report an empty catalog.
 */
export async function loadMirrorList(path?: string): Promise<MirrorList> {
  const file = resolveMirrorsFile(path);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new XnewsFetchError("config", `Cannot read mirror list ${file}: ${reason}`, {
      url: `file://${file}`,
    });
  }
  return parseMirrorList(text, file);
}

/** One retryable mirror failure, kept for successful-failover warnings and exhausted-pool errors. */
export interface MirrorAttempt {
  readonly baseUrl: string;
  readonly code: ProviderErrorCode;
  /** Original failure message; consumers must not reduce an attempt to its code alone. */
  readonly message: string;
}

/** A successful attempt plus the mirrors that failed before it. */
export interface MirrorOutcome<Value> {
  readonly value: Value;
  /** Origin that answered. */
  readonly baseUrl: string;
  readonly attempts: readonly MirrorAttempt[];
}

/**
 * Runs `attempt` against each origin in order and returns the first success.
 *
 * Only a transport-coded `XnewsFetchError` advances to the next mirror. A
 * programming error or failed configuration is independent of the selected
 * origin and is rethrown unchanged. A mirror that answers with zero results
 * has answered, and failing over would silently turn one catalog's honest
 * empty page into another catalog's results.
 *
 * Throws a `config`-coded error for an empty pool, and when every mirror
 * failed, the last mirror's code with all attempts named in the message.
 */
export async function withMirrorFailover<Value>(
  baseUrls: readonly string[],
  attempt: (baseUrl: string) => Promise<Value>,
): Promise<MirrorOutcome<Value>> {
  if (baseUrls.length === 0) {
    throw new XnewsFetchError("config", "No mirror origins supplied", { url: "" });
  }

  const attempts: MirrorAttempt[] = [];
  const causes: XnewsFetchError[] = [];
  for (const baseUrl of baseUrls) {
    try {
      return { value: await attempt(baseUrl), baseUrl, attempts };
    } catch (error) {
      // An aborted request is the caller withdrawing, not a mirror failing;
      // walking the rest of the pool would ignore the abort.
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (!(error instanceof XnewsFetchError) || !MIRROR_RETRYABLE[error.code]) throw error;
      attempts.push({
        baseUrl,
        code: error.code,
        message: error.message,
      });
      causes.push(error);
    }
  }

  const last = attempts.at(-1);
  // Each mirror's own message is kept: an aggregate that reported only codes
  // would hide the one detail that says whether the pool is down or the
  // parser broke.
  const detail = attempts
    .map((entry) => `${entry.baseUrl} (${entry.code}): ${entry.message}`)
    .join("; ");
  const aggregate = new XnewsFetchError(
    last?.code ?? "network",
    `All ${attempts.length} mirror(s) failed: ${detail}`,
    { url: last?.baseUrl ?? "" },
  );
  aggregate.cause = new AggregateError(causes, "Mirror attempts failed");
  throw aggregate;
}

/**
 * Which failures mean "try the next mirror". A `Record` keyed on the full
 * union makes a new error code a compile error here rather than a silent
 * default, and `config`/`aborted`/`unknown` are deliberately not retryable:
 * they signal caller configuration, withdrawal, or a bug in this library, so
 * walking the rest of the pool would waste requests and then misreport the
 * cause as an outage.
 */
const MIRROR_RETRYABLE: Readonly<Record<ProviderErrorCode, boolean>> = {
  network: true,
  http_status: true,
  timeout: true,
  config: false,
  aborted: false,
  unknown: false,
};

/**
 * Reads one list entry as an https origin. A bare host is read as https, a
 * trailing slash is dropped, and any query or fragment is discarded — a
 * mirror origin is a prefix that URL builders join paths onto, so anything
 * past the path would corrupt every URL built from it.
 */
function normalizeOrigin(value: string): string | undefined {
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname === "") return undefined;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

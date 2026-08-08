/**
 * The works lane: generic machinery for bibliographic catalog lookup.
 *
 * News providers return dated documents and data providers return dated
 * rows; a catalog answers a *query* with records that carry no release date
 * and have no natural time ordering, so neither lane applies. A `WorksSource`
 * binds one catalog to its transport, and this module wraps any source in the
 * same non-throwing status taxonomy the other lanes give providers, then adds
 * the two things catalogs specifically need: cross-catalog deduplication and
 * identity resolution for records that state no identifiers.
 *
 * Built-in sources live under `src/sources/` (see `libgenSource` and
 * `openLibrarySource`); consumers can implement `WorksSource` for their own
 * catalogs and reuse everything here.
 */

import { providerErrorFromUnknown } from "./http.js";
import type {
  ProviderError,
  ResolveWorkIdentityOptions,
  WorkAvailability,
  WorkIdentity,
  WorkIdentityCandidate,
  WorkIdentityResolution,
  WorkRecord,
  WorkRecordProvenance,
  WorksPage,
  WorksQuery,
  WorksResult,
  WorksSource,
} from "./types.js";

const DEFAULT_MIN_CONFIDENCE = 0.82;
const DEFAULT_MAX_CANDIDATES = 10;

/**
 * Searches one catalog through the shared status taxonomy. Never throws:
 * transport failures land in `error` with `status: "error"`, caller
 * configuration preconditions — an unset mirror base URL, an empty query —
 * land in `status: "disabled"`, and a page whose parse produced warnings but
 * still yielded records is `"partial"`.
 */
export async function searchWorks(
  source: WorksSource,
  query: WorksQuery = {},
): Promise<WorksResult> {
  const startedAt = Date.now();
  let requestUrls: readonly string[] = [];
  try {
    requestUrls = source.requestUrls(query);
    const page = await source.search(query);
    return worksResult(source, {
      status: statusOf(page),
      page,
      startedAt,
      // A source may dial URLs the pre-flight estimate could not know
      // (pagination, detail pages); the page's own list is authoritative.
      requestUrls: page.requestUrls.length > 0 ? page.requestUrls : requestUrls,
    });
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    return worksResult(source, {
      // A config precondition is the caller's decision, not a transport
      // failure: the provider is disabled until the caller supplies it.
      status: providerError.code === "config" ? "disabled" : "error",
      warnings: [`${source.provider}: ${providerError.message}`],
      startedAt,
      requestUrls,
      error: providerError,
    });
  }
}

/**
 * Searches several catalogs concurrently and merges the results. Every
 * source's envelope is returned so a single failing catalog degrades the
 * merge instead of failing it.
 */
export async function searchWorksAcross(
  sources: readonly WorksSource[],
  query: WorksQuery = {},
): Promise<{ readonly items: readonly WorkRecord[]; readonly results: readonly WorksResult[] }> {
  const results = await Promise.all(sources.map((source) => searchWorks(source, query)));
  return { items: mergeWorkRecords(results.flatMap((result) => result.items)), results };
}

/**
 * Deduplicates records across catalogs. Records collapse on the strongest
 * shared identifier — ISBN-13, then DOI, then content hash — and fall back to
 * normalized title, lead author, year, and format. The first record for a key
 * wins field-by-field; later duplicates fill only what it left unset, so a
 * catalog with sparse metadata enriches rather than overwrites. Provenance,
 * warnings, and the highest-confidence identity are unioned.
 */
export function mergeWorkRecords(records: readonly WorkRecord[]): WorkRecord[] {
  const merged = new Map<string, WorkRecord>();
  for (const record of records) {
    const key = dedupeKey(record);
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? record : mergeRecordPair(existing, record));
  }
  return [...merged.values()];
}

/**
 * Recovers bibliographic identifiers for a record that states none, by
 * matching it against an authoritative catalog on title, author, and year.
 *
 * This is deliberately conservative. Scores combine title token similarity
 * (weight 0.6), author surname overlap (0.25), and year proximity (0.15); an
 * exact ISBN or DOI agreement short-circuits to 1. `matched` is set only when
 * the best candidate clears `minConfidence`, and the returned identity is
 * always stamped `origin: "resolved"` with that score as its `confidence` —
 * callers MUST NOT treat a resolved identity as authoritative without
 * checking it. Near misses stay in `candidates` for review.
 */
export async function resolveWorkIdentity(
  record: WorkRecord,
  source: WorksSource,
  options: ResolveWorkIdentityOptions = {},
): Promise<WorkIdentityResolution> {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (record.identity.origin === "record" && hasBibliographicId(record.identity)) {
    return {
      identity: record.identity,
      matched: record,
      candidates: [],
      warnings: [],
      status: "ok",
    };
  }

  const query = identityQuery(record, options, maxCandidates);
  if (query === undefined) {
    const message = `${source.provider}: record has no title to resolve against`;
    return {
      identity: record.identity,
      candidates: [],
      warnings: [message],
      status: "disabled",
      error: { code: "config", message },
    };
  }

  const result = await searchWorks(source, query);
  if (result.status === "error" || result.status === "disabled") {
    return {
      identity: record.identity,
      candidates: [],
      warnings: result.warnings,
      status: result.status,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  }
  const candidates = result.items
    .map((candidate) => ({ record: candidate, score: workMatchScore(record, candidate) }))
    .filter((candidate) => candidate.score > 0)
    .toSorted(compareCandidates)
    .slice(0, maxCandidates);

  const best = candidates[0];
  if (best === undefined || best.score < minConfidence) {
    return {
      identity: record.identity,
      candidates,
      warnings: [
        ...result.warnings,
        best === undefined
          ? `${source.provider}: no candidate matched "${record.title}"`
          : `${source.provider}: best candidate for "${record.title}" scored ${best.score.toFixed(2)}, below ${minConfidence}`,
      ],
      status: result.status,
    };
  }

  return {
    identity: resolvedIdentity(record.identity, best.record.identity, best.score),
    matched: best.record,
    candidates,
    warnings: result.warnings,
    status: result.status,
  };
}

/**
 * Scores how strongly two records describe the same work, in 0-1. Agreement
 * on ISBN-13, ISBN-10, or DOI is decisive; otherwise the score is a weighted
 * blend of title, author, and year similarity.
 */
export function workMatchScore(left: WorkRecord, right: WorkRecord): number {
  if (sharesIdentifier(left.identity, right.identity)) return 1;

  const titleScore = titleSimilarity(left.title, right.title);
  // A wrong title cannot be rescued by matching authors and years.
  if (titleScore === 0) return 0;
  const authorScore = authorSimilarity(left.authors, right.authors);
  const yearScore = yearSimilarity(left.publishedYear, right.publishedYear);
  return round(titleScore * 0.6 + authorScore * 0.25 + yearScore * 0.15);
}

/**
 * Normalizes an ISBN to its digits (plus a trailing `X` for ISBN-10 check
 * digits) and validates the checksum. Returns `undefined` for anything that
 * is not a valid ISBN-10 or ISBN-13, so a stray page count or year scraped
 * out of a catalog cell can never masquerade as an identifier.
 */
export function normalizeIsbn(value: string): string | undefined {
  const compact = value.replaceAll(/[\s-]/g, "").toUpperCase();
  if (compact.length === 10 && /^\d{9}[\dX]$/.test(compact)) {
    return isValidIsbn10(compact) ? compact : undefined;
  }
  if (compact.length === 13 && /^\d{13}$/.test(compact)) {
    return isbn13CheckDigit(compact.slice(0, 12)) === compact.charAt(12) ? compact : undefined;
  }
  return undefined;
}

/**
 * Candidate ISBN runs in free text: a 13-digit form starting 978/979, or a
 * 10-digit form. Deliberately loose, because `extractIsbns` validates the
 * checksum — a catalog id or page range that merely looks like an ISBN-10 is
 * rejected there rather than here.
 */
const ISBN_CANDIDATE = /\b(?:97[89][\d\s-]{10,16}|\d{9}[\dXx])\b/g;

/**
 * Valid, normalized ISBNs appearing in free text, in order of first
 * appearance. Catalogs bury identifiers in title cells and metadata lines, so
 * every adapter needs this and every adapter needs the same answer.
 */
export function extractIsbns(value: string): string[] {
  const found: string[] = [];
  for (const match of value.matchAll(ISBN_CANDIDATE)) {
    const normalized = normalizeIsbn(match[0]);
    if (normalized !== undefined && !found.includes(normalized)) found.push(normalized);
  }
  return found;
}

/** Converts a valid ISBN-10 to its ISBN-13 form; returns `undefined` otherwise. */
export function isbn10To13(value: string): string | undefined {
  const normalized = normalizeIsbn(value);
  if (normalized === undefined || normalized.length !== 10) return undefined;
  const body = `978${normalized.slice(0, 9)}`;
  return `${body}${isbn13CheckDigit(body)}`;
}

/**
 * Splits normalized ISBNs into their 10- and 13-digit forms, preferring the
 * first of each and back-filling `isbn13` from an ISBN-10 when the catalog
 * stated only the short form.
 */
export function isbnIdentity(values: readonly string[]): {
  readonly isbn13?: string;
  readonly isbn10?: string;
} {
  let isbn13: string | undefined;
  let isbn10: string | undefined;
  for (const value of values) {
    const normalized = normalizeIsbn(value);
    if (normalized === undefined) continue;
    if (normalized.length === 13) isbn13 ??= normalized;
    else isbn10 ??= normalized;
  }
  if (isbn13 === undefined && isbn10 !== undefined) isbn13 = isbn10To13(isbn10);
  return {
    ...(isbn13 === undefined ? {} : { isbn13 }),
    ...(isbn10 === undefined ? {} : { isbn10 }),
  };
}

/** Normalizes a DOI to its bare, lowercased `10.x/y` form. */
export function normalizeDoi(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  const bare = trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .trim();
  return /^10\.\d{4,9}\/\S+$/.test(bare) ? bare : undefined;
}

/** An identity stating nothing, for catalogs that expose no identifiers. */
export function emptyWorkIdentity(): WorkIdentity {
  return { origin: "record", confidence: 1 };
}

function statusOf(page: WorksPage): WorksResult["status"] {
  if (page.items.length === 0) return page.warnings.length > 0 ? "partial" : "empty";
  return page.warnings.length > 0 ? "partial" : "ok";
}

function worksResult(
  source: WorksSource,
  options: {
    readonly status: WorksResult["status"];
    readonly page?: WorksPage;
    readonly warnings?: readonly string[];
    readonly startedAt: number;
    readonly requestUrls: readonly string[];
    readonly error?: ProviderError;
  },
): WorksResult {
  const items = options.page?.items ?? [];
  return {
    provider: source.provider,
    status: options.status,
    ...(options.page ? { page: options.page } : {}),
    items,
    recordCount: items.length,
    warnings: options.warnings ?? options.page?.warnings ?? [],
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAt,
    requestUrls: options.requestUrls,
    ...(options.error ? { error: options.error } : {}),
  };
}

function identityQuery(
  record: WorkRecord,
  options: ResolveWorkIdentityOptions,
  maxCandidates: number,
): WorksQuery | undefined {
  const title = record.title.trim();
  if (title === "") return undefined;
  const author = record.authors[0]?.trim();
  return {
    ...options,
    title,
    ...(author ? { author } : {}),
    limit: maxCandidates,
  };
}

function resolvedIdentity(
  base: WorkIdentity,
  authoritative: WorkIdentity,
  score: number,
): WorkIdentity {
  return {
    ...(authoritative.isbn13 === undefined ? {} : { isbn13: authoritative.isbn13 }),
    ...(authoritative.isbn10 === undefined ? {} : { isbn10: authoritative.isbn10 }),
    ...(authoritative.doi === undefined ? {} : { doi: authoritative.doi }),
    ...(authoritative.oclc === undefined ? {} : { oclc: authoritative.oclc }),
    ...(authoritative.lccn === undefined ? {} : { lccn: authoritative.lccn }),
    ...(authoritative.openLibraryId === undefined
      ? {}
      : { openLibraryId: authoritative.openLibraryId }),
    // The content hash belongs to the record being resolved, not to the
    // authoritative edition it matched.
    ...(base.md5 === undefined ? {} : { md5: base.md5 }),
    origin: "resolved",
    confidence: round(score),
  };
}

function hasBibliographicId(identity: WorkIdentity): boolean {
  return (
    identity.isbn13 !== undefined ||
    identity.isbn10 !== undefined ||
    identity.doi !== undefined ||
    identity.oclc !== undefined ||
    identity.lccn !== undefined
  );
}

function sharesIdentifier(left: WorkIdentity, right: WorkIdentity): boolean {
  return (
    matches(left.isbn13, right.isbn13) ||
    matches(left.isbn10, right.isbn10) ||
    matches(left.doi, right.doi) ||
    matches(left.oclc, right.oclc) ||
    matches(left.lccn, right.lccn)
  );
}

function matches(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && left === right;
}

function compareCandidates(left: WorkIdentityCandidate, right: WorkIdentityCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  return left.record.sourceId.localeCompare(right.record.sourceId);
}

function dedupeKey(record: WorkRecord): string {
  const { identity } = record;
  if (identity.isbn13 !== undefined) return `isbn13:${identity.isbn13}`;
  if (identity.doi !== undefined) return `doi:${identity.doi}`;
  if (identity.md5 !== undefined) return `md5:${identity.md5}`;
  const author = surname(record.authors[0] ?? "");
  return [
    "work",
    normalizeForCompare(record.title),
    author,
    record.publishedYear ?? "",
    record.format ?? "",
  ].join("|");
}

function mergeRecordPair(base: WorkRecord, extra: WorkRecord): WorkRecord {
  const identity =
    extra.identity.confidence > base.identity.confidence ||
    (!hasBibliographicId(base.identity) && hasBibliographicId(extra.identity))
      ? { ...extra.identity, ...(base.identity.md5 ? { md5: base.identity.md5 } : {}) }
      : base.identity;
  const subtitle = base.subtitle ?? extra.subtitle;
  const publisher = base.publisher ?? extra.publisher;
  const publishedYear = base.publishedYear ?? extra.publishedYear;
  const edition = base.edition ?? extra.edition;
  const series = base.series ?? extra.series;
  const language = base.language ?? extra.language;
  const format = base.format ?? extra.format;
  const pageCount = base.pageCount ?? extra.pageCount;
  const sizeBytes = base.sizeBytes ?? extra.sizeBytes;
  const addedAt = base.addedAt ?? extra.addedAt;
  const modifiedAt = base.modifiedAt ?? extra.modifiedAt;
  return {
    ...base,
    ...(subtitle === undefined ? {} : { subtitle }),
    authors: base.authors.length > 0 ? base.authors : extra.authors,
    ...(publisher === undefined ? {} : { publisher }),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    ...(edition === undefined ? {} : { edition }),
    ...(series === undefined ? {} : { series }),
    ...(language === undefined ? {} : { language }),
    ...(format === undefined ? {} : { format }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    identity,
    availability:
      AVAILABILITY_RANK[extra.availability] > AVAILABILITY_RANK[base.availability]
        ? extra.availability
        : base.availability,
    ...(addedAt === undefined ? {} : { addedAt }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    warnings: [...new Set([...base.warnings, ...extra.warnings])],
    provenance: uniqueProvenance([...base.provenance, ...extra.provenance]),
  };
}

/** Ordered weakest to strongest, so a merge can only widen access claims. */
const AVAILABILITY_RANK: Record<WorkAvailability, number> = {
  unknown: 0,
  "metadata-only": 1,
  preview: 2,
  borrow: 3,
  "open-access": 4,
  "public-domain": 5,
};

function titleSimilarity(left: string, right: string): number {
  const leftTokens = new Set(compareTokens(left));
  const rightTokens = new Set(compareTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) shared += 1;
  return round((2 * shared) / (leftTokens.size + rightTokens.size));
}

function authorSimilarity(left: readonly string[], right: readonly string[]): number {
  const leftNames = new Set(left.map(surname).filter(Boolean));
  const rightNames = new Set(right.map(surname).filter(Boolean));
  if (leftNames.size === 0 || rightNames.size === 0) return 0;
  for (const name of leftNames) if (rightNames.has(name)) return 1;
  return 0;
}

function yearSimilarity(left: number | undefined, right: number | undefined): number {
  if (left === undefined || right === undefined) return 0;
  const distance = Math.abs(left - right);
  if (distance === 0) return 1;
  if (distance === 1) return 0.6;
  return distance === 2 ? 0.3 : 0;
}

const COMPARE_STOP_WORDS = new Set(["a", "an", "and", "for", "of", "on", "the", "to"]);

function compareTokens(value: string): string[] {
  return normalizeForCompare(value)
    .split(" ")
    .filter((token) => token !== "" && !COMPARE_STOP_WORDS.has(token));
}

function normalizeForCompare(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function surname(value: string): string {
  const normalized = normalizeForCompare(value);
  if (normalized === "") return "";
  const parts = normalized.split(" ");
  // Catalogs mix "Austen, Jane" and "Jane Austen"; the longest trailing or
  // leading token is a poor key, so prefer the comma form when present.
  if (value.includes(",")) return parts[0] ?? "";
  return parts.at(-1) ?? "";
}

function uniqueProvenance(
  entries: readonly WorkRecordProvenance[],
): readonly WorkRecordProvenance[] {
  const seen = new Map<string, WorkRecordProvenance>();
  for (const entry of entries) seen.set(`${entry.provider}|${entry.url}`, entry);
  return [...seen.values()];
}

function isValidIsbn10(value: string): boolean {
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    const char = value.charAt(index);
    const digit = char === "X" ? 10 : Number(char);
    if (char === "X" && index !== 9) return false;
    sum += digit * (10 - index);
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(body: string): string {
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(body.charAt(index)) * (index % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

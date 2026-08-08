/**
 * Open Library adapter for the works lane: the authoritative side of identity
 * resolution.
 *
 * Library Genesis rows carry no ISBN in most layouts, so recovering one means
 * matching title, author, and year against a catalog that does state
 * identifiers. This adapter provides that catalog and maps Open Library's own
 * access signals onto `availability`: records flagged as public scans become
 * `"public-domain"`, borrowable or printdisabled editions become `"borrow"`,
 * and everything else stays `"metadata-only"`.
 */

import { XnewsFetchError } from "../errors.js";
import { fetchText } from "../http.js";
import { isRecord } from "../json.js";
import { isbnIdentity, normalizeIsbn } from "../works.js";
import {
  normalizeOpenLibraryLimit,
  normalizeOpenLibraryPage,
  OPEN_LIBRARY_BASE_URL,
  openLibraryRecordUrl,
  openLibrarySearchUrl,
  OPEN_LIBRARY_USER_AGENT,
  type OpenLibrarySearchOptions,
} from "./openlibrary.urls.js";
import type {
  SourceFetchOptions,
  WorkAvailability,
  WorkRecord,
  WorksPage,
  WorksQuery,
  WorksSource,
} from "../types.js";

export {
  openLibraryRecordUrl,
  openLibrarySearchUrl,
  OPEN_LIBRARY_BASE_URL,
  OPEN_LIBRARY_DEFAULT_LIMIT,
  OPEN_LIBRARY_MAX_LIMIT,
  OPEN_LIBRARY_SEARCH_FIELDS,
  OPEN_LIBRARY_USER_AGENT,
} from "./openlibrary.urls.js";
export type { OpenLibrarySearchOptions } from "./openlibrary.urls.js";

/** The provider name built-in Open Library records carry. */
export const OPEN_LIBRARY_PROVIDER = "open-library";

/** Fetches and parses one page of Open Library search results. */
export async function fetchOpenLibraryWorks(
  options: OpenLibrarySearchOptions & SourceFetchOptions,
): Promise<WorksPage> {
  const page = normalizeOpenLibraryPage(options.page);
  const limit = normalizeOpenLibraryLimit(options.limit);
  if (limit === 0) {
    return { items: [], page, hasMore: false, warnings: [], requestUrls: [] };
  }

  const url = openLibrarySearchUrl({ ...options, page, limit });
  const body = await fetchText(url, options, options.userAgent ?? OPEN_LIBRARY_USER_AGENT);
  return parseOpenLibraryWorks(body, { page, limit, requestUrl: url });
}

export interface OpenLibraryParseOptions {
  readonly page?: number;
  readonly limit?: number;
  readonly requestUrl?: string;
}

/** Parses a `search.json` payload into works-lane records. Pure. */
export function parseOpenLibraryWorks(
  body: string,
  options: OpenLibraryParseOptions = {},
): WorksPage {
  const page = normalizeOpenLibraryPage(options.page);
  const limit = normalizeOpenLibraryLimit(options.limit);
  const errorUrl = options.requestUrl ?? `${OPEN_LIBRARY_BASE_URL}/search.json`;
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = undefined;
  }
  if (!isRecord(payload) || Array.isArray(payload)) {
    throw openLibraryConfigError(
      "open-library: unexpected search response shape (payload must be a JSON object)",
      errorUrl,
    );
  }

  const numFound = payload["numFound"];
  if (typeof numFound !== "number" || !Number.isFinite(numFound) || numFound < 0) {
    throw openLibraryConfigError(
      "open-library: unexpected search response shape (numFound must be a non-negative number)",
      errorUrl,
    );
  }
  const docs = payload["docs"];
  if (!Array.isArray(docs)) {
    throw openLibraryConfigError(
      "open-library: unexpected search response shape (docs must be an array)",
      errorUrl,
    );
  }

  const offset = (page - 1) * limit;
  if (docs.length === 0 && offset < numFound) {
    throw openLibraryConfigError(
      "open-library: search response returned no docs while results remain",
      errorUrl,
    );
  }

  const warnings: string[] = [];
  const items: WorkRecord[] = [];
  for (const value of docs) {
    if (!isRecord(value) || Array.isArray(value)) {
      warnings.push("open-library: skipped a result that was not an object");
      continue;
    }
    const record = parseDoc(value, warnings);
    if (record !== undefined) items.push(record);
  }

  if (docs.length > 0 && items.length === 0) {
    throw openLibraryConfigError(
      "open-library: search response contained no valid records",
      errorUrl,
    );
  }

  return {
    items,
    page,
    hasMore: offset + docs.length < numFound,
    totalCount: numFound,
    warnings,
    requestUrls: options.requestUrl === undefined ? [] : [options.requestUrl],
  };
}

/**
 * Binds Open Library to the works lane. Pass this as the authoritative source
 * to `resolveWorkIdentity`, or query it directly through `searchWorks`.
 */
export function openLibrarySource(options: SourceFetchOptions = {}): WorksSource {
  return {
    provider: OPEN_LIBRARY_PROVIDER,
    requestUrls(query) {
      const resolved = searchOptions(query, options);
      normalizeOpenLibraryPage(resolved.page);
      if (normalizeOpenLibraryLimit(resolved.limit) === 0) return [];
      return [openLibrarySearchUrl(resolved)];
    },
    async search(query) {
      return fetchOpenLibraryWorks({ ...options, ...searchOptions(query, options) });
    },
  };
}

function searchOptions(
  query: WorksQuery,
  base: SourceFetchOptions,
): OpenLibrarySearchOptions & SourceFetchOptions {
  return {
    ...base,
    ...(query.query === undefined ? {} : { query: query.query }),
    ...(query.title === undefined ? {} : { title: query.title }),
    ...(query.author === undefined ? {} : { author: query.author }),
    ...(query.isbn === undefined ? {} : { isbn: query.isbn }),
    ...(query.page === undefined ? {} : { page: query.page }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

function parseDoc(doc: Record<string, unknown>, pageWarnings: string[]): WorkRecord | undefined {
  const key = stringField(doc["key"]);
  const title = stringField(doc["title"]);
  if (key === undefined || title === undefined) {
    pageWarnings.push("open-library: skipped a result without a key or title");
    return undefined;
  }

  const warnings: string[] = [];
  const subtitle = optionalString(doc["subtitle"], "subtitle", key, warnings);
  const authors = stringValues(doc["author_name"], "author_name", key, warnings);
  const publisher = stringValues(doc["publisher"], "publisher", key, warnings)[0];
  const language = stringValues(doc["language"], "language", key, warnings)[0];
  const publishedYear = positiveInteger(
    doc["first_publish_year"],
    "first_publish_year",
    key,
    warnings,
  );
  const pageCount = positiveInteger(
    doc["number_of_pages_median"],
    "number_of_pages_median",
    key,
    warnings,
  );
  const isbns = validIsbns(doc["isbn"], key, warnings);
  const identity = {
    ...isbnIdentity(isbns),
    ...firstIdentifier("oclc", stringValues(doc["oclc"], "oclc", key, warnings)),
    ...firstIdentifier("lccn", stringValues(doc["lccn"], "lccn", key, warnings)),
    openLibraryId: key,
    origin: "record" as const,
    confidence: 1,
  };
  const availability = readAvailability(doc, key, warnings);
  const url = openLibraryRecordUrl(key);
  pageWarnings.push(...warnings);

  return {
    provider: OPEN_LIBRARY_PROVIDER,
    sourceId: key,
    title,
    ...(subtitle === undefined ? {} : { subtitle }),
    authors,
    ...(publisher === undefined ? {} : { publisher }),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    ...(language === undefined ? {} : { language }),
    ...(pageCount === undefined ? {} : { pageCount }),
    identity,
    availability,
    url,
    warnings,
    provenance: [{ provider: OPEN_LIBRARY_PROVIDER, url }],
  };
}

function readAvailability(
  doc: Record<string, unknown>,
  key: string,
  warnings: string[],
): WorkAvailability {
  const publicScan = doc["public_scan_b"];
  if (publicScan !== undefined && publicScan !== null && typeof publicScan !== "boolean") {
    warnings.push(`open-library ${key}: ignored invalid public_scan_b ${displayValue(publicScan)}`);
  }
  const access = optionalString(doc["ebook_access"], "ebook_access", key, warnings);
  if (publicScan === true || access === "public") return "public-domain";
  if (access === "borrowable" || access === "printdisabled") return "borrow";
  // Open Library indexes editions it does not host; absent a positive access
  // signal the honest answer is that only metadata is available here.
  return "metadata-only";
}

function firstIdentifier(
  field: "oclc" | "lccn",
  values: readonly string[],
): Record<string, string> {
  const value = values[0];
  return value === undefined ? {} : { [field]: value };
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function optionalString(
  value: unknown,
  field: string,
  key: string,
  warnings: string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = stringField(value);
  if (text !== undefined) return text;
  warnings.push(`open-library ${key}: ignored invalid ${field} ${displayValue(value)}`);
  return undefined;
}

function positiveInteger(
  value: unknown,
  field: string,
  key: string,
  warnings: string[],
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  warnings.push(`open-library ${key}: ignored invalid ${field} ${displayValue(value)}`);
  return undefined;
}

function stringValues(value: unknown, field: string, key: string, warnings: string[]): string[] {
  if (value === undefined || value === null) return [];
  const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (entries === undefined) {
    warnings.push(`open-library ${key}: ignored non-string ${field} ${displayValue(value)}`);
    return [];
  }

  const values: string[] = [];
  let invalid = false;
  for (const entry of entries) {
    const text = stringField(entry);
    if (text === undefined) {
      invalid = true;
      continue;
    }
    if (!values.includes(text)) values.push(text);
  }
  if (invalid) {
    warnings.push(`open-library ${key}: ignored invalid entries in ${field}`);
  }
  return values;
}

function validIsbns(value: unknown, key: string, warnings: string[]): string[] {
  const values = stringValues(value, "isbn", key, warnings);
  const isbns: string[] = [];
  for (const stated of values) {
    const normalized = normalizeIsbn(stated);
    if (normalized === undefined) {
      warnings.push(`open-library ${key}: ignored invalid isbn ${displayValue(stated)}`);
      continue;
    }
    if (!isbns.includes(normalized)) isbns.push(normalized);
  }
  return isbns;
}

function displayValue(value: unknown): string {
  const displayed = JSON.stringify(value);
  return displayed === undefined ? String(value) : displayed;
}

function openLibraryConfigError(message: string, url: string): XnewsFetchError {
  return new XnewsFetchError("config", message, { url });
}

/**
 * Looks up one ISBN and returns the matching record, for callers that already
 * hold an identifier and want the authoritative edition behind it.
 */
export async function fetchOpenLibraryByIsbn(
  isbn: string,
  options: SourceFetchOptions = {},
): Promise<WorkRecord | undefined> {
  const normalized = normalizeIsbn(isbn);
  if (normalized === undefined) return undefined;
  const page = await fetchOpenLibraryWorks({ ...options, isbn: normalized, limit: 1 });
  return page.items[0];
}

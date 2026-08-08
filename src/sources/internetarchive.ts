/**
 * Internet Archive adapter for the works lane. The adapter uses the official
 * advanced-search JSON API for metadata and reports only access rights the
 * Archive explicitly states: lending collections are borrowable, rights URLs
 * distinguish public-domain from other open-access items, and absent rights
 * metadata remains unknown.
 */

import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { isRecord } from "../json.js";
import { isbnIdentity, normalizeIsbn } from "../works.js";
import {
  INTERNET_ARCHIVE_BASE_URL,
  internetArchiveRecordUrl,
  internetArchiveSearchUrl,
  normalizeInternetArchivePage,
  normalizeInternetArchiveRows,
  type InternetArchiveSearchOptions,
} from "./internetarchive.urls.js";
import type {
  SourceFetchOptions,
  WorkAvailability,
  WorkIdentity,
  WorkRecord,
  WorksPage,
  WorksQuery,
  WorksSource,
} from "../types.js";

export {
  INTERNET_ARCHIVE_BASE_URL,
  INTERNET_ARCHIVE_DEFAULT_ROWS,
  INTERNET_ARCHIVE_MAX_ROWS,
  INTERNET_ARCHIVE_SEARCH_FIELDS,
  internetArchiveRecordUrl,
  internetArchiveSearchUrl,
} from "./internetarchive.urls.js";
export type { InternetArchiveSearchOptions } from "./internetarchive.urls.js";

/** The provider name built-in Internet Archive records carry. */
export const INTERNET_ARCHIVE_PROVIDER = "internet-archive";

/** Fetches and parses one page of official Internet Archive search results. */
export async function fetchInternetArchiveWorks(
  options: InternetArchiveSearchOptions & SourceFetchOptions,
): Promise<WorksPage> {
  assertSearchTerms(options);
  const page = normalizeInternetArchivePage(options.page);
  const rows = normalizeInternetArchiveRows(options.limit);
  if (rows === 0) {
    return {
      items: [],
      page,
      hasMore: false,
      warnings: [],
      requestUrls: [],
    };
  }
  const url = internetArchiveSearchUrl(options);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseInternetArchiveWorks(body, { page, requestUrl: url });
}

export interface InternetArchiveParseOptions {
  readonly page?: number;
  readonly requestUrl?: string;
}

/** Parses an `advancedsearch.php` JSON payload into works-lane records. Pure. */
export function parseInternetArchiveWorks(
  body: string,
  options: InternetArchiveParseOptions = {},
): WorksPage {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = undefined;
  }

  const response = isRecord(payload) ? payload["response"] : undefined;
  const docsValue = isRecord(response) ? response["docs"] : undefined;
  const errorUrl = options.requestUrl ?? `${INTERNET_ARCHIVE_BASE_URL}/advancedsearch.php`;
  if (!isRecord(response) || !Array.isArray(docsValue)) {
    throw new XnewsFetchError(
      "config",
      "internet-archive: unexpected advanced-search response shape (response.docs must be an array)",
      { url: errorUrl },
    );
  }

  if (docsValue.length > 0 && !docsValue.some(isRecord)) {
    throw new XnewsFetchError(
      "config",
      "internet-archive: advanced-search response.docs contained no record objects",
      { url: errorUrl },
    );
  }

  const warnings: string[] = [];
  const numFound = response["numFound"];
  const totalCount =
    typeof numFound === "number" && Number.isSafeInteger(numFound) && numFound >= 0
      ? numFound
      : undefined;
  if (totalCount === undefined) {
    warnings.push("internet-archive: response numFound was missing or not a non-negative integer");
  }
  const rawStart = response["start"];
  const start =
    typeof rawStart === "number" && Number.isSafeInteger(rawStart) && rawStart >= 0
      ? rawStart
      : undefined;
  if (start === undefined) {
    warnings.push("internet-archive: response start was missing or not a non-negative integer");
  }

  if (
    docsValue.length === 0 &&
    !(totalCount === 0 || (totalCount !== undefined && start !== undefined && start >= totalCount))
  ) {
    throw new XnewsFetchError(
      "config",
      "internet-archive: advanced-search returned empty docs while claiming unread results",
      { url: errorUrl },
    );
  }

  const items: WorkRecord[] = [];
  for (const value of docsValue) {
    if (!isRecord(value)) {
      warnings.push("internet-archive: skipped a result that was not an object");
      continue;
    }
    const record = parseDoc(value, warnings);
    if (record !== undefined) items.push(record);
  }

  if (docsValue.length > 0 && items.length === 0) {
    throw new XnewsFetchError(
      "config",
      "internet-archive: advanced-search response contained no valid records",
      { url: errorUrl },
    );
  }

  const page = normalizeInternetArchivePage(options.page);
  return {
    items,
    page,
    hasMore:
      totalCount !== undefined && start !== undefined && start + docsValue.length < totalCount,
    ...(totalCount === undefined ? {} : { totalCount }),
    warnings,
    requestUrls: options.requestUrl === undefined ? [] : [options.requestUrl],
  };
}

/** Binds the official Internet Archive catalog API to the works lane. */
export function internetArchiveSource(options: SourceFetchOptions = {}): WorksSource {
  return {
    provider: INTERNET_ARCHIVE_PROVIDER,
    requestUrls(query) {
      const resolved = searchOptions(query, options);
      assertSearchTerms(resolved);
      const url = internetArchiveSearchUrl(resolved);
      return resolved.limit === 0 ? [] : [url];
    },
    async search(query) {
      return fetchInternetArchiveWorks(searchOptions(query, options));
    },
  };
}

function searchOptions(
  query: WorksQuery,
  base: SourceFetchOptions,
): InternetArchiveSearchOptions & SourceFetchOptions {
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

function assertSearchTerms(options: InternetArchiveSearchOptions): void {
  const query = options.query?.trim() ?? "";
  const title = options.title?.trim() ?? "";
  const author = options.author?.trim() ?? "";
  const isbn = options.isbn?.trim() ?? "";
  if (query !== "" || title !== "" || author !== "" || isbn !== "") return;

  throw new XnewsFetchError(
    "config",
    "Internet Archive needs a non-empty query, title, author, or isbn",
    { url: `${INTERNET_ARCHIVE_BASE_URL}/advancedsearch.php` },
  );
}

function parseDoc(doc: Record<string, unknown>, pageWarnings: string[]): WorkRecord | undefined {
  const rawIdentifier = doc["identifier"];
  const rawTitle = doc["title"];
  const identifier = typeof rawIdentifier === "string" ? rawIdentifier.trim() : "";
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (identifier === "" || title === "") {
    pageWarnings.push("internet-archive: skipped a result without an identifier or title");
    return undefined;
  }

  const warnings: string[] = [];
  const isbns: string[] = [];
  for (const statedIsbn of stringValues(doc["isbn"], "isbn", identifier, warnings)) {
    const isbn = normalizeIsbn(statedIsbn);
    if (isbn === undefined) {
      warnings.push(
        `internet-archive ${identifier}: ignored invalid isbn ${displayValue(statedIsbn)}`,
      );
    } else if (!isbns.includes(isbn)) {
      isbns.push(isbn);
    }
  }
  const oclc = stringValues(doc["oclc-id"], "oclc-id", identifier, warnings)[0];
  const lccn = stringValues(doc["lccn"], "lccn", identifier, warnings)[0];
  const identity: WorkIdentity = {
    ...isbnIdentity(isbns),
    ...(oclc === undefined ? {} : { oclc }),
    ...(lccn === undefined ? {} : { lccn }),
    origin: "record",
    confidence: 1,
  };

  const authors = stringValues(doc["creator"], "creator", identifier, warnings);
  const publisher = optionalString(doc["publisher"], "publisher", identifier, warnings);
  const language = stringValues(doc["language"], "language", identifier, warnings)[0];
  const publishedYear = positiveInteger(doc["year"], "year", identifier, warnings);
  const pageCount = nonNegativeInteger(doc["imagecount"], "imagecount", identifier, warnings);
  const sizeBytes = nonNegativeInteger(doc["item_size"], "item_size", identifier, warnings);
  const formats = stringValues(doc["format"], "format", identifier, warnings);
  const format = primaryFormat(formats);
  const collections = stringValues(doc["collection"], "collection", identifier, warnings);
  const licenseUrl = optionalString(doc["licenseurl"], "licenseurl", identifier, warnings);
  const addedAt =
    catalogInstant(doc["addeddate"], "addeddate", identifier, warnings) ??
    catalogInstant(doc["publicdate"], "publicdate", identifier, warnings);
  const url = internetArchiveRecordUrl(identifier);

  return {
    provider: INTERNET_ARCHIVE_PROVIDER,
    sourceId: identifier,
    title,
    authors,
    ...(publisher === undefined ? {} : { publisher }),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    ...(language === undefined ? {} : { language }),
    ...(format === undefined ? {} : { format }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    identity,
    availability: readAvailability(collections, licenseUrl),
    url,
    ...(addedAt === undefined ? {} : { addedAt }),
    warnings,
    provenance: [{ provider: INTERNET_ARCHIVE_PROVIDER, url }],
  };
}

function readAvailability(
  collections: readonly string[],
  licenseUrl: string | undefined,
): WorkAvailability {
  let printDisabled = false;
  for (const collection of collections) {
    const normalized = collection.toLowerCase();
    if (normalized === "inlibrary" || normalized === "lendinglibrary") return "borrow";
    if (normalized === "printdisabled") printDisabled = true;
  }
  if (printDisabled) return "borrow";
  if (licenseUrl === undefined) return "unknown";

  let url: URL;
  try {
    url = new URL(licenseUrl);
  } catch {
    return "unknown";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "unknown";

  const host = url.hostname.toLowerCase();
  if (host === "creativecommons.org" || host.endsWith(".creativecommons.org")) {
    if (/^\/publicdomain\/(?:mark|zero)\/\d+(?:\.\d+)?\/?$/i.test(url.pathname)) {
      return "public-domain";
    }
    if (
      /^\/licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/(?:1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/|$)/i.test(
        url.pathname,
      )
    ) {
      return "open-access";
    }
    return "unknown";
  }

  if (host === "rightsstatements.org" || host.endsWith(".rightsstatements.org")) {
    return /^\/vocab\/(?:NoC-CR|NoC-NC|NoC-OKLR|NoC-US|PDM)\/1\.0\/?$/.test(url.pathname)
      ? "public-domain"
      : "unknown";
  }
  return "unknown";
}

/**
 * Internet Archive format tokens are prose, not extensions, and one item
 * carries many. This maps the readable ones onto a file extension.
 *
 * DRM-wrapped variants are deliberately absent: `ACS Encrypted PDF` and
 * `LCP Encrypted EPUB` are common on lending items, and reporting them as
 * `pdf`/`epub` would promise a readable file that no plain reader can open.
 * They are excluded explicitly below rather than by omission, so a later
 * token addition cannot let one back in by accident.
 */
const PRIMARY_FORMATS: Readonly<Record<string, PrimaryFormat>> = {
  epub: "epub",
  epub3: "epub",
  pdf: "pdf",
  "text pdf": "pdf",
  "additional text pdf": "pdf",
  "image container pdf": "pdf",
  "grayscale pdf": "pdf",
  djvu: "djvu",
  txt: "txt",
  text: "txt",
  "plain text": "txt",
  "full text": "txt",
  // `DjVuTXT` and `Djvu XML` are OCR sidecars every scanned item carries, not
  // a distributable edition. Mapping them would report `txt` for most of the
  // scanned corpus and hide that no primary artifact was stated.
  mobi: "mobi",
  azw3: "azw3",
  "word document": "doc",
  "opendocument text document": "odt",
  rtf: "rtf",
  "comic book rar": "cbr",
  "comic book zip": "cbz",
};

type PrimaryFormat =
  | "epub"
  | "pdf"
  | "djvu"
  | "txt"
  | "mobi"
  | "azw3"
  | "doc"
  | "odt"
  | "rtf"
  | "cbr"
  | "cbz";

/** Reader-hostile wrappers that must never be reported as their base format. */
const DRM_FORMAT = /\b(?:acs|lcp|adobe)\b.*\bencrypted\b|\bencrypted\b.*\b(?:epub|pdf)\b/i;

/** Most useful first: a caller picking one format wants the reflowable one. */
const FORMAT_PREFERENCE: readonly PrimaryFormat[] = [
  "epub",
  "azw3",
  "mobi",
  "pdf",
  "djvu",
  "cbz",
  "cbr",
  "odt",
  "doc",
  "rtf",
  "txt",
];

function primaryFormat(formats: readonly string[]): string | undefined {
  const mapped = new Set<PrimaryFormat>();
  for (const value of formats) {
    if (DRM_FORMAT.test(value)) continue;
    const format = PRIMARY_FORMATS[value.trim().toLowerCase()];
    if (format !== undefined) mapped.add(format);
  }
  return FORMAT_PREFERENCE.find((format) => mapped.has(format));
}

function stringValues(
  value: unknown,
  field: string,
  identifier: string,
  warnings: string[],
): string[] {
  if (value === undefined || value === null) return [];
  const entries = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (entries === undefined) {
    warnings.push(`internet-archive ${identifier}: ignored non-string ${field}`);
    return [];
  }

  const values: string[] = [];
  let invalid = false;
  for (const entry of entries) {
    if (typeof entry !== "string") {
      invalid = true;
      continue;
    }
    const text = entry.trim();
    if (text !== "" && !values.includes(text)) values.push(text);
  }
  if (invalid) {
    warnings.push(`internet-archive ${identifier}: ignored non-string entries in ${field}`);
  }
  return values;
}

function optionalString(
  value: unknown,
  field: string,
  identifier: string,
  warnings: string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    warnings.push(`internet-archive ${identifier}: ignored invalid ${field}`);
    return undefined;
  }
  return value.trim();
}

function positiveInteger(
  value: unknown,
  field: string,
  identifier: string,
  warnings: string[],
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  warnings.push(`internet-archive ${identifier}: ignored invalid ${field} ${displayValue(value)}`);
  return undefined;
}

function nonNegativeInteger(
  value: unknown,
  field: string,
  identifier: string,
  warnings: string[],
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  warnings.push(`internet-archive ${identifier}: ignored invalid ${field} ${displayValue(value)}`);
  return undefined;
}

/**
 * Normalizes a catalog ingest timestamp through the package's one date
 * derivation. An `engine`-tagged result is refused: the engine fallback
 * accepts a bare year, and a bibliographic year is not an ingest instant.
 */
function catalogInstant(
  value: unknown,
  field: string,
  identifier: string,
  warnings: string[],
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "string" ? value.trim() : "";
  const parsed = text === "" ? null : parsePublishedAt(text);
  if (parsed !== null && parsed.format !== "engine") return parsed.instant;

  warnings.push(`internet-archive ${identifier}: ignored invalid ${field} ${displayValue(value)}`);
  return undefined;
}

function displayValue(value: unknown): string {
  const displayed = JSON.stringify(value);
  return displayed === undefined ? String(value) : displayed;
}

/**
 * Internet Archive URL builders. These carry a real origin because
 * advancedsearch.php is the Internet Archive's stable, official JSON catalog
 * API (https://archive.org/advancedsearch.php).
 */

import { XnewsFetchError } from "../errors.js";

/** Stable origin for the official Internet Archive catalog and detail pages. */
export const INTERNET_ARCHIVE_BASE_URL = "https://archive.org";

/** Fields the advanced-search API returns that this adapter reads. */
export const INTERNET_ARCHIVE_SEARCH_FIELDS = [
  "identifier",
  "title",
  "creator",
  "date",
  "addeddate",
  "publicdate",
  "year",
  "publisher",
  "language",
  "mediatype",
  "isbn",
  "oclc-id",
  "lccn",
  "licenseurl",
  "item_size",
  "imagecount",
  "downloads",
  "collection",
  "format",
  "subject",
  "description",
] as const;

export const INTERNET_ARCHIVE_MAX_ROWS = 100;
export const INTERNET_ARCHIVE_DEFAULT_ROWS = 25;

export interface InternetArchiveSearchOptions {
  /** Free-text query across the Archive's metadata index. */
  readonly query?: string;
  readonly title?: string;
  readonly author?: string;
  readonly isbn?: string;
  /** 1-based result page; defaults to 1. */
  readonly page?: number;
  /** Rows per page, capped at 100; defaults to 25. */
  readonly limit?: number;
}

/**
 * Builds an official advanced-search URL. Every query is constrained to the
 * texts media type so broad catalog terms cannot admit audio or video items.
 */
export function internetArchiveSearchUrl(options: InternetArchiveSearchOptions): string {
  const url = new URL("/advancedsearch.php", INTERNET_ARCHIVE_BASE_URL);
  const terms: string[] = [];

  // A bare multi-word term is ORed by the search backend, which floods a
  // bibliographic lookup with periodicals that merely mention one word.
  // Quoting makes it a phrase: "dune messiah" cuts 33 matches down to 28,
  // and the title-scoped form to 11.
  const freeText = options.query?.trim();
  if (freeText !== undefined && freeText !== "") terms.push(quoteTerm(freeText));
  appendScopedTerm(terms, "title", options.title);
  appendScopedTerm(terms, "creator", options.author);
  appendScopedTerm(terms, "isbn", options.isbn);
  terms.push("mediatype:texts");

  url.searchParams.set("q", terms.join(" AND "));
  for (const field of INTERNET_ARCHIVE_SEARCH_FIELDS) {
    url.searchParams.append("fl[]", field);
  }
  url.searchParams.set("rows", String(normalizeInternetArchiveRows(options.limit)));
  url.searchParams.set("page", String(normalizeInternetArchivePage(options.page)));
  url.searchParams.set("output", "json");
  return url.toString();
}

/** Canonical human-facing detail URL for one Internet Archive identifier. */
export function internetArchiveRecordUrl(identifier: string): string {
  return new URL(
    `/details/${encodeURIComponent(identifier)}`,
    INTERNET_ARCHIVE_BASE_URL,
  ).toString();
}

function appendScopedTerm(
  terms: string[],
  field: "title" | "creator" | "isbn",
  value: string | undefined,
): void {
  const term = value?.trim();
  if (term === undefined || term === "") return;
  terms.push(`${field}:(${quoteTerm(term)})`);
}

/**
 * Wraps a term as a Lucene phrase. Backslashes and quotes are escaped first
 * so a quote in user input cannot break out of the phrase and inject syntax.
 */
function quoteTerm(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function normalizeInternetArchiveRows(rows: number | undefined): number {
  if (rows === undefined) return INTERNET_ARCHIVE_DEFAULT_ROWS;
  if (!Number.isInteger(rows) || rows < 0) {
    throw new XnewsFetchError(
      "config",
      `limit must be a non-negative integer; received ${String(rows)}`,
      { url: `${INTERNET_ARCHIVE_BASE_URL}/advancedsearch.php` },
    );
  }
  return Math.min(rows, INTERNET_ARCHIVE_MAX_ROWS);
}

export function normalizeInternetArchivePage(page: number | undefined): number {
  if (page === undefined) return 1;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new XnewsFetchError(
      "config",
      `page must be a positive integer; received ${String(page)}`,
      { url: `${INTERNET_ARCHIVE_BASE_URL}/advancedsearch.php` },
    );
  }
  return page;
}

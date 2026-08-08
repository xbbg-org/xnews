/**
 * Open Library URL builders. Unlike the Library Genesis adapter, these carry
 * a real origin: Open Library is a stable, documented, public-good API
 * (https://openlibrary.org/developers/api) and is the works lane's
 * authoritative side for ISBN/OCLC/LCCN resolution.
 */

import { XnewsFetchError } from "../errors.js";

const OPEN_LIBRARY_BASE_URL = "https://openlibrary.org";

export { OPEN_LIBRARY_BASE_URL };

/**
 * Open Library asks that frequent callers identify themselves so they can be
 * given a higher request allowance than anonymous traffic.
 */
export const OPEN_LIBRARY_USER_AGENT =
  "@xbbg/xnews Open Library adapter (+https://github.com/xbbg-org/xnews)";

/** Fields the search API returns that this adapter reads. */
export const OPEN_LIBRARY_SEARCH_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "first_publish_year",
  "publish_year",
  "publisher",
  "language",
  "number_of_pages_median",
  "isbn",
  "oclc",
  "lccn",
  "edition_key",
  "ebook_access",
  "public_scan_b",
] as const;

export interface OpenLibrarySearchOptions {
  /** Free-text query across all indexed fields. */
  readonly query?: string;
  readonly title?: string;
  readonly author?: string;
  readonly isbn?: string;
  /** 1-based page; defaults to 1. */
  readonly page?: number;
  /** Rows per page, capped at 100 by the API; defaults to 10. */
  readonly limit?: number;
}

export const OPEN_LIBRARY_MAX_LIMIT = 100;
export const OPEN_LIBRARY_DEFAULT_LIMIT = 10;

/**
 * Builds a search URL. Field-scoped terms (`title`, `author`, `isbn`) are sent
 * as their own parameters rather than folded into `q`, which is what makes the
 * result set tight enough for identity resolution to be meaningful.
 */
export function openLibrarySearchUrl(options: OpenLibrarySearchOptions): string {
  const limit = normalizeOpenLibraryLimit(options.limit);
  const page = normalizeOpenLibraryPage(options.page);
  const isbn = options.isbn?.trim() ?? "";
  const title = options.title?.trim() ?? "";
  const author = options.author?.trim() ?? "";
  const query = options.query?.trim() ?? "";
  if (isbn === "" && title === "" && author === "" && query === "") {
    throw new XnewsFetchError(
      "config",
      "Open Library needs a non-empty query, title, author, or isbn",
      { url: `${OPEN_LIBRARY_BASE_URL}/search.json` },
    );
  }

  const url = new URL("/search.json", OPEN_LIBRARY_BASE_URL);
  if (isbn !== "") url.searchParams.set("isbn", isbn);
  if (title !== "") url.searchParams.set("title", title);
  if (author !== "") url.searchParams.set("author", author);
  if (query !== "") url.searchParams.set("q", query);
  url.searchParams.set("fields", OPEN_LIBRARY_SEARCH_FIELDS.join(","));
  url.searchParams.set("limit", String(limit));
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

/** Canonical human-facing URL for an Open Library work or edition key. */
export function openLibraryRecordUrl(key: string): string {
  const path = key.startsWith("/") ? key : `/works/${key}`;
  return new URL(path, OPEN_LIBRARY_BASE_URL).toString();
}

/** Validates and caps the page size shared by URL construction and parsing. */
export function normalizeOpenLibraryLimit(limit: number | undefined): number {
  if (limit === undefined) return OPEN_LIBRARY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new XnewsFetchError("config", `limit must be a non-negative integer; received ${limit}`, {
      url: `${OPEN_LIBRARY_BASE_URL}/search.json`,
    });
  }
  return Math.min(limit, OPEN_LIBRARY_MAX_LIMIT);
}

/** Validates the API's 1-based page number. */
export function normalizeOpenLibraryPage(page: number | undefined): number {
  if (page === undefined) return 1;
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new XnewsFetchError("config", `page must be a positive integer; received ${page}`, {
      url: `${OPEN_LIBRARY_BASE_URL}/search.json`,
    });
  }
  return page;
}

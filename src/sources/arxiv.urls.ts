import { normalizeLimit } from "../options.js";
import type { SourceFetchOptions } from "../types.js";
/**
 * arXiv asks legacy API clients making consecutive calls to leave at least
 * three seconds between requests.
 */
export const ARXIV_MIN_REQUEST_INTERVAL_MS = 3_000;

export type ArxivCategoryFeedFormat = "atom" | "rss";
export type ArxivCategories = string | readonly string[];
export type ArxivSearchSortBy = "relevance" | "lastUpdatedDate" | "submittedDate";
export type ArxivSearchSortOrder = "ascending" | "descending";

/** Options represented in an arXiv legacy API query URL. */
export interface ArxivSearchUrlOptions {
  readonly start?: number;
  readonly limit?: number;
  readonly sortBy?: ArxivSearchSortBy;
  readonly sortOrder?: ArxivSearchSortOrder;
}

/** Transport and query options for {@link fetchArxivPapers}. */
export interface ArxivSearchOptions extends SourceFetchOptions {
  readonly start?: number;
  readonly sortBy?: ArxivSearchSortBy;
  readonly sortOrder?: ArxivSearchSortOrder;
}

/** Transport and feed-format options for {@link fetchArxivAnnouncements}. */
export interface ArxivAnnouncementOptions extends SourceFetchOptions {
  readonly format?: ArxivCategoryFeedFormat;
}

/**
 * Builds an official daily arXiv category-announcement feed URL. Pass an array
 * to request multiple categories; arXiv joins them with `+` in the path.
 */
export function arxivCategoryFeedUrl(
  categories: ArxivCategories,
  format: ArxivCategoryFeedFormat = "atom",
): string {
  const values = (typeof categories === "string" ? [categories] : categories)
    .map((category) => category.trim())
    .filter(Boolean);
  if (values.length === 0) throw new TypeError("At least one arXiv category is required");
  return `https://rss.arxiv.org/${format}/${values.map(encodeURIComponent).join("+")}`;
}

/** Builds a query URL for arXiv's legacy Atom search API. */
export function arxivSearchUrl(query: string, options: ArxivSearchUrlOptions = {}): string {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new TypeError("arXiv search query is required");

  const limit = normalizeLimit(options.limit);
  if (options.start !== undefined && (!Number.isInteger(options.start) || options.start < 0)) {
    throw new RangeError("start must be a non-negative integer");
  }

  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", normalizedQuery);
  if (options.start !== undefined) url.searchParams.set("start", String(options.start));
  if (limit !== undefined) url.searchParams.set("max_results", String(limit));
  if (options.sortBy !== undefined) url.searchParams.set("sortBy", options.sortBy);
  if (options.sortOrder !== undefined) url.searchParams.set("sortOrder", options.sortOrder);
  return url.toString();
}

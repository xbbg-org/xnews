import type { SourceFetchOptions } from "../types.js";

export const EUROPE_PMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";

export interface EuropePmcSearchUrlOptions {
  readonly pageSize?: number;
  readonly cursorMark?: string;
  readonly resultType?: "lite" | "core";
  /** Europe PMC sort expression, for example `P_PDATE_D desc`. */
  readonly sort?: string;
  readonly synonym?: boolean;
}

export interface EuropePmcSearchOptions extends SourceFetchOptions, EuropePmcSearchUrlOptions {}

export function europePmcSearchUrl(query: string, options: EuropePmcSearchUrlOptions = {}): string {
  if (!query.trim()) throw new TypeError("Europe PMC search query is required");
  if (
    options.pageSize !== undefined &&
    (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 1_000)
  ) {
    throw new RangeError("pageSize must be an integer between 1 and 1000");
  }

  const url = new URL(EUROPE_PMC_SEARCH_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  if (options.pageSize !== undefined) {
    url.searchParams.set("pageSize", String(options.pageSize));
  }
  if (options.cursorMark !== undefined) url.searchParams.set("cursorMark", options.cursorMark);
  if (options.resultType !== undefined) url.searchParams.set("resultType", options.resultType);
  if (options.sort !== undefined) url.searchParams.set("sort", options.sort);
  if (options.synonym !== undefined) url.searchParams.set("synonym", String(options.synonym));
  return url.toString();
}

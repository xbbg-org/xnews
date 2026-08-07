import type { SourceFetchOptions } from "../types.js";

export interface SecFullTextOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
}

/** SEC EDGAR full-text search (https://efts.sec.gov/LATEST/search-index?q=...). */
export function secFullTextSearchUrl(
  query: string,
  options: Pick<SecFullTextOptions, "forms" | "since" | "until" | "ticker"> = {},
): string {
  const url = new URL("https://efts.sec.gov/LATEST/search-index");
  url.searchParams.set("q", `"${query.replace(/"/g, "")}"`);
  if (options.ticker) {
    // EFTS resolves tickers and company names to an entity server-side; a
    // bare CIK number matches only in its zero-padded ten-digit form.
    const entity = options.ticker.trim();
    url.searchParams.set("entityName", /^\d+$/.test(entity) ? entity.padStart(10, "0") : entity);
  }
  if (options.forms?.length) url.searchParams.set("forms", options.forms.join(","));
  const since = toDateOnly(options.since);
  const until = toDateOnly(options.until);
  if (since || until) {
    url.searchParams.set("dateRange", "custom");
    if (since) url.searchParams.set("startdt", since);
    if (until) url.searchParams.set("enddt", until);
  }
  return url.toString();
}

function toDateOnly(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

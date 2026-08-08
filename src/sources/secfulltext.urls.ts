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

/** One curated EDGAR full-text query for management-commentary documents. */
export interface SecCommentaryQuery {
  /** Phrase passed to `secFullTextSearchUrl` (quoted server-side). */
  readonly query: string;
  readonly forms: readonly string[];
  readonly description: string;
}

/**
 * Curated full-text queries that surface company commentary beyond earnings
 * calls: prepared remarks, fireside chats, and investor-day materials are
 * routinely furnished as 8-K exhibits under Reg FD. Feed each entry to
 * `fetchSecFullTextFilings(entry.query, { forms: entry.forms, ... })`.
 */
export const SEC_COMMENTARY_QUERIES = [
  {
    query: "prepared remarks",
    forms: ["8-K"],
    description: "Prepared management remarks furnished as 8-K exhibits",
  },
  {
    query: "earnings call transcript",
    forms: ["8-K"],
    description: "Full call transcripts furnished as 8-K exhibits",
  },
  {
    query: "fireside chat",
    forms: ["8-K"],
    description: "Conference fireside-chat transcripts and materials",
  },
  {
    query: "investor day",
    forms: ["8-K"],
    description: "Investor-day presentations, transcripts, and related materials",
  },
] as const satisfies readonly SecCommentaryQuery[];

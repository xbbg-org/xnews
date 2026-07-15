import { fetchText } from "../http";
import { parseAtomEntries } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

/** CourtListener search feed (https://www.courtlistener.com, Free Law Project). */
export function courtListenerSearchUrl(
  query: string,
  options: Pick<SourceFetchOptions, "since" | "until"> = {},
): string {
  const url = new URL("https://www.courtlistener.com/feed/search/");
  url.searchParams.set("q", query.includes(" ") ? `"${query.replace(/"/g, "")}"` : query);
  url.searchParams.set("type", "o");
  url.searchParams.set("order_by", "dateFiled desc");
  const since = toDateOnly(options.since);
  const until = toDateOnly(options.until);
  if (since) url.searchParams.set("filed_after", since);
  if (until) url.searchParams.set("filed_before", until);
  return url.toString();
}

export async function fetchCourtListenerNews(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(courtListenerSearchUrl(query, options), options);
  return parseCourtListenerNews(xml, options.limit);
}

export function parseCourtListenerNews(xml: string, limit?: number): NewsItem[] {
  return parseAtomEntries(xml, {
    provider: "courtlistener",
    kind: "article",
    sourceFallback: "CourtListener",
    sourceTags: ["author"],
    ...(limit !== undefined ? { limit } : {}),
  });
}

function toDateOnly(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

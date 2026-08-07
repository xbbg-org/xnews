import { normalizeLimit } from "../options.js";

/** Algolia Hacker News search API (https://hn.algolia.com/api): free and keyless. */
export function hackerNewsSearchUrl(query: string, limit?: number): string {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(Math.min(normalizeLimit(limit) ?? 50, 1000)));
  return url.toString();
}

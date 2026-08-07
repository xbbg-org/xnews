import { fetchText } from "../http.js";
import { parseAtomEntries } from "../xml.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";
import { courtListenerSearchUrl } from "./courtlistener.urls.js";
export { courtListenerSearchUrl } from "./courtlistener.urls.js";

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

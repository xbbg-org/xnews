import { fetchText } from "../http.js";
import { parseRssItems } from "../xml.js";
import { googleNewsRssUrl } from "./google.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { googleNewsRssUrl } from "./google.urls.js";

export interface GoogleNewsOptions extends SourceFetchOptions {
  ticker?: string;
}

export interface GoogleNewsParseOptions {
  limit?: number;
  ticker?: string;
}

export async function fetchGoogleNews(
  query: string,
  options: GoogleNewsOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(googleNewsRssUrl(query), options);
  return parseGoogleNews(xml, query, {
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.ticker ? { ticker: options.ticker } : {}),
  });
}

export function parseGoogleNews(
  xml: string,
  _query: string,
  options: number | GoogleNewsParseOptions = {},
): NewsItem[] {
  const parseOptions = typeof options === "number" ? { limit: options } : options;
  return parseRssItems(xml, {
    provider: "google-news",
    sourceFallback: "Google News",
    ...(parseOptions.ticker ? { ticker: parseOptions.ticker } : {}),
    ...(parseOptions.limit !== undefined ? { limit: parseOptions.limit } : {}),
  });
}

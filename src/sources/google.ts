import { fetchText } from "../http";
import { parseRssItems } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export interface GoogleNewsOptions extends SourceFetchOptions {
  ticker?: string;
}

export interface GoogleNewsParseOptions {
  limit?: number;
  ticker?: string;
}

export function googleNewsRssUrl(query: string, region = "US", lang = "en-US"): string {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", lang);
  url.searchParams.set("gl", region);
  url.searchParams.set("ceid", `${region}:en`);
  return url.toString();
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

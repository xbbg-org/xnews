import { fetchText } from "../http";
import { parseRssItems } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export function nasdaqRssUrl(ticker: string): string {
  const url = new URL("https://www.nasdaq.com/feed/rssoutbound");
  url.searchParams.set("symbol", ticker.toUpperCase());
  return url.toString();
}

export async function fetchNasdaqNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(nasdaqRssUrl(ticker), {
    ...options,
    userAgent: options.userAgent ?? "Mozilla/5.0 xnews/0.1.0",
  });
  return parseNasdaqNews(xml, ticker, options.limit);
}

export function parseNasdaqNews(xml: string, ticker: string, limit?: number): NewsItem[] {
  return parseRssItems(xml, {
    provider: "nasdaq",
    sourceFallback: "Nasdaq",
    ticker,
    ...(limit !== undefined ? { limit } : {}),
  });
}

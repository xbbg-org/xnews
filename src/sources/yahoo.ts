import { fetchText } from "../http";
import { parseRssItems } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export function yahooFinanceRssUrl(ticker: string, region = "US", lang = "en-US"): string {
  const url = new URL("https://feeds.finance.yahoo.com/rss/2.0/headline");
  url.searchParams.set("s", ticker.toUpperCase());
  url.searchParams.set("region", region);
  url.searchParams.set("lang", lang);
  return url.toString();
}

export async function fetchYahooFinanceNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(yahooFinanceRssUrl(ticker), options);
  return parseYahooFinanceNews(xml, ticker, options.limit);
}

export function parseYahooFinanceNews(xml: string, ticker: string, limit?: number): NewsItem[] {
  return parseRssItems(xml, {
    provider: "yahoo-finance",
    sourceFallback: "Yahoo Finance",
    ticker,
    ...(limit !== undefined ? { limit } : {}),
  });
}

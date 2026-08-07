import { fetchText } from "../http.js";
import { parseRssItems } from "../xml.js";
import { yahooFinanceRssUrl } from "./yahoo.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { yahooFinanceRssUrl } from "./yahoo.urls.js";

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

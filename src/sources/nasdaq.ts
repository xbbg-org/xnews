import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { parseRssItems } from "../xml.js";
import { nasdaqRssUrl } from "./nasdaq.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { nasdaqRssUrl } from "./nasdaq.urls.js";

export async function fetchNasdaqNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(
    nasdaqRssUrl(ticker),
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
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

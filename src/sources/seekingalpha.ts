import { fetchText } from "../http";
import { parseRssItems } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export function seekingAlphaRssUrl(ticker: string): string {
  return `https://seekingalpha.com/api/sa/combined/${encodeURIComponent(ticker.toUpperCase())}.xml`;
}

export async function fetchSeekingAlphaNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(seekingAlphaRssUrl(ticker), {
    ...options,
    userAgent: options.userAgent ?? "Mozilla/5.0 xnews/0.1.0",
  });
  return parseSeekingAlphaNews(xml, ticker, options.limit);
}

export function parseSeekingAlphaNews(xml: string, ticker: string, limit?: number): NewsItem[] {
  return parseRssItems(xml, {
    provider: "seeking-alpha",
    sourceFallback: "Seeking Alpha",
    ticker,
    resolveUrl: preferGuidForSymbolPages,
    ...(limit !== undefined ? { limit } : {}),
  });
}

/**
 * Market-current items share one `/symbol/<t>/news` link, which would collapse
 * distinct stories during URL dedup; their guid is the per-story URL.
 */
function preferGuidForSymbolPages(link: string, guid: string): string {
  return /seekingalpha\.com\/symbol\/[^/]+\/news/i.test(link) &&
    /^https:\/\/seekingalpha\.com\//i.test(guid)
    ? guid
    : link;
}

import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { parseRssItems } from "../xml.js";
import { seekingAlphaRssUrl } from "./seekingalpha.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { seekingAlphaRssUrl } from "./seekingalpha.urls.js";

export async function fetchSeekingAlphaNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(
    seekingAlphaRssUrl(ticker),
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
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

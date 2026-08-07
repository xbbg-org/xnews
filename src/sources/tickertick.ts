import { fetchText } from "../http.js";
import {
  numberField,
  parseJsonRecord,
  recordArray,
  stringArrayField,
  stringField,
} from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import { inferNewsKind } from "../xml.js";
import { tickerTickFeedUrl } from "./tickertick.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { tickerTickFeedUrl } from "./tickertick.urls.js";

export async function fetchTickerTickNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(tickerTickFeedUrl(ticker, options.limit), options);
  return parseTickerTickNews(body, ticker, limit);
}

export function parseTickerTickNews(body: string, ticker: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "TickerTick");
  const items: NewsItem[] = [];
  for (const story of recordArray(payload["stories"])) {
    const title = stringField(story, "title")?.trim();
    const url = stringField(story, "url")?.trim();
    if (!title || !url) continue;

    const source = stringField(story, "site")?.trim() || "TickerTick";
    const time = numberField(story, "time");
    const publishedAt = time === undefined ? undefined : new Date(time).toISOString();
    const relatedTickers = [
      ...new Set(stringArrayField(story, "tickers").map((value) => value.toUpperCase())),
    ].toSorted();
    const summary = stringField(story, "description")?.trim();

    items.push({
      id: stableId(["tickertick", stringField(story, "id") ?? url, title]),
      provider: "tickertick",
      kind: inferNewsKind(source, title, url),
      title,
      url,
      canonicalUrl: url,
      source,
      ticker: ticker.toUpperCase(),
      ...(publishedAt ? { publishedAt } : {}),
      ...(summary ? { summary } : {}),
      ...(relatedTickers.length > 0 ? { relatedTickers } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

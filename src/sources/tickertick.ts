import { fetchText } from "../http";
import { numberField, parseJsonRecord, recordArray, stringArrayField, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import { inferNewsKind } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

/**
 * TickerTick API (https://github.com/hczhu/TickerTick-API): free, keyless,
 * rate-limited to 10 requests per minute per IP.
 */
export function tickerTickFeedUrl(ticker: string, limit?: number): string {
  const url = new URL("https://api.tickertick.com/feed");
  url.searchParams.set("q", `z:${ticker.toLowerCase()}`);
  url.searchParams.set("n", String(Math.min(normalizeLimit(limit) ?? 42, 1000)));
  return url.toString();
}

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

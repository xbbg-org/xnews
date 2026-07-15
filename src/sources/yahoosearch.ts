import { fetchText } from "../http";
import { numberField, parseJsonRecord, recordArray, stringArrayField, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import { inferNewsKind } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export function yahooSearchUrl(query: string, limit?: number): string {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("newsCount", String(Math.min(normalizeLimit(limit) ?? 20, 50)));
  url.searchParams.set("quotesCount", "0");
  return url.toString();
}

export async function fetchYahooSearchNews(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(yahooSearchUrl(query, options.limit), options);
  return parseYahooSearchNews(body, limit);
}

export function parseYahooSearchNews(body: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "Yahoo search");
  const items: NewsItem[] = [];
  for (const entry of recordArray(payload["news"])) {
    const title = stringField(entry, "title")?.trim();
    const url = stringField(entry, "link")?.trim();
    if (!title || !url) continue;

    const source = stringField(entry, "publisher")?.trim() || "Yahoo Finance";
    const publishTime = numberField(entry, "providerPublishTime");
    const publishedAt =
      publishTime === undefined ? undefined : new Date(publishTime * 1000).toISOString();
    const relatedTickers = [
      ...new Set(stringArrayField(entry, "relatedTickers").map((value) => value.toUpperCase())),
    ].toSorted();

    items.push({
      id: stableId(["yahoo-search", stringField(entry, "uuid") ?? url, title]),
      provider: "yahoo-search",
      kind: inferNewsKind(source, title, url),
      title,
      url,
      canonicalUrl: url,
      source,
      ...(publishedAt ? { publishedAt } : {}),
      ...(relatedTickers.length > 0 ? { relatedTickers } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

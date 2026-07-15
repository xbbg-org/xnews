import { fetchText } from "../http";
import { parseJsonRecord, recordArray, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import type { NewsItem, SourceFetchOptions } from "../types";

/** Algolia Hacker News search API (https://hn.algolia.com/api): free and keyless. */
export function hackerNewsSearchUrl(query: string, limit?: number): string {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(Math.min(normalizeLimit(limit) ?? 50, 1000)));
  return url.toString();
}

export async function fetchHackerNewsStories(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(hackerNewsSearchUrl(query, options.limit), options);
  return parseHackerNewsStories(body, limit);
}

export function parseHackerNewsStories(body: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "Hacker News");
  const items: NewsItem[] = [];
  for (const hit of recordArray(payload["hits"])) {
    const title = stringField(hit, "title")?.trim();
    if (!title) continue;

    const objectId = stringField(hit, "objectID");
    const discussionUrl = objectId ? `https://news.ycombinator.com/item?id=${objectId}` : undefined;
    const url = stringField(hit, "url")?.trim() || discussionUrl;
    if (!url) continue;

    const createdAt = stringField(hit, "created_at");
    const publishedAt = createdAt ? toIso(createdAt) : undefined;
    items.push({
      id: stableId(["hacker-news", objectId ?? url, title]),
      provider: "hacker-news",
      kind: "article",
      title,
      url,
      canonicalUrl: url,
      source: "Hacker News",
      ...(publishedAt ? { publishedAt } : {}),
      ...(createdAt ? { publishedAtText: createdAt } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

function toIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

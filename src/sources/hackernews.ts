import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import { hackerNewsSearchUrl } from "./hackernews.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { hackerNewsSearchUrl } from "./hackernews.urls.js";

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
    const publishedAt = createdAt ? parsePublishedAt(createdAt)?.instant : undefined;
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

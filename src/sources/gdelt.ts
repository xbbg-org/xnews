import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import { inferNewsKind } from "../xml.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";
import { gdeltDocUrl } from "./gdelt.urls.js";
export { gdeltDocUrl } from "./gdelt.urls.js";

export async function fetchGdeltNews(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(gdeltDocUrl(query, options), options);
  return parseGdeltNews(body, limit);
}

export function parseGdeltNews(body: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "GDELT");
  const items: NewsItem[] = [];
  for (const article of recordArray(payload["articles"])) {
    const title = stringField(article, "title")?.trim();
    const url = stringField(article, "url")?.trim();
    if (!title || !url) continue;

    const source = stringField(article, "domain")?.trim() || "GDELT";
    const seenDate = stringField(article, "seendate");
    const publishedAt = seenDate ? parsePublishedAt(seenDate)?.instant : undefined;
    items.push({
      id: stableId(["gdelt", url, title]),
      provider: "gdelt",
      kind: inferNewsKind(source, title, url),
      title,
      url,
      canonicalUrl: url,
      source,
      ...(publishedAt ? { publishedAt } : {}),
      ...(seenDate ? { publishedAtText: seenDate } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

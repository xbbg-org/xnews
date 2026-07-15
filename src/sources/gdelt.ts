import { fetchText } from "../http";
import { parseJsonRecord, recordArray, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import { inferNewsKind } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

/**
 * GDELT DOC 2.0 API (https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/):
 * free and keyless, rate-limited to roughly one request every five seconds per IP.
 */
export function gdeltDocUrl(
  query: string,
  options: Pick<SourceFetchOptions, "limit" | "since" | "until"> = {},
): string {
  const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  url.searchParams.set("query", query);
  url.searchParams.set("mode", "ArtList");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "DateDesc");
  url.searchParams.set("maxrecords", String(Math.min(normalizeLimit(options.limit) ?? 50, 250)));
  const since = toGdeltDateTime(options.since);
  const until = toGdeltDateTime(options.until);
  if (since) url.searchParams.set("startdatetime", since);
  if (until) url.searchParams.set("enddatetime", until);
  return url.toString();
}

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
    const publishedAt = gdeltSeenDateToIso(seenDate);
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

function gdeltSeenDateToIso(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toGdeltDateTime(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

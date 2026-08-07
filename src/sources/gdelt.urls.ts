import { normalizeLimit } from "../options.js";
import type { SourceFetchOptions } from "../types.js";

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

function toGdeltDateTime(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

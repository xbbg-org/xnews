import { normalizeLimit } from "../options.js";
import type { SourceFetchOptions } from "../types.js";

/** Federal Register API (https://www.federalregister.gov/developers/documentation/api/v1). */
export function federalRegisterSearchUrl(
  term: string,
  options: Pick<SourceFetchOptions, "limit" | "since" | "until"> = {},
): string {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("conditions[term]", term);
  url.searchParams.set("order", "newest");
  url.searchParams.set("per_page", String(Math.min(normalizeLimit(options.limit) ?? 20, 100)));
  for (const field of [
    "title",
    "type",
    "abstract",
    "document_number",
    "html_url",
    "publication_date",
    "agencies",
  ]) {
    url.searchParams.append("fields[]", field);
  }
  const since = toDateOnly(options.since);
  const until = toDateOnly(options.until);
  if (since) url.searchParams.set("conditions[publication_date][gte]", since);
  if (until) url.searchParams.set("conditions[publication_date][lte]", until);
  return url.toString();
}

function toDateOnly(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

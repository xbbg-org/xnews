import { fetchText } from "../http";
import { parseJsonRecord, recordArray, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import type { NewsItem, SourceFetchOptions } from "../types";

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

export async function fetchFederalRegisterNews(
  term: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(federalRegisterSearchUrl(term, options), options);
  return parseFederalRegisterNews(body, limit);
}

export function parseFederalRegisterNews(body: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "Federal Register");
  const items: NewsItem[] = [];
  for (const doc of recordArray(payload["results"])) {
    const title = stringField(doc, "title")?.trim();
    const url = stringField(doc, "html_url")?.trim();
    if (!title || !url) continue;

    const agency = recordArray(doc["agencies"])
      .map((entry) => stringField(entry, "name")?.trim())
      .find(Boolean);
    const publicationDate = stringField(doc, "publication_date");
    const publishedAt = publicationDate ? toIso(publicationDate) : undefined;
    const summary = stringField(doc, "abstract")?.trim();
    const documentType = stringField(doc, "type")?.trim();

    items.push({
      id: stableId(["federal-register", stringField(doc, "document_number") ?? url, title]),
      provider: "federal-register",
      kind: "article",
      title: documentType ? `${documentType}: ${title}` : title,
      url,
      canonicalUrl: url,
      source: agency ?? "Federal Register",
      ...(publishedAt ? { publishedAt } : {}),
      ...(publicationDate ? { publishedAtText: publicationDate } : {}),
      ...(summary ? { summary } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  return items;
}

function toIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDateOnly(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

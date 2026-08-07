import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";
import { federalRegisterSearchUrl } from "./federalregister.urls.js";
export { federalRegisterSearchUrl } from "./federalregister.urls.js";

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
    const publishedAt = publicationDate ? parsePublishedAt(publicationDate)?.instant : undefined;
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

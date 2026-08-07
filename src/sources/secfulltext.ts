import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringArrayField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import type { NewsItem } from "../types.js";
import { secFullTextSearchUrl, type SecFullTextOptions } from "./secfulltext.urls.js";
export { secFullTextSearchUrl } from "./secfulltext.urls.js";

export async function fetchSecFullTextFilings(
  query: string,
  options: SecFullTextOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(secFullTextSearchUrl(query, options), options);
  return parseSecFullTextFilings(body, {
    ...(options.ticker ? { ticker: options.ticker } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
}

export function parseSecFullTextFilings(
  body: string,
  options: { ticker?: string; limit?: number } = {},
): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "SEC full-text");
  // EFTS reports failures inside HTTP 200 responses, e.g. when the requested
  // result window is too large; the error body carries no "hits" at all.
  const errorType = stringField(payload, "errorType");
  if (errorType) {
    throw new Error(
      `SEC full-text search failed: ${stringField(payload, "errorMessage") ?? errorType}`,
    );
  }
  const outerHits = payload["hits"];
  const items: NewsItem[] = [];
  for (const hit of recordArray(isRecord(outerHits) ? outerHits["hits"] : undefined)) {
    const source = hit["_source"];
    if (!isRecord(source)) continue;

    const adsh = stringField(source, "adsh")?.trim();
    const cik = stringArrayField(source, "ciks")[0]?.replace(/^0+/, "");
    const fileName = stringField(hit, "_id")?.split(":").slice(1).join(":");
    if (!adsh || !cik || !fileName) continue;

    const form = stringField(source, "form")?.trim() || stringField(source, "file_type")?.trim();
    const displayName = stringArrayField(source, "display_names")[0]
      ?.replace(/\s*\(CIK[^)]*\)\s*$/, "")
      .trim();
    const fileDescription = stringField(source, "file_description")?.trim();
    const fileNumber = stringArrayField(source, "file_num")[0]?.trim();
    const title = [form, displayName || fileDescription || adsh].filter(Boolean).join(" - ");
    // XML primary documents (e.g. ownership forms 3/4/5) are served in
    // rendered form under the path of their XSL stylesheet.
    const xsl = stringField(source, "xsl")?.trim();
    const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}/${xsl ? `${xsl}/` : ""}${fileName}`;
    const fileDate = stringField(source, "file_date");
    const publishedAt = fileDate ? parsePublishedAt(fileDate)?.instant : undefined;

    items.push({
      id: stableId(["sec-fulltext", adsh, fileName]),
      provider: "sec-fulltext",
      kind: "filing",
      title,
      url,
      canonicalUrl: url,
      source: "SEC EDGAR",
      ...(options.ticker ? { ticker: options.ticker.toUpperCase() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(fileDate ? { publishedAtText: fileDate, filingDate: fileDate } : {}),
      ...(fileDescription ? { summary: fileDescription } : {}),
      ...(form ? { formType: form } : {}),
      accessionNumber: adsh,
      cik,
      ...(fileNumber ? { fileNumber } : {}),
    });

    if (limit !== undefined && items.length >= limit) break;
  }
  return items;
}

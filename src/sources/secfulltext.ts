import { fetchText } from "../http";
import { isRecord, parseJsonRecord, recordArray, stringArrayField, stringField } from "../json";
import { normalizeLimit } from "../options";
import { stableId } from "../text";
import type { NewsItem, SourceFetchOptions } from "../types";

interface SecFullTextOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
}

/** SEC EDGAR full-text search (https://efts.sec.gov/LATEST/search-index?q=...). */
export function secFullTextSearchUrl(
  query: string,
  options: Pick<SecFullTextOptions, "forms" | "since" | "until" | "ticker"> = {},
): string {
  const url = new URL("https://efts.sec.gov/LATEST/search-index");
  url.searchParams.set("q", `"${query.replace(/"/g, "")}"`);
  if (options.ticker) {
    // EFTS resolves tickers and company names to an entity server-side; a
    // bare CIK number matches only in its zero-padded ten-digit form.
    const entity = options.ticker.trim();
    url.searchParams.set("entityName", /^\d+$/.test(entity) ? entity.padStart(10, "0") : entity);
  }
  if (options.forms?.length) url.searchParams.set("forms", options.forms.join(","));
  const since = toDateOnly(options.since);
  const until = toDateOnly(options.until);
  if (since || until) {
    url.searchParams.set("dateRange", "custom");
    if (since) url.searchParams.set("startdt", since);
    if (until) url.searchParams.set("enddt", until);
  }
  return url.toString();
}

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
    const publishedAt = fileDate ? toIso(fileDate) : undefined;

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

function toIso(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toDateOnly(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

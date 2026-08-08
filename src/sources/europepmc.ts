import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata } from "../types.js";
import { europePmcSearchUrl, type EuropePmcSearchOptions } from "./europepmc.urls.js";

export { EUROPE_PMC_SEARCH_URL, europePmcSearchUrl } from "./europepmc.urls.js";
export type { EuropePmcSearchOptions, EuropePmcSearchUrlOptions } from "./europepmc.urls.js";

export interface EuropePmcPage {
  readonly items: ResearchPaper[];
  readonly hitCount?: number;
  readonly nextCursorMark?: string;
}

export async function fetchEuropePmcPapers(
  query: string,
  options: EuropePmcSearchOptions = {},
): Promise<EuropePmcPage> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { items: [] };

  const url = europePmcSearchUrl(query, {
    ...(options.pageSize !== undefined
      ? { pageSize: options.pageSize }
      : limit !== undefined
        ? { pageSize: limit }
        : {}),
    ...(options.cursorMark !== undefined ? { cursorMark: options.cursorMark } : {}),
    ...(options.resultType !== undefined ? { resultType: options.resultType } : {}),
    ...(options.sort !== undefined ? { sort: options.sort } : {}),
    ...(options.synonym !== undefined ? { synonym: options.synonym } : {}),
  });
  return parseEuropePmcPapers(await fetchText(url, options), limit);
}

export function parseEuropePmcPapers(body: string, limit?: number): EuropePmcPage {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return { items: [] };

  const payload = parseJsonRecord(body, "Europe PMC");
  const resultList = payload["resultList"];
  if (
    Array.isArray(payload) ||
    !isRecord(resultList) ||
    Array.isArray(resultList) ||
    !Array.isArray(resultList["result"])
  ) {
    throw new Error("unexpected Europe PMC response shape");
  }

  const results = resultList["result"];
  const items: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const value of results) {
    if (!isRecord(value) || Array.isArray(value)) continue;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseEuropePmcPaper(value);
    } catch {
      continue;
    }
    if (!paper) continue;

    const externalId = paper.research.externalId;
    if (externalId === undefined || seen.has(externalId)) continue;
    seen.add(externalId);
    items.push(paper);
    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  if (results.length > 0 && items.length === 0) {
    throw new Error("Europe PMC response contained no valid records");
  }

  const hitCount = nonNegativeInteger(numberField(payload, "hitCount"));
  const nextCursorMark = nonBlank(stringField(payload, "nextCursorMark"));
  return {
    items,
    ...(hitCount !== undefined ? { hitCount } : {}),
    ...(nextCursorMark !== undefined ? { nextCursorMark } : {}),
  };
}

function parseEuropePmcPaper(record: Record<string, unknown>): ResearchPaper | undefined {
  const articleSource = nonBlank(stringField(record, "source"));
  const articleId = nonBlank(stringField(record, "id"));
  const title = cleanJsonText(stringField(record, "title"));
  if (!articleSource || !articleId || !title) return undefined;

  const externalId = `${articleSource}/${articleId}`;
  const url = `https://europepmc.org/article/${encodeURIComponent(articleSource)}/${encodeURIComponent(articleId)}`;
  const doi = normalizeDoi(stringField(record, "doi"));
  const journalTitle = cleanJsonText(stringField(record, "journalTitle"));
  const issue = cleanJsonText(stringField(record, "issue"));
  const authors = parseAuthors(stringField(record, "authorString"));
  const firstPublicationDate = nonBlank(stringField(record, "firstPublicationDate"));
  const pubYear = nonBlank(stringField(record, "pubYear"));
  const publishedAtText = firstPublicationDate ?? pubYear;
  const publishedAt = firstPublicationDate
    ? parsePublishedAt(firstPublicationDate)?.instant
    : undefined;
  const summary = cleanJsonText(stringField(record, "abstractText"));

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    ...(journalTitle ? { series: journalTitle } : {}),
    ...(issue ? { issue } : {}),
    ...(doi ? { doi } : {}),
    externalId,
  };

  return {
    id: stableId(["europe-pmc", externalId, title]),
    provider: "europe-pmc",
    kind: "analysis",
    title,
    url,
    canonicalUrl: doi ? `https://doi.org/${doi}` : url,
    source: journalTitle ?? "Europe PMC",
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    research,
  };
}

function parseAuthors(value: string | undefined): string[] {
  const normalized = cleanJsonText(value)?.replace(/\.$/, "");
  if (!normalized) return [];
  return normalized.split(", ").map(cleanText).filter(Boolean);
}

function normalizeDoi(value: string | undefined): string | undefined {
  let normalized = nonBlank(value);
  if (!normalized) return undefined;
  normalized = normalized.replace(/^doi:\s*/i, "");
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (host === "doi.org" || host === "dx.doi.org") {
      normalized = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    }
  } catch {
    normalized = normalized.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  }
  normalized = normalized.trim().toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : undefined;
}

function cleanJsonText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return cleanText(value) || undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringArrayField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, decodeEntities, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { assertXmlEnvelope, matchXmlBlocks, readXmlTag, readXmlTags } from "../xml.js";
import {
  BIS_RESEARCH_HUB_RSS_URL,
  BIS_RESEARCH_HUB_URL,
  BIS_WORKING_PAPERS_URL,
  bisWorkingPaperLandingUrl,
  bisWorkingPaperPdfUrl,
  type BisResearchFilters,
  type BisResearchHubOptions,
} from "./bis.urls.js";

export {
  BIS_RESEARCH_HUB_RSS_URL,
  BIS_RESEARCH_HUB_URL,
  BIS_WORKING_PAPERS_URL,
  bisWorkingPaperLandingUrl,
  bisWorkingPaperPdfUrl,
} from "./bis.urls.js";
export type { BisResearchFilters, BisResearchHubOptions } from "./bis.urls.js";

const MAX_BIS_SNAPSHOT_RECORDS = 100_000;

export async function fetchBisWorkingPapers(
  options: SourceFetchOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  return parseBisWorkingPapers(await fetchText(BIS_WORKING_PAPERS_URL, options), limit);
}

/** Parses the complete BIS Working Papers snapshot. Pure and network-free. */
export function parseBisWorkingPapers(body: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "BIS Working Papers");
  const list = payload["list"];
  if (!isRecord(list)) {
    throw new Error("unexpected BIS Working Papers response shape");
  }

  let entryCount = 0;
  const papers: ResearchPaper[] = [];
  for (const snapshotPath in list) {
    if (!Object.hasOwn(list, snapshotPath)) continue;
    entryCount += 1;
    if (entryCount > MAX_BIS_SNAPSHOT_RECORDS) {
      throw new Error("BIS Working Papers response exceeded record limit");
    }

    const value = list[snapshotPath];
    if (!isRecord(value)) continue;
    const paper = parseBisWorkingPaper(value, snapshotPath);
    if (paper) papers.push(paper);
  }
  if (entryCount > 0 && papers.length === 0) {
    throw new Error("BIS Working Papers response contained no valid records");
  }

  const sorted = papers.toSorted(comparePapersByDate);
  return normalizedLimit === undefined ? sorted : sorted.slice(0, normalizedLimit);
}

export async function fetchBisResearchHub(
  options: BisResearchHubOptions = {},
): Promise<ResearchPaper[]> {
  const filters = filtersFromOptions(options);
  if (normalizeLimit(filters.limit) === 0) return [];
  return parseBisResearchHub(await fetchText(BIS_RESEARCH_HUB_URL, options), filters);
}

/** Parses the complete Central Bank Research Hub JSON snapshot. Pure and network-free. */
export function parseBisResearchHub(
  body: string,
  filters: BisResearchFilters = {},
): ResearchPaper[] {
  const limit = normalizeLimit(filters.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "BIS Central Bank Research Hub");
  if (Array.isArray(payload)) {
    throw new Error("unexpected BIS Central Bank Research Hub response shape");
  }

  let snapshotRecordCount = 0;
  const papers: ResearchPaper[] = [];
  for (const key in payload) {
    if (!Object.hasOwn(payload, key)) continue;
    snapshotRecordCount += 1;
    if (snapshotRecordCount > MAX_BIS_SNAPSHOT_RECORDS) {
      throw new Error("BIS Central Bank Research Hub response exceeded record limit");
    }

    const value = payload[key];
    if (!isRecord(value)) continue;
    const paper = parseBisResearchHubRecord(value);
    if (paper) papers.push(paper);
  }
  if (snapshotRecordCount > 0 && papers.length === 0) {
    throw new Error("BIS Central Bank Research Hub response contained no valid records");
  }

  const sorted = papers.toSorted(comparePapersByDate);
  const filtered = sorted.filter((paper) => matchesResearchFilters(paper, filters));
  return limit === undefined ? filtered : filtered.slice(0, limit);
}

export async function fetchBisResearchHubRecent(
  options: BisResearchHubOptions = {},
): Promise<ResearchPaper[]> {
  const filters = filtersFromOptions(options);
  if (normalizeLimit(filters.limit) === 0) return [];
  return parseBisResearchHubRecent(await fetchText(BIS_RESEARCH_HUB_RSS_URL, options), filters);
}

/** Parses recent Research Hub RSS 1.0 additions. Pure and network-free. */
export function parseBisResearchHubRecent(
  xml: string,
  filters: BisResearchFilters = {},
): ResearchPaper[] {
  const limit = normalizeLimit(filters.limit);
  if (limit === 0) return [];
  assertXmlEnvelope(xml, ["rss", "rdf"], "BIS Research Hub: invalid RSS feed response");

  let candidateCount = 0;
  let parsedCount = 0;
  const papers: ResearchPaper[] = [];
  const identities = new Set<string>();
  for (const block of matchXmlBlocks(xml, "item")) {
    candidateCount += 1;
    const paper = parseBisResearchHubRssItem(block);
    if (!paper) continue;
    parsedCount += 1;
    if (!matchesResearchFilters(paper, filters)) continue;

    const identity = researchIdentity(paper);
    if (identities.has(identity)) continue;
    identities.add(identity);
    papers.push(paper);
  }
  if (candidateCount > 0 && parsedCount === 0) {
    throw new Error("BIS Research Hub RSS response contained no valid records");
  }

  return limit === undefined ? papers : papers.slice(0, limit);
}

function parseBisWorkingPaper(
  record: Record<string, unknown>,
  snapshotPath: string,
): ResearchPaper | undefined {
  const path = cleanJsonText(stringField(record, "path") ?? snapshotPath);
  if (!path) return undefined;
  const issue = path.match(/^\/publ\/work(\d+)$/i)?.[1];
  const title = cleanJsonText(stringField(record, "short_title"));
  const url = bisWorkingPaperLandingUrl(path);
  if (!issue || !title || !url) return undefined;

  const publishedAtText = cleanJsonText(
    stringField(record, "publication_start_date") ?? stringField(record, "publication_timestamp"),
  );
  const publishedAt = normalizePaperDate(publishedAtText);
  const authors = recordArray(record["authors"])
    .map((author) => cleanJsonText(stringField(author, "name")))
    .filter((author): author is string => author !== undefined);
  const categories = cleanStringArray(stringArrayField(record, "topics"));
  const jelCodes = cleanStringArray(stringArrayField(record, "jel_codes"));
  const pdfUrl = bisWorkingPaperPdfUrl(path);

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    institution: "Bank for International Settlements",
    country: "Switzerland",
    series: "BIS Working Papers",
    issue,
    ...(jelCodes.length > 0 ? { jelCodes } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    externalId: path,
    ...(pdfUrl ? { pdfUrl } : {}),
  };

  return {
    id: stableId(["bis-research", research.series ?? "", issue, path]),
    provider: "bis-research",
    kind: "analysis",
    title,
    url,
    canonicalUrl: url,
    source: "Bank for International Settlements",
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(categories.length > 0 ? { tags: categories } : {}),
    research,
  };
}

function parseBisResearchHubRecord(record: Record<string, unknown>): ResearchPaper | undefined {
  const title = cleanJsonText(stringField(record, "title"));
  const url = safeResearchUrl(stringField(record, "primary_href"));
  if (!title || !url) return undefined;

  const seriesRecord = isRecord(record["series"]) ? record["series"] : undefined;
  const institution = cleanJsonText(seriesRecord && stringField(seriesRecord, "institution"));
  const country = cleanJsonText(seriesRecord && stringField(seriesRecord, "country"));
  const series = cleanJsonText(seriesRecord && stringField(seriesRecord, "name"));
  const issue = cleanJsonText(stringField(record, "issue"));
  const authors = cleanStringArray(stringArrayField(record, "authors"));
  const jelCodes = cleanStringArray(stringArrayField(record, "jel_codes"));
  const summary = cleanJsonText(
    stringField(record, "abstract") ??
      stringField(record, "summary") ??
      stringField(record, "description"),
  );
  const publishedAtText = cleanJsonText(
    stringField(record, "publication_date") ?? stringField(record, "occurrence_date"),
  );
  const publishedAt = normalizePaperDate(publishedAtText);
  const nativeId = nativeIdText(record["id"]);
  const metadataId = [institution, series, issue].filter(Boolean).join(":");
  const externalId = nativeId ?? (metadataId || url);
  const pdfUrl = isPdfUrl(url) ? url : undefined;

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    ...(institution ? { institution } : {}),
    ...(country ? { country } : {}),
    ...(series ? { series } : {}),
    ...(issue ? { issue } : {}),
    ...(jelCodes.length > 0 ? { jelCodes } : {}),
    externalId,
    ...(pdfUrl ? { pdfUrl } : {}),
  };

  return {
    id: stableId(["bis-research-hub", externalId]),
    provider: "bis-research-hub",
    kind: "analysis",
    title,
    url,
    canonicalUrl: url,
    source: institution ?? series ?? "BIS Central Bank Research Hub",
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    research,
  };
}

function parseBisResearchHubRssItem(block: string): ResearchPaper | undefined {
  const paperBlock = readXmlTag(block, "paper");
  const resourceBlock = readXmlTag(paperBlock, "resource");
  const title =
    cleanText(readXmlTag(block, "title")) || cleanText(readXmlTag(paperBlock, "simpleTitle"));
  const url = safeResearchUrl(
    cleanText(readXmlTag(resourceBlock, "link")) || cleanText(readXmlTag(block, "link")),
  );
  if (!title || !url) return undefined;

  const authors = [...matchXmlBlocks(paperBlock, "person")]
    .flatMap((person) => readXmlTags(person, "nameAsWritten"))
    .map(cleanText)
    .filter(Boolean);
  const institution = optionalCleanText(readXmlTag(paperBlock, "institutionAbbrev"));
  const country = optionalCleanText(readXmlTag(paperBlock, "country"));
  const series = optionalCleanText(readXmlTag(paperBlock, "publication"));
  const issue = optionalCleanText(readXmlTag(paperBlock, "issue"));
  const jelCodes = readXmlTags(paperBlock, "JELCode").map(cleanText).filter(Boolean);
  const summary = optionalCleanText(readXmlTag(block, "abstract"));
  const publishedAtText = optionalCleanText(readXmlTag(block, "date"));
  const parsedPublishedAt = normalizePaperDate(publishedAtText);
  const publishedAt =
    parsedPublishedAt && !isImplausiblyFuture(parsedPublishedAt) ? parsedPublishedAt : undefined;
  const pdfUrl = isPdfUrl(url) ? url : undefined;

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    ...(institution ? { institution } : {}),
    ...(country ? { country } : {}),
    ...(series ? { series } : {}),
    ...(issue ? { issue } : {}),
    ...(jelCodes.length > 0 ? { jelCodes } : {}),
    externalId: url,
    ...(pdfUrl ? { pdfUrl } : {}),
  };
  const identity = metadataIdentity(research, title, publishedAtText);

  return {
    id: stableId(["bis-research-hub", identity]),
    provider: "bis-research-hub",
    kind: "analysis",
    title,
    url,
    canonicalUrl: url,
    source: institution ?? series ?? "BIS Central Bank Research Hub",
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    research,
  };
}

function filtersFromOptions(options: BisResearchHubOptions): BisResearchFilters {
  return {
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.institutions !== undefined ? { institutions: options.institutions } : {}),
    ...(options.query !== undefined ? { query: options.query } : {}),
  };
}

function matchesResearchFilters(paper: ResearchPaper, filters: BisResearchFilters): boolean {
  const requestedInstitutions = (filters.institutions ?? [])
    .map(normalizeSearchText)
    .filter(Boolean);
  if (requestedInstitutions.length > 0) {
    const institution = normalizeSearchText(paper.research.institution ?? "");
    if (!institution || !requestedInstitutions.includes(institution)) return false;
  }

  const queryTerms = normalizeSearchText(filters.query ?? "")
    .split(" ")
    .filter(Boolean);
  if (queryTerms.length === 0) return true;
  const haystack = normalizeSearchText(
    [
      paper.title,
      paper.summary,
      ...(paper.research.authors ?? []),
      paper.research.institution,
      paper.research.series,
      ...(paper.research.jelCodes ?? []),
    ]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  );
  return queryTerms.every((term) => haystack.includes(term));
}

function researchIdentity(paper: ResearchPaper): string {
  return metadataIdentity(paper.research, paper.title, paper.publishedAtText);
}

function metadataIdentity(
  research: ResearchPaperMetadata,
  title: string,
  publishedAtText?: string,
): string {
  if (research.institution && research.series && research.issue) {
    return stableId([
      normalizeSearchText(research.institution),
      normalizeSearchText(research.series),
      normalizeSearchText(research.issue),
    ]);
  }
  return stableId([
    normalizeSearchText(title),
    [...(research.authors ?? [])].map(normalizeSearchText).toSorted().join(","),
    normalizeSearchText(publishedAtText ?? ""),
  ]);
}

function comparePapersByDate(left: ResearchPaper, right: ResearchPaper): number {
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : Number.NEGATIVE_INFINITY;
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : Number.NEGATIVE_INFINITY;
  return rightTime - leftTime || left.id.localeCompare(right.id);
}

function normalizePaperDate(value: string | undefined): string | undefined {
  if (!value || /^\d{4}(?:-\d{2})?$/.test(value)) return undefined;
  return parsePublishedAt(value)?.instant;
}

function isImplausiblyFuture(instant: string): boolean {
  return Date.parse(instant) > Date.now() + 366 * 24 * 60 * 60 * 1_000;
}

function safeResearchUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const decoded = decodeEntities(value.trim());
  return safeHttpUrl(decoded);
}

function isPdfUrl(value: string): boolean {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

function cleanJsonText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function optionalCleanText(value: string): string | undefined {
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function cleanStringArray(values: readonly string[]): string[] {
  return values.map(cleanJsonText).filter((value): value is string => value !== undefined);
}

function nativeIdText(value: unknown): string | undefined {
  if (typeof value === "string") return cleanJsonText(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

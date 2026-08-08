import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, stringArrayField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { assertXmlEnvelope, matchXmlBlocks, readXmlTag } from "../xml.js";
import { NBER_RSS_URL, nberListingUrl, type NberListingUrlOptions } from "./nber.urls.js";

export { NBER_RSS_URL, nberListingUrl } from "./nber.urls.js";
export type { NberListingUrlOptions } from "./nber.urls.js";

export type NberListingOptions = NberListingUrlOptions & SourceFetchOptions;

const NBER_ORIGIN = "https://www.nber.org";
const NBER_INSTITUTION = "NBER";
const NBER_SERIES = "NBER Working Papers";

export async function fetchNberWorkingPapers(
  options: NberListingOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const url = nberListingUrl({
    ...(options.q !== undefined ? { q: options.q } : {}),
    ...(options.page !== undefined ? { page: options.page } : {}),
    ...(options.perPage !== undefined
      ? { perPage: options.perPage }
      : limit !== undefined
        ? { perPage: limit }
        : {}),
    ...(options.sortBy !== undefined ? { sortBy: options.sortBy } : {}),
  });
  return parseNberWorkingPapers(await fetchText(url, options), limit);
}

export function parseNberWorkingPapers(body: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "NBER Working Papers");
  const results = payload["results"];
  if (!Array.isArray(results)) {
    throw new Error("unexpected NBER Working Papers response shape");
  }

  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const value of results) {
    if (!isRecord(value) || Array.isArray(value)) continue;
    let paper: ResearchPaper | undefined;
    try {
      paper = parseNberListingRecord(value);
    } catch {
      continue;
    }
    if (!paper) continue;

    const externalId = paper.research.externalId;
    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);
    papers.push(paper);
    if (normalizedLimit !== undefined && papers.length >= normalizedLimit) break;
  }
  if (results.length > 0 && papers.length === 0) {
    throw new Error("NBER Working Papers response contained no valid records");
  }
  return papers;
}

export async function fetchNberRecentPapers(
  options: SourceFetchOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  return parseNberRecentPapers(await fetchText(NBER_RSS_URL, options), limit);
}

export function parseNberRecentPapers(xml: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];
  assertXmlEnvelope(xml, ["rss"], "NBER: invalid RSS feed response");

  let candidateCount = 0;
  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const block of matchXmlBlocks(xml, "item")) {
    candidateCount += 1;
    let paper: ResearchPaper | undefined;
    try {
      paper = parseNberRssItem(block);
    } catch {
      continue;
    }
    if (!paper) continue;

    const externalId = paper.research.externalId;
    if (!externalId || seen.has(externalId)) continue;
    seen.add(externalId);
    papers.push(paper);
    if (normalizedLimit !== undefined && papers.length >= normalizedLimit) break;
  }
  if (candidateCount > 0 && papers.length === 0) {
    throw new Error("NBER RSS response contained no valid records");
  }
  return papers;
}

function parseNberListingRecord(record: Record<string, unknown>): ResearchPaper | undefined {
  const identity = nberPaperIdentity(stringField(record, "url"));
  const title = optionalCleanText(stringField(record, "title"));
  if (!identity || !title) return undefined;

  const publishedAtText = optionalCleanText(stringField(record, "displaydate"));
  const summary = optionalCleanText(stringField(record, "abstract"));
  const authors = uniqueStrings(
    stringArrayField(record, "authors").map((author) => cleanText(author)),
  );
  return makeNberPaper(identity, title, {
    ...(authors.length > 0 ? { authors } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
  });
}

function parseNberRssItem(block: string): ResearchPaper | undefined {
  const identity = nberPaperIdentity(cleanText(readXmlTag(block, "link")));
  const titleWithAuthors = cleanText(readXmlTag(block, "title"));
  if (!identity || !titleWithAuthors) return undefined;

  const byline = titleWithAuthors.match(/^([\s\S]*?)\s+--\s+by\s+([\s\S]+)$/i);
  const title = cleanText(byline?.[1] ?? titleWithAuthors);
  if (!title) return undefined;

  const authorsText = byline?.[2];
  const authors = authorsText
    ? uniqueStrings(
        authorsText
          .split(/\s*,\s*/)
          .map(cleanText)
          .filter(Boolean),
      )
    : [];
  const publishedAtText = optionalCleanText(readXmlTag(block, "pubDate"));
  const summary = optionalCleanText(readXmlTag(block, "description"));
  return makeNberPaper(identity, title, {
    ...(authors.length > 0 ? { authors } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
  });
}

interface NberPaperIdentity {
  readonly externalId: string;
  readonly url: string;
}

interface NberPaperFields {
  readonly authors?: readonly string[];
  readonly publishedAtText?: string;
  readonly summary?: string;
}

function makeNberPaper(
  identity: NberPaperIdentity,
  title: string,
  fields: NberPaperFields,
): ResearchPaper {
  const publishedAt = fields.publishedAtText
    ? parsePublishedAt(fields.publishedAtText)?.instant
    : undefined;
  const research: ResearchPaperMetadata = {
    ...(fields.authors !== undefined && fields.authors.length > 0
      ? { authors: fields.authors }
      : {}),
    institution: NBER_INSTITUTION,
    series: NBER_SERIES,
    issue: identity.externalId.slice(1),
    externalId: identity.externalId,
  };

  return {
    id: stableId(["nber", identity.externalId, title]),
    provider: "nber",
    kind: "analysis",
    title,
    url: identity.url,
    canonicalUrl: identity.url,
    source: NBER_SERIES,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(fields.publishedAtText !== undefined ? { publishedAtText: fields.publishedAtText } : {}),
    ...(fields.summary !== undefined ? { summary: fields.summary } : {}),
    research,
  };
}

function nberPaperIdentity(value: string | undefined): NberPaperIdentity | undefined {
  const candidate = optionalCleanText(value);
  if (!candidate) return undefined;

  let absoluteUrl: string;
  try {
    absoluteUrl = new URL(candidate, NBER_ORIGIN).toString();
  } catch {
    return undefined;
  }
  const safeUrl = safeHttpUrl(absoluteUrl);
  if (!safeUrl) return undefined;

  const parsed = new URL(safeUrl);
  if (!/^(?:www\.)?nber\.org$/i.test(parsed.hostname)) return undefined;
  const externalId = parsed.pathname.match(/^\/papers\/(w\d+)\/?$/i)?.[1]?.toLowerCase();
  if (!externalId) return undefined;
  return {
    externalId,
    url: `${NBER_ORIGIN}/papers/${externalId}`,
  };
}

function optionalCleanText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

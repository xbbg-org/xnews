import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { cleanText, decodeEntities, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper } from "../types.js";
import {
  assertXmlEnvelope,
  matchXmlBlocks,
  readXmlAttribute,
  readXmlTag,
  readXmlTags,
} from "../xml.js";
import {
  arxivCategoryFeedUrl,
  arxivSearchUrl,
  type ArxivAnnouncementOptions,
  type ArxivCategories,
  type ArxivSearchOptions,
} from "./arxiv.urls.js";

export {
  ARXIV_MIN_REQUEST_INTERVAL_MS,
  arxivCategoryFeedUrl,
  arxivSearchUrl,
} from "./arxiv.urls.js";
export type {
  ArxivAnnouncementOptions,
  ArxivCategories,
  ArxivCategoryFeedFormat,
  ArxivSearchOptions,
  ArxivSearchSortBy,
  ArxivSearchSortOrder,
  ArxivSearchUrlOptions,
} from "./arxiv.urls.js";

const ARXIV_USER_AGENT = "@xbbg/xnews arXiv adapter (+https://github.com/xbbg-org/xnews)";

/** Parses legacy API Atom results or official Atom/RSS announcement feeds. */
export function parseArxivPapers(xml: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];
  assertXmlEnvelope(xml, ["feed", "rss", "rdf"], "arxiv: invalid feed response");

  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  let candidateCount = 0;
  for (const localName of ["entry", "item"] as const) {
    for (const block of matchXmlBlocks(xml, localName)) {
      candidateCount += 1;
      let paper: ResearchPaper | undefined;
      try {
        paper = parseArxivPaper(block);
      } catch {
        // One malformed record must not discard otherwise valid feed entries.
        continue;
      }
      if (paper === undefined) continue;

      const dedupeKey = `${paper.research.externalId ?? ""}v${paper.research.version ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      papers.push(paper);
      if (normalizedLimit !== undefined && papers.length >= normalizedLimit) return papers;
    }
  }
  if (candidateCount > 0 && papers.length === 0) {
    throw new Error("arxiv: feed contained no valid papers");
  }
  return papers;
}

/** Fetches one page from arXiv's legacy Atom search API. */
export async function fetchArxivPapers(
  query: string,
  options: ArxivSearchOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const xml = await fetchText(
    arxivSearchUrl(query, {
      ...(options.start !== undefined ? { start: options.start } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(options.sortBy !== undefined ? { sortBy: options.sortBy } : {}),
      ...(options.sortOrder !== undefined ? { sortOrder: options.sortOrder } : {}),
    }),
    options,
    options.userAgent ?? ARXIV_USER_AGENT,
  );
  return parseArxivPapers(xml, limit);
}

/** Fetches today's official arXiv announcements for one or more categories. */
export async function fetchArxivAnnouncements(
  categories: ArxivCategories,
  options: ArxivAnnouncementOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const xml = await fetchText(
    arxivCategoryFeedUrl(categories, options.format),
    options,
    options.userAgent ?? ARXIV_USER_AGENT,
  );
  return parseArxivPapers(xml, limit);
}

interface ArxivIdentifier {
  readonly canonicalId: string;
  readonly version?: string;
}

interface XmlLink {
  readonly href: string;
  readonly rel: string;
  readonly title: string;
  readonly type: string;
}

function parseArxivPaper(block: string): ResearchPaper | undefined {
  const title = cleanText(readXmlTag(block, "title"));
  if (!title || title.toLowerCase() === "error") return undefined;

  const links = readLinks(block);
  const idText = cleanText(readXmlTag(block, "id"));
  const guid = cleanText(readXmlTag(block, "guid"));
  const linkText = cleanText(readXmlTag(block, "link"));
  const summaryText = readXmlTag(block, "summary") || readXmlTag(block, "description");
  const identifier = findIdentifier([
    idText,
    guid,
    linkText,
    ...links.map((link) => link.href),
    cleanText(summaryText),
  ]);
  if (identifier === undefined) return undefined;

  const alternateLink = links.find(
    (link) => link.rel === "alternate" && matchesIdentifier(link.href, identifier),
  )?.href;
  const url = documentUrl(alternateLink || linkText || idText, "abs", identifier);
  const pdfLink = links.find(
    (link) =>
      (link.title === "pdf" || link.type === "application/pdf") &&
      matchesIdentifier(link.href, identifier),
  )?.href;
  const pdfUrl = documentUrl(pdfLink, "pdf", identifier);
  const licenseValue =
    cleanText(readXmlTag(block, "license")) ||
    cleanText(readXmlTag(block, "rights")) ||
    links.find((link) => link.title === "license" || link.rel === "license")?.href ||
    "";
  const licenseUrl = safeHttpUrl(decodeEntities(licenseValue));

  const announceType =
    cleanText(readXmlTag(block, "announce_type")) ||
    cleanText(summaryText).match(/\bAnnounce Type:\s*([^\s]+)/i)?.[1] ||
    "";
  const announcement = Boolean(announceType) || /^oai:arxiv\.org:/i.test(idText || guid);
  const publishedText = cleanText(
    announcement
      ? readXmlTag(block, "published") || readXmlTag(block, "pubDate")
      : readXmlTag(block, "published"),
  );
  const updatedText = announcement ? "" : cleanText(readXmlTag(block, "updated"));
  const submittedAt = announcement ? undefined : toIsoDate(publishedText);
  const updatedAt = announcement ? undefined : toIsoDate(updatedText);
  const announcedAt = announcement ? toIsoDate(publishedText) : undefined;
  const publishedAt = announcement ? announcedAt : submittedAt;

  const authors = readAuthors(block);
  const primaryCategory = cleanText(readXmlAttribute(block, "primary_category", "term"));
  const categories = uniqueStrings([
    primaryCategory,
    ...readOpeningTagAttributes(block, "category", "term"),
    ...readXmlTags(block, "category").map(cleanText),
  ]);
  const doi = normalizeDoi(cleanText(readXmlTag(block, "doi")));
  const summary = announcement ? announcementAbstract(summaryText) : cleanText(summaryText);

  return {
    id: stableId([
      "arxiv",
      `${identifier.canonicalId}${identifier.version ? `v${identifier.version}` : ""}`,
    ]),
    provider: "arxiv",
    kind: "analysis",
    title,
    url,
    canonicalUrl: url,
    source: "arXiv",
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(publishedText ? { publishedAtText: publishedText } : {}),
    ...(summary ? { summary } : {}),
    ...(categories.length > 0 ? { tags: categories } : {}),
    research: {
      ...(authors.length > 0 ? { authors } : {}),
      ...(categories.length > 0 ? { categories } : {}),
      externalId: identifier.canonicalId,
      ...(identifier.version !== undefined ? { version: identifier.version } : {}),
      ...(doi ? { doi } : {}),
      ...(submittedAt !== undefined ? { submittedAt } : {}),
      ...(updatedAt !== undefined ? { updatedAt } : {}),
      ...(announcedAt !== undefined ? { announcedAt } : {}),
      ...(announceType ? { announceType } : {}),
      ...(pdfUrl !== undefined ? { pdfUrl } : {}),
      ...(licenseUrl !== undefined ? { licenseUrl } : {}),
    },
  };
}

function findIdentifier(candidates: readonly string[]): ArxivIdentifier | undefined {
  let found: ArxivIdentifier | undefined;
  for (const candidate of candidates) {
    const parsed = parseIdentifier(candidate);
    if (parsed === undefined) continue;
    if (found === undefined) found = parsed;
    if (parsed.canonicalId === found.canonicalId && parsed.version !== undefined) {
      return parsed;
    }
  }
  return found;
}

function parseIdentifier(value: string): ArxivIdentifier | undefined {
  const decoded = decodeEntities(value).trim();
  const prefixed = decoded.match(
    /(?:oai:arxiv\.org:|arxiv:\s*|arxiv\.org\/(?:abs|pdf)\/)([a-z][a-z\d.-]*\/\d{7}|\d{4}\.\d{4,5})(?:v(\d+))?(?:\.pdf)?/i,
  );
  const bare = decoded.match(/^([a-z][a-z\d.-]*\/\d{7}|\d{4}\.\d{4,5})(?:v(\d+))?(?:\.pdf)?$/i);
  const match = prefixed ?? bare;
  const canonicalId = match?.[1];
  if (canonicalId === undefined) return undefined;
  const version = match?.[2];
  return {
    canonicalId,
    ...(version !== undefined ? { version: String(Number.parseInt(version, 10)) } : {}),
  };
}

function documentUrl(
  value: string | undefined,
  kind: "abs" | "pdf",
  fallback: ArxivIdentifier,
): string {
  const parsed = value ? parseIdentifier(value) : undefined;
  const identifier =
    parsed !== undefined && parsed.canonicalId.toLowerCase() === fallback.canonicalId.toLowerCase()
      ? parsed
      : fallback;
  return `https://arxiv.org/${kind}/${identifier.canonicalId}${identifier.version ? `v${identifier.version}` : ""}`;
}

function matchesIdentifier(value: string, expected: ArxivIdentifier): boolean {
  const parsed = parseIdentifier(value);
  return (
    parsed !== undefined && parsed.canonicalId.toLowerCase() === expected.canonicalId.toLowerCase()
  );
}

function readAuthors(block: string): string[] {
  const atomAuthors = [...matchXmlBlocks(block, "author")]
    .map((author) => cleanText(readXmlTag(author, "name")))
    .filter(Boolean);
  if (atomAuthors.length > 0) return uniqueStrings(atomAuthors);

  const creator = cleanText(readXmlTag(block, "creator"));
  return creator ? uniqueStrings(creator.split(/\s*,\s*/)) : [];
}

function readLinks(block: string): XmlLink[] {
  const links: XmlLink[] = [];
  for (const element of matchOpeningTags(block, "link")) {
    const href = cleanText(readXmlAttribute(element, "link", "href"));
    if (!href) continue;
    links.push({
      href: decodeEntities(href),
      rel: cleanText(readXmlAttribute(element, "link", "rel")).toLowerCase(),
      title: cleanText(readXmlAttribute(element, "link", "title")).toLowerCase(),
      type: cleanText(readXmlAttribute(element, "link", "type")).toLowerCase(),
    });
  }
  return links;
}

function readOpeningTagAttributes(
  xml: string,
  elementLocalName: string,
  attributeLocalName: string,
): string[] {
  const values: string[] = [];
  for (const element of matchOpeningTags(xml, elementLocalName)) {
    const value = cleanText(readXmlAttribute(element, elementLocalName, attributeLocalName));
    if (value) values.push(value);
  }
  return values;
}

function* matchOpeningTags(xml: string, localName: string): Generator<string> {
  const escapedName = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<(?:[\\w.-]+:)?${escapedName}(?=[\\s/>])[^>]*>`, "gi");
  for (const match of xml.matchAll(pattern)) {
    const element = match[0];
    if (element !== undefined) yield element;
  }
}

function announcementAbstract(value: string): string {
  const abstract = value.match(/\bAbstract:\s*([\s\S]*)/i)?.[1];
  return cleanText(abstract ?? value);
}

function normalizeDoi(value: string): string {
  return value
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
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

function toIsoDate(value: string): string | undefined {
  return value ? parsePublishedAt(value)?.instant : undefined;
}

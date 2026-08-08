import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, decodeEntities, safeHttpUrl, stableId, stripTags } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata } from "../types.js";
import { crossrefWorksUrl, type CrossrefWorksOptions } from "./crossref.urls.js";

export {
  CROSSREF_INITIAL_CURSOR,
  CROSSREF_MAX_OFFSET,
  CROSSREF_MAX_ROWS,
  CROSSREF_WORKS_URL,
  crossrefWorksUrl,
} from "./crossref.urls.js";
export type {
  CrossrefFilterValue,
  CrossrefWorksOptions,
  CrossrefWorksUrlOptions,
} from "./crossref.urls.js";

export interface CrossrefWorksPage {
  readonly items: ResearchPaper[];
  readonly totalResults?: number;
  readonly nextCursor?: string;
}

/** Fetches one page from the Crossref Works API. */
export async function fetchCrossrefWorks(
  query: string,
  options: CrossrefWorksOptions = {},
): Promise<CrossrefWorksPage> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { items: [] };
  const body = await fetchText(crossrefWorksUrl(query, options), options);
  return parseCrossrefWorks(body, limit);
}

/** Parses a Crossref Works response. Pure and network-free. */
export function parseCrossrefWorks(body: string, limit?: number): CrossrefWorksPage {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return { items: [] };

  const payload = parseJsonRecord(body, "Crossref Works");
  const message = payload["message"];
  if (!isRecord(message) || Array.isArray(message)) {
    throw new Error("unexpected Crossref Works response shape");
  }
  const works = recordArray(message["items"]);

  const items: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const work of works) {
    const paper = parseCrossrefWork(work);
    if (!paper) continue;
    const key = paper.research.doi ?? paper.research.externalId ?? paper.title;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(paper);
    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  if (works.length > 0 && items.length === 0) {
    throw new Error("Crossref Works response contained no valid records");
  }

  const totalResults = nonNegativeInteger(numberField(message, "total-results"));
  const nextCursor = nonBlank(stringField(message, "next-cursor"));
  return {
    items,
    ...(totalResults !== undefined ? { totalResults } : {}),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function parseCrossrefWork(work: Record<string, unknown>): ResearchPaper | undefined {
  const doi = normalizeDoi(stringField(work, "DOI"));
  if (!doi) return undefined;
  const title = nonBlank(cleanText(stripTags(firstString(work["title"]) ?? "")));
  if (!title) return undefined;

  const doiUrl = `https://doi.org/${doi}`;
  const container = nonBlank(cleanText(firstString(work["container-title"]) ?? ""));
  const publisher = nonBlank(stringField(work, "publisher"));
  const authorship = readAuthorship(work);
  const categories = stringItems(work["subject"]);
  const type = nonBlank(stringField(work, "type"));
  const issue = nonBlank(stringField(work, "issue"));

  const issuedParts = readDateParts(work["issued"]);
  const issuedText = formatDateParts(issuedParts);
  const createdAt = readDateTime(work["created"]);
  const publishedAt =
    (issuedParts.length === 3 && issuedText ? parsePublishedAt(issuedText)?.instant : undefined) ??
    createdAt;
  const updatedAt = readDateTime(work["deposited"]);

  const abstract = nonBlank(
    cleanText(decodeEntities(stripTags(stringField(work, "abstract") ?? ""))),
  );
  const pdfUrl = readPdfUrl(work["link"]);
  const licenseUrl = readLicenseUrl(work["license"]);
  const url = safeHttpUrl(stringField(work, "URL") ?? "") ?? doiUrl;

  const research: ResearchPaperMetadata = {
    externalId: doi,
    doi,
    ...(authorship.authors.length > 0 ? { authors: authorship.authors } : {}),
    ...(authorship.institutions.length > 0
      ? { institution: authorship.institutions.join("; ") }
      : {}),
    ...(container ? { series: container } : {}),
    ...(issue ? { issue } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(createdAt ? { announcedAt: createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
    ...(licenseUrl ? { licenseUrl } : {}),
  };
  const tags = uniqueStrings([type, ...categories]);

  return {
    id: stableId(["crossref", doi, title]),
    provider: "crossref",
    kind: "analysis",
    title,
    url,
    canonicalUrl: doiUrl,
    source: container ?? publisher ?? "Crossref",
    ...(publishedAt ? { publishedAt } : {}),
    ...(issuedText ? { publishedAtText: issuedText } : {}),
    ...(abstract ? { summary: abstract } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    research,
  };
}

interface CrossrefAuthorship {
  readonly authors: string[];
  readonly institutions: string[];
}

function readAuthorship(work: Record<string, unknown>): CrossrefAuthorship {
  const authors: string[] = [];
  const institutions: string[] = [];
  for (const author of recordArray(work["author"])) {
    const name = cleanText(
      [stringField(author, "given") ?? "", stringField(author, "family") ?? ""].join(" "),
    );
    if (name) authors.push(name);
    for (const affiliation of recordArray(author["affiliation"])) {
      const institution = nonBlank(cleanText(stringField(affiliation, "name") ?? ""));
      if (institution) institutions.push(institution);
    }
  }
  return { authors: uniqueStrings(authors), institutions: uniqueStrings(institutions) };
}

/** Reads the first `[year, month?, day?]` entry of a Crossref date field. */
function readDateParts(value: unknown): readonly number[] {
  if (!isRecord(value) || Array.isArray(value)) return [];
  const parts = value["date-parts"];
  if (!Array.isArray(parts)) return [];
  const first = parts[0];
  if (!Array.isArray(first)) return [];
  const numbers: number[] = [];
  for (const part of first) {
    if (typeof part !== "number" || !Number.isInteger(part)) break;
    numbers.push(part);
  }
  return numbers;
}

function formatDateParts(parts: readonly number[]): string | undefined {
  const [year, month, day] = parts;
  if (year === undefined || year < 1000 || year > 9999) return undefined;
  const segments = [String(year)];
  if (month !== undefined && month >= 1 && month <= 12) {
    segments.push(String(month).padStart(2, "0"));
    if (day !== undefined && day >= 1 && day <= 31) segments.push(String(day).padStart(2, "0"));
  }
  return segments.join("-");
}

function readDateTime(value: unknown): string | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  const text = stringField(value, "date-time");
  return text ? parsePublishedAt(text)?.instant : undefined;
}

function readPdfUrl(value: unknown): string | undefined {
  for (const link of recordArray(value)) {
    const contentType = stringField(link, "content-type");
    const url = safeHttpUrl(stringField(link, "URL") ?? "");
    if (!url) continue;
    if (contentType === "application/pdf" || new URL(url).pathname.toLowerCase().endsWith(".pdf")) {
      return url;
    }
  }
  return undefined;
}

function readLicenseUrl(value: unknown): string | undefined {
  for (const license of recordArray(value)) {
    const url = safeHttpUrl(stringField(license, "URL") ?? "");
    if (url) return url;
  }
  return undefined;
}

function normalizeDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const stripped = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:/i, "");
  const doi = stripped.toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined;
}

function stringItems(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

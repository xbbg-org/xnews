import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import {
  isRecord,
  numberField,
  parseJsonRecord,
  recordArray,
  stringArrayField,
  stringField,
} from "../json.js";
import { normalizeLimit } from "../options.js";
import { safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata } from "../types.js";
import {
  OPENALEX_MAX_PER_PAGE,
  openAlexWorksUrl,
  type OpenAlexWorksOptions,
} from "./openalex.urls.js";

export {
  OPENALEX_DEFAULT_PER_PAGE,
  OPENALEX_INITIAL_CURSOR,
  OPENALEX_MAX_PER_PAGE,
  OPENALEX_MAX_REQUESTS_PER_SECOND,
  openAlexWorksUrl,
} from "./openalex.urls.js";
export type { OpenAlexFilterValue, OpenAlexWorksOptions } from "./openalex.urls.js";

const OPENALEX_ABSTRACT_MAX_TOKENS = 10_000;
const OPENALEX_ABSTRACT_MAX_POSITIONS = 50_000;
const OPENALEX_ABSTRACT_MAX_OUTPUT_LENGTH = 1_000_000;
const OPENALEX_ABSTRACT_BUDGET_ERROR = "OpenAlex Works abstract exceeded parser limits";

export interface OpenAlexWorksPage {
  readonly items: ResearchPaper[];
  readonly count?: number;
  readonly nextCursor?: string;
  readonly perPage: number;
}

export async function fetchOpenAlexWorks(
  query: string,
  options: OpenAlexWorksOptions,
): Promise<OpenAlexWorksPage> {
  const url = openAlexWorksUrl(query, options);
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { items: [], perPage: 0 };
  const body = await fetchText(url, options);
  return parseOpenAlexWorks(body, limit);
}

export function parseOpenAlexWorks(body: string, limit?: number): OpenAlexWorksPage {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return { items: [], perPage: 0 };

  const payload = parseJsonRecord(body, "OpenAlex Works");
  const meta = payload["meta"];
  const results = payload["results"];
  if (!isRecord(meta) || Array.isArray(meta) || !Array.isArray(results)) {
    throw new Error("unexpected OpenAlex Works response shape");
  }
  if (results.length > OPENALEX_MAX_PER_PAGE) {
    throw new Error("OpenAlex Works response exceeded maximum page size");
  }

  const items: ResearchPaper[] = [];
  for (const value of results) {
    if (!isRecord(value) || Array.isArray(value)) continue;
    const paper = parseWork(value);
    if (!paper) continue;
    items.push(paper);
    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  if (results.length > 0 && items.length === 0) {
    throw new Error("OpenAlex Works response contained no valid records");
  }

  const count = nonNegativeInteger(numberField(meta, "count"));
  const nextCursor = nonBlank(stringField(meta, "next_cursor"));
  const upstreamPerPage = nonNegativeInteger(numberField(meta, "per_page"));
  return {
    items,
    ...(count !== undefined ? { count } : {}),
    ...(nextCursor ? { nextCursor } : {}),
    perPage: upstreamPerPage ?? items.length,
  };
}

function parseWork(work: Record<string, unknown>): ResearchPaper | undefined {
  const ids = recordField(work, "ids");
  const externalId =
    normalizeOpenAlexWorkId(stringField(work, "id")) ??
    normalizeOpenAlexWorkId(ids ? stringField(ids, "openalex") : undefined);
  const title = nonBlank(stringField(work, "display_name")) ?? nonBlank(stringField(work, "title"));
  if (!externalId || !title) return undefined;

  const doi =
    normalizeDoi(stringField(work, "doi")) ??
    normalizeDoi(ids ? stringField(ids, "doi") : undefined);
  const doiUrl = doi ? canonicalDoiUrl(doi) : undefined;
  const workUrl = `https://openalex.org/${externalId}`;
  const locations = readLocations(work);
  const landingUrl = locations.map((location) => location.landingPageUrl).find(Boolean);
  const url = landingUrl ?? doiUrl ?? workUrl;
  const canonicalUrl = doiUrl ?? landingUrl ?? workUrl;

  const source = locations.map((location) => location.sourceName).find(Boolean) ?? "OpenAlex";
  const authorship = readAuthorship(work);
  const topics = uniqueStrings(
    recordArray(work["topics"]).map((topic) => stringField(topic, "display_name")),
  );
  const type = nonBlank(stringField(work, "type"));
  const publicationDate = nonBlank(stringField(work, "publication_date"));
  const publishedAt = publicationDate ? parsePublishedAt(publicationDate)?.instant : undefined;
  const updatedAtText = nonBlank(stringField(work, "updated_date"));
  const updatedAt = updatedAtText ? parsePublishedAt(updatedAtText)?.instant : undefined;
  const abstract = reconstructAbstract(work["abstract_inverted_index"]);
  const primaryLocation = locations[0];
  const biblio = recordField(work, "biblio");
  const issue = biblio ? nonBlank(stringField(biblio, "issue")) : undefined;
  const pdfUrl = locations.map((location) => location.pdfUrl).find(Boolean);
  const licenseUrl = locations.map((location) => location.licenseUrl).find(Boolean);

  const research: ResearchPaperMetadata = {
    externalId,
    ...(doi ? { doi } : {}),
    ...(authorship.authors.length > 0 ? { authors: authorship.authors } : {}),
    ...(authorship.institutions.length > 0
      ? { institution: authorship.institutions.join("; ") }
      : {}),
    ...(authorship.countries.length > 0 ? { country: authorship.countries.join("; ") } : {}),
    ...(source !== "OpenAlex" ? { series: source } : {}),
    ...(issue ? { issue } : {}),
    ...(topics.length > 0 ? { categories: topics } : {}),
    ...(primaryLocation?.version ? { version: primaryLocation.version } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
    ...(licenseUrl ? { licenseUrl } : {}),
  };
  const tags = uniqueStrings([type, ...topics]);

  return {
    id: stableId(["openalex", externalId, title]),
    provider: "openalex",
    kind: "analysis",
    title,
    url,
    canonicalUrl,
    source,
    ...(publishedAt ? { publishedAt } : {}),
    ...(publicationDate ? { publishedAtText: publicationDate } : {}),
    ...(abstract ? { summary: abstract } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    research,
  };
}

interface OpenAlexLocation {
  readonly landingPageUrl?: string;
  readonly pdfUrl?: string;
  readonly sourceName?: string;
  readonly licenseUrl?: string;
  readonly version?: string;
}

function readLocations(work: Record<string, unknown>): OpenAlexLocation[] {
  const candidates: Record<string, unknown>[] = [];
  for (const key of ["primary_location", "best_oa_location"] as const) {
    const location = recordField(work, key);
    if (location) candidates.push(location);
  }
  candidates.push(...recordArray(work["locations"]));

  const locations: OpenAlexLocation[] = [];
  const seen = new Set<Record<string, unknown>>();
  for (const location of candidates) {
    if (seen.has(location)) continue;
    seen.add(location);
    const source = recordField(location, "source");
    const landingPageUrl = normalizeHttpUrl(stringField(location, "landing_page_url"));
    const pdfUrl = normalizeHttpUrl(stringField(location, "pdf_url"));
    const sourceName =
      nonBlank(source ? stringField(source, "display_name") : undefined) ??
      nonBlank(stringField(location, "raw_source_name"));
    const licenseUrl =
      normalizeLicenseUrl(stringField(location, "license_id")) ??
      normalizeLicenseUrl(stringField(location, "license"));
    const version = nonBlank(stringField(location, "version"));
    locations.push({
      ...(landingPageUrl ? { landingPageUrl } : {}),
      ...(pdfUrl ? { pdfUrl } : {}),
      ...(sourceName ? { sourceName } : {}),
      ...(licenseUrl ? { licenseUrl } : {}),
      ...(version ? { version } : {}),
    });
  }
  return locations;
}

interface OpenAlexAuthorship {
  readonly authors: string[];
  readonly institutions: string[];
  readonly countries: string[];
}

function readAuthorship(work: Record<string, unknown>): OpenAlexAuthorship {
  const authors: (string | undefined)[] = [];
  const institutions: (string | undefined)[] = [];
  const countries: (string | undefined)[] = [];

  for (const authorship of recordArray(work["authorships"])) {
    const author = recordField(authorship, "author");
    authors.push(
      nonBlank(author ? stringField(author, "display_name") : undefined) ??
        nonBlank(stringField(authorship, "raw_author_name")),
    );
    let hasResolvedInstitution = false;
    for (const institution of recordArray(authorship["institutions"])) {
      const institutionName = nonBlank(stringField(institution, "display_name"));
      if (institutionName) {
        institutions.push(institutionName);
        hasResolvedInstitution = true;
      }
      countries.push(nonBlank(stringField(institution, "country_code")));
    }
    countries.push(...stringArrayField(authorship, "countries"));

    if (!hasResolvedInstitution) {
      institutions.push(...stringArrayField(authorship, "raw_affiliation_strings"));
      for (const affiliation of recordArray(authorship["affiliations"])) {
        institutions.push(nonBlank(stringField(affiliation, "raw_affiliation_string")));
      }
    }
  }

  return {
    authors: uniqueStrings(authors),
    institutions: uniqueStrings(institutions),
    countries: uniqueStrings(countries),
  };
}

function reconstructAbstract(value: unknown): string | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;

  const positioned: (string | string[] | undefined)[] = [];
  let tokenCount = 0;
  let positionCount = 0;
  let outputLength = 0;
  for (const word in value) {
    if (!Object.hasOwn(value, word)) continue;
    tokenCount += 1;
    if (tokenCount > OPENALEX_ABSTRACT_MAX_TOKENS) {
      throw new Error(OPENALEX_ABSTRACT_BUDGET_ERROR);
    }

    const positions = value[word];
    if (!word || !Array.isArray(positions)) continue;
    positionCount += positions.length;
    if (positionCount > OPENALEX_ABSTRACT_MAX_POSITIONS) {
      throw new Error(OPENALEX_ABSTRACT_BUDGET_ERROR);
    }

    for (const position of positions) {
      if (typeof position !== "number" || !Number.isInteger(position) || position < 0) continue;
      if (position >= OPENALEX_ABSTRACT_MAX_POSITIONS) {
        throw new Error(OPENALEX_ABSTRACT_BUDGET_ERROR);
      }
      outputLength += word.length + (outputLength > 0 ? 1 : 0);
      if (outputLength > OPENALEX_ABSTRACT_MAX_OUTPUT_LENGTH) {
        throw new Error(OPENALEX_ABSTRACT_BUDGET_ERROR);
      }

      const existing = positioned[position];
      if (existing === undefined) {
        positioned[position] = word;
      } else if (typeof existing === "string") {
        positioned[position] = [existing, word];
      } else {
        existing.push(word);
      }
    }
  }

  let abstract = "";
  for (const valueAtPosition of positioned) {
    if (valueAtPosition === undefined) continue;
    if (typeof valueAtPosition === "string") {
      abstract += abstract ? ` ${valueAtPosition}` : valueAtPosition;
      continue;
    }
    for (const word of valueAtPosition) {
      abstract += abstract ? ` ${word}` : word;
    }
  }
  return abstract || undefined;
}

function normalizeOpenAlexWorkId(value: string | undefined): string | undefined {
  const normalized = nonBlank(value);
  if (!normalized) return undefined;
  const direct = normalized.match(/^W\d+$/i)?.[0];
  if (direct) return direct.toUpperCase();
  const url = normalizeHttpUrl(normalized);
  if (!url) return undefined;
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== "openalex.org") return undefined;
  const id = parsed.pathname.split("/").findLast(Boolean);
  return id && /^W\d+$/i.test(id) ? id.toUpperCase() : undefined;
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

function canonicalDoiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
  const normalized = nonBlank(value);
  if (!normalized || !safeHttpUrl(normalized)) return undefined;
  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase();
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = normalizeDoi(normalized);
    if (doi) return canonicalDoiUrl(doi);
  }
  parsed.hash = "";
  return parsed.toString();
}

function normalizeLicenseUrl(value: string | undefined): string | undefined {
  const normalized = nonBlank(value);
  if (!normalized) return undefined;
  const url = normalizeHttpUrl(normalized);
  if (url) return url;
  return /^[a-z0-9.-]+$/i.test(normalized)
    ? `https://openalex.org/licenses/${normalized.toLowerCase()}`
    : undefined;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) && !Array.isArray(value) ? value : undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = nonBlank(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

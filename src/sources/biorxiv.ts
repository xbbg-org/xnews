import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { bioRxivDetailsUrl, type BioRxivServer } from "./biorxiv.urls.js";

export { BIORXIV_API_ORIGIN, bioRxivDetailsUrl } from "./biorxiv.urls.js";
export type { BioRxivDetailsUrlOptions, BioRxivServer } from "./biorxiv.urls.js";

export interface BioRxivPapersOptions extends SourceFetchOptions {
  readonly server?: BioRxivServer;
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: number;
  readonly categories?: readonly string[];
}

export interface BioRxivParseOptions {
  readonly limit?: number;
  readonly categories?: readonly string[];
}

const DAYS_IN_DEFAULT_WINDOW = 7;

export async function fetchBioRxivPapers(
  options: BioRxivPapersOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const to = options.to ?? new Date().toISOString().slice(0, 10);
  const from = options.from ?? daysBefore(to, DAYS_IN_DEFAULT_WINDOW);
  const url = bioRxivDetailsUrl(options.server ?? "biorxiv", {
    from,
    to,
    ...(options.cursor !== undefined ? { cursor: options.cursor } : {}),
  });
  const body = await fetchText(url, options);
  return parseBioRxivPapers(body, {
    ...(limit !== undefined ? { limit } : {}),
    ...(options.categories !== undefined ? { categories: options.categories } : {}),
  });
}

/** Parses one bioRxiv/medRxiv details page. Pure and network-free. */
export function parseBioRxivPapers(
  body: string,
  options: BioRxivParseOptions = {},
): ResearchPaper[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "bioRxiv details");
  const collection = payload["collection"];
  if (!Array.isArray(collection)) {
    throw new Error("unexpected bioRxiv details response shape");
  }

  const requestedCategories = new Set(
    (options.categories ?? []).map((category) => category.trim().toLowerCase()).filter(Boolean),
  );
  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  let validRecordCount = 0;

  for (const value of collection) {
    if (!isRecord(value) || Array.isArray(value)) continue;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseBioRxivRecord(value);
    } catch {
      // A malformed record must not discard otherwise valid preprints.
      continue;
    }
    if (paper === undefined) continue;
    validRecordCount += 1;
    if (!matchesCategories(paper, requestedCategories)) continue;

    const externalId = paper.research.externalId;
    if (externalId === undefined || seen.has(externalId)) continue;
    seen.add(externalId);
    papers.push(paper);
    if (limit !== undefined && papers.length >= limit) return papers;
  }

  if (collection.length > 0 && validRecordCount === 0) {
    throw new Error("bioRxiv details response contained no valid records");
  }
  return papers;
}

function parseBioRxivRecord(record: Record<string, unknown>): ResearchPaper | undefined {
  const provider = normalizeServer(stringField(record, "server"));
  const doi = normalizeDoi(stringField(record, "doi"));
  const title = cleanJsonText(stringField(record, "title"));
  const version = cleanJsonText(stringField(record, "version"));
  if (!provider || !doi || !title || !version || !/^[1-9]\d*$/.test(version)) {
    return undefined;
  }

  const externalId = `${doi}v${version}`;
  const url = `https://www.${provider}.org/content/${externalId}`;
  const source = provider === "biorxiv" ? "bioRxiv" : "medRxiv";
  const authors = uniqueStrings(
    (stringField(record, "authors") ?? "").split(";").map((author) => cleanText(author)),
  );
  const institution = cleanJsonText(stringField(record, "author_corresponding_institution"));
  const category = cleanJsonText(stringField(record, "category"));
  const publishedAtText = cleanJsonText(stringField(record, "date"));
  const publishedAt = publishedAtText ? parsePublishedAt(publishedAtText)?.instant : undefined;
  const summary = cleanJsonText(stringField(record, "abstract"));

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    ...(institution ? { institution } : {}),
    series: source,
    doi,
    ...(category ? { categories: [category] } : {}),
    externalId,
    version,
    ...(publishedAt ? { submittedAt: publishedAt } : {}),
  };

  return {
    id: stableId([provider, externalId, title]),
    provider,
    kind: "analysis",
    title,
    url,
    canonicalUrl: `https://doi.org/${doi}`,
    source,
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    ...(category ? { tags: [category] } : {}),
    research,
  };
}

function normalizeServer(value: string | undefined): BioRxivServer | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "biorxiv" || normalized === "medrxiv" ? normalized : undefined;
}

function normalizeDoi(value: string | undefined): string | undefined {
  let normalized = value?.trim();
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

function matchesCategories(paper: ResearchPaper, requested: ReadonlySet<string>): boolean {
  if (requested.size === 0) return true;
  return (paper.research.categories ?? []).some((category) =>
    requested.has(category.toLowerCase()),
  );
}

function cleanJsonText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

function daysBefore(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

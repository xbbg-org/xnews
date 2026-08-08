import { parsePublishedAt } from "../dates.js";
import { fetchJsonText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, stringArrayField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata } from "../types.js";
import { osfPreprintsUrl, type OsfPreprintsOptions } from "./osf.urls.js";

export { OSF_PREPRINTS_URL, osfPreprintsUrl } from "./osf.urls.js";
export type { OsfPreprintsOptions, OsfPreprintsUrlOptions } from "./osf.urls.js";

const MAX_OSF_PREPRINTS_PAGE_SIZE = 100;

export interface OsfPreprintsPage {
  readonly items: ResearchPaper[];
  readonly nextUrl?: string;
}

export async function fetchOsfPreprints(
  options: OsfPreprintsOptions = {},
): Promise<OsfPreprintsPage> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { items: [] };

  const url = osfPreprintsUrl({
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.pageSize !== undefined
      ? { pageSize: options.pageSize }
      : limit !== undefined
        ? { pageSize: Math.min(limit, MAX_OSF_PREPRINTS_PAGE_SIZE) }
        : {}),
    ...(options.sort !== undefined ? { sort: options.sort } : {}),
    ...(options.publishedSince !== undefined ? { publishedSince: options.publishedSince } : {}),
    ...(options.publishedUntil !== undefined ? { publishedUntil: options.publishedUntil } : {}),
  });
  return parseOsfPreprints(await fetchJsonText(url, options), limit);
}

/** Parses one OSF preprints JSON:API page. Pure and network-free. */
export function parseOsfPreprints(body: string, limit?: number): OsfPreprintsPage {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return { items: [] };

  const payload = parseJsonRecord(body, "OSF Preprints");
  const data = payload["data"];
  if (!Array.isArray(data)) {
    throw new Error("unexpected OSF Preprints response shape");
  }

  const items: ResearchPaper[] = [];
  const seenExternalIds = new Set<string>();
  for (const value of data) {
    if (!isRecord(value) || Array.isArray(value)) continue;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseOsfPreprint(value);
    } catch {
      continue;
    }
    if (!paper) continue;

    const externalId = paper.research.externalId;
    if (!externalId || seenExternalIds.has(externalId)) continue;
    seenExternalIds.add(externalId);
    items.push(paper);
    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }
  if (data.length > 0 && items.length === 0) {
    throw new Error("OSF Preprints response contained no valid records");
  }

  const links = recordField(payload, "links");
  const nextUrl = safeHttpUrl(nonBlank(links ? stringField(links, "next") : undefined) ?? "");
  return {
    items,
    ...(nextUrl !== undefined ? { nextUrl } : {}),
  };
}

function parseOsfPreprint(record: Record<string, unknown>): ResearchPaper | undefined {
  if (stringField(record, "type") !== "preprints") return undefined;

  const attributes = recordField(record, "attributes");
  const links = recordField(record, "links");
  if (!attributes || !links) return undefined;

  const externalId = nonBlank(stringField(record, "id"));
  const title = cleanJsonText(stringField(attributes, "title"));
  const url = safeHttpUrl(nonBlank(stringField(links, "html")) ?? "");
  if (!externalId || !title || !url) return undefined;

  const relationships = recordField(record, "relationships");
  const providerRelationship = relationships ? recordField(relationships, "provider") : undefined;
  const providerData = providerRelationship ? recordField(providerRelationship, "data") : undefined;
  const series = cleanJsonText(providerData ? stringField(providerData, "id") : undefined);
  const source = series ?? "OSF Preprints";

  const publishedAtText = cleanJsonText(stringField(attributes, "date_published"));
  const publishedAt = publishedAtText ? parsePublishedAt(publishedAtText)?.instant : undefined;
  const submittedAtText = cleanJsonText(stringField(attributes, "date_created"));
  const submittedAt = submittedAtText ? parsePublishedAt(submittedAtText)?.instant : undefined;
  const updatedAtText = cleanJsonText(stringField(attributes, "date_modified"));
  const updatedAt = updatedAtText ? parsePublishedAt(updatedAtText)?.instant : undefined;
  const summary = cleanJsonText(stringField(attributes, "description"));
  const categories = readSubjectCategories(attributes["subjects"]);
  const tags = uniqueStrings(stringArrayField(attributes, "tags").map(cleanText));
  const doi =
    normalizeDoi(stringField(links, "preprint_doi")) ??
    normalizeDoi(stringField(attributes, "doi"));
  const versionValue = numberField(attributes, "version");
  const version =
    versionValue !== undefined && Number.isInteger(versionValue) && versionValue > 0
      ? String(versionValue)
      : undefined;

  const research: ResearchPaperMetadata = {
    externalId,
    ...(series ? { series } : {}),
    ...(doi ? { doi } : {}),
    ...(categories.length > 0 ? { categories } : {}),
    ...(version ? { version } : {}),
    ...(submittedAt ? { submittedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };

  return {
    id: stableId(["osf-preprints", externalId, title]),
    provider: "osf-preprints",
    kind: "analysis",
    title,
    url,
    canonicalUrl: doi ? canonicalDoiUrl(doi) : url,
    source,
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    research,
  };
}

function readSubjectCategories(value: unknown): string[] {
  const categories: string[] = [];
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        pending.push(candidate[index]);
      }
      continue;
    }
    if (!isRecord(candidate)) continue;
    const text = cleanJsonText(stringField(candidate, "text"));
    if (text) categories.push(text);
  }
  return uniqueStrings(categories);
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

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  return isRecord(value) && !Array.isArray(value) ? value : undefined;
}

function cleanJsonText(value: string | undefined): string | undefined {
  const normalized = value === undefined ? "" : cleanText(value);
  return normalized || undefined;
}

function nonBlank(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
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

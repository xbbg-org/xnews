import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { normalizeDoi } from "../works.js";
import { worldBankDocumentsUrl, type WorldBankDocumentsUrlOptions } from "./worldbank.urls.js";

export { WORLD_BANK_DOCUMENTS_API_URL, worldBankDocumentsUrl } from "./worldbank.urls.js";
export type { WorldBankDocumentsUrlOptions } from "./worldbank.urls.js";

export type WorldBankDocumentsOptions = Omit<SourceFetchOptions, "since" | "until"> &
  WorldBankDocumentsUrlOptions;

export async function fetchWorldBankDocuments(
  query = "",
  options: WorldBankDocumentsOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const url = worldBankDocumentsUrl(query, {
    ...(options.docTypes !== undefined ? { docTypes: options.docTypes } : {}),
    ...(options.languages !== undefined ? { languages: options.languages } : {}),
    ...(options.rows !== undefined
      ? { rows: options.rows }
      : limit !== undefined
        ? { rows: limit }
        : {}),
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    ...(options.sortBy !== undefined ? { sortBy: options.sortBy } : {}),
    ...(options.order !== undefined ? { order: options.order } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
    ...(options.until !== undefined ? { until: options.until } : {}),
    ...(options.fields !== undefined ? { fields: options.fields } : {}),
    ...(options.extraParams !== undefined ? { extraParams: options.extraParams } : {}),
  });
  return parseWorldBankDocuments(await fetchText(url, options), limit);
}

/** Parses one World Bank Documents & Reports WDS response. Pure and network-free. */
export function parseWorldBankDocuments(body: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "World Bank Documents");
  const documents = payload["documents"];
  if (!isRecord(documents) || Array.isArray(documents)) {
    throw new Error("unexpected World Bank Documents response shape");
  }

  let candidateCount = 0;
  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const key in documents) {
    if (!Object.hasOwn(documents, key)) continue;
    const value = documents[key];
    if (!isRecord(value) || Array.isArray(value)) continue;

    const externalId = cleanStringField(value, "id");
    if (!externalId) continue;
    candidateCount += 1;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseWorldBankDocument(value, externalId);
    } catch {
      continue;
    }
    if (!paper || seen.has(externalId)) continue;
    seen.add(externalId);
    papers.push(paper);
    if (normalizedLimit !== undefined && papers.length >= normalizedLimit) break;
  }

  if (candidateCount > 0 && papers.length === 0) {
    throw new Error("World Bank Documents response contained no valid records");
  }
  return papers;
}

function parseWorldBankDocument(
  document: Record<string, unknown>,
  externalId: string,
): ResearchPaper | undefined {
  const title =
    cleanStringField(document, "display_title") ??
    readNestedText(document["docna"], ["docna", "display_title"]);
  const landingUrlText = cleanStringField(document, "url");
  const url = landingUrlText ? safeHttpUrl(landingUrlText) : undefined;
  if (!title || !url) return undefined;

  const publishedAtText = cleanStringField(document, "docdt");
  const publishedAt = publishedAtText ? parsePublishedAt(publishedAtText)?.instant : undefined;
  const updatedAtText = cleanStringField(document, "last_modified_date");
  const updatedAt = updatedAtText ? parsePublishedAt(updatedAtText)?.instant : undefined;
  const authors = readAuthors(document["authors"]);
  const country = cleanStringField(document, "count");
  const series = cleanStringField(document, "docty");
  const doiText = readNestedText(document["doi"], ["doi"]);
  const doi = doiText ? normalizeDoi(doiText) : undefined;
  const pdfUrlText = cleanStringField(document, "pdfurl");
  const pdfUrl = pdfUrlText ? safeHttpUrl(pdfUrlText) : undefined;
  const summary =
    readNestedText(document["abstract"], ["abstract"]) ??
    readNestedText(document["abstracts"], ["abstracts", "abstract"]);

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    institution: "World Bank",
    ...(country ? { country } : {}),
    ...(series ? { series } : {}),
    ...(doi ? { doi } : {}),
    externalId,
    ...(updatedAt ? { updatedAt } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
  };

  return {
    id: stableId(["world-bank", externalId, title]),
    provider: "world-bank",
    kind: "analysis",
    title,
    url,
    canonicalUrl: doi ? `https://doi.org/${doi}` : url,
    source: "World Bank",
    ...(publishedAt ? { publishedAt } : {}),
    ...(publishedAtText ? { publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    research,
  };
}

function cleanStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key);
  if (value === undefined) return undefined;
  return cleanText(value) || undefined;
}

function readNestedText(value: unknown, fieldNames: readonly string[]): string | undefined {
  if (typeof value === "string") return cleanText(value) || undefined;
  if (!isRecord(value) || Array.isArray(value)) return undefined;

  for (const fieldName of fieldNames) {
    const direct = cleanStringField(value, fieldName);
    if (direct) return direct;
  }
  for (const nested of Object.values(value)) {
    if (typeof nested === "string") {
      const cleaned = cleanText(nested);
      if (cleaned) return cleaned;
      continue;
    }
    if (!isRecord(nested) || Array.isArray(nested)) continue;
    for (const fieldName of fieldNames) {
      const cleaned = cleanStringField(nested, fieldName);
      if (cleaned) return cleaned;
    }
  }
  return undefined;
}

function readAuthors(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const authors: string[] = [];
  const seen = new Set<string>();
  for (const candidate of Object.values(value)) {
    const author =
      typeof candidate === "string"
        ? cleanText(candidate) || undefined
        : isRecord(candidate) && !Array.isArray(candidate)
          ? cleanStringField(candidate, "author")
          : undefined;
    if (!author || seen.has(author)) continue;
    seen.add(author);
    authors.push(author);
  }
  return authors;
}

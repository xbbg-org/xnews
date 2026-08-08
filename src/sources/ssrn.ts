import { parsePublishedAt } from "../dates.js";
import { DEFAULT_USER_AGENT, fetchJsonText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, safeHttpUrl, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { ssrnPapersUrl, type SsrnNetwork, type SsrnPapersUrlOptions } from "./ssrn.urls.js";

export { SSRN_NETWORKS, resolveSsrnBindingId, ssrnPapersUrl } from "./ssrn.urls.js";
export type { SsrnNetwork, SsrnPapersUrlOptions } from "./ssrn.urls.js";

export type SsrnPapersOptions = SsrnPapersUrlOptions & SourceFetchOptions;

export async function fetchSsrnPapers(
  network: SsrnNetwork,
  options: SsrnPapersOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const url = ssrnPapersUrl(network, {
    ...(options.index !== undefined ? { index: options.index } : {}),
    ...(options.count !== undefined
      ? { count: options.count }
      : limit !== undefined
        ? { count: limit }
        : {}),
    ...(options.sort !== undefined ? { sort: options.sort } : {}),
  });
  const body = await fetchJsonText(url, options, options.userAgent ?? DEFAULT_USER_AGENT);
  return parseSsrnPapers(body, limit);
}

/** Parses one SSRN network-paper response. Pure and network-free. */
export function parseSsrnPapers(body: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const payload = parseJsonRecord(body, "SSRN");
  const candidates = payload["papers"];
  if (!Array.isArray(candidates)) {
    throw new Error("unexpected SSRN response shape");
  }

  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!isRecord(candidate) || Array.isArray(candidate)) continue;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseSsrnPaper(candidate);
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

  if (candidates.length > 0 && papers.length === 0) {
    throw new Error("SSRN response contained no valid records");
  }
  return papers;
}

function parseSsrnPaper(record: Record<string, unknown>): ResearchPaper | undefined {
  const numericId = numberField(record, "id");
  const title = cleanText(stringField(record, "title") ?? "");
  const urlText = stringField(record, "url")?.trim() ?? "";
  const url = safeHttpUrl(urlText);
  if (
    !Number.isSafeInteger(numericId) ||
    numericId === undefined ||
    numericId <= 0 ||
    !title ||
    !url
  ) {
    return undefined;
  }

  const externalId = String(numericId);
  const authors = readAuthors(record["authors"]);
  const affiliations = cleanText(stringField(record, "affiliations") ?? "")
    .replace(/^[,\s]+/, "")
    .trim();
  const series = cleanText(stringField(record, "abstract_type") ?? "");
  const approvedDate = cleanText(stringField(record, "approved_date") ?? "");
  const announcedAt = approvedDate ? parsePublishedAt(approvedDate)?.instant : undefined;

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    ...(affiliations ? { institution: affiliations } : {}),
    ...(series ? { series } : {}),
    externalId,
    ...(announcedAt !== undefined ? { announcedAt } : {}),
  };

  return {
    id: stableId(["ssrn", externalId, title]),
    provider: "ssrn",
    kind: "analysis",
    title,
    url,
    canonicalUrl: url,
    source: "SSRN",
    ...(announcedAt !== undefined ? { publishedAt: announcedAt } : {}),
    ...(approvedDate ? { publishedAtText: approvedDate } : {}),
    research,
  };
}

function readAuthors(value: unknown): string[] {
  const authors: string[] = [];
  for (const author of recordArray(value)) {
    const firstName = cleanText(stringField(author, "first_name") ?? "");
    const lastName = cleanText(stringField(author, "last_name") ?? "");
    const name = cleanText(`${firstName} ${lastName}`);
    if (name) authors.push(name);
  }
  return authors;
}

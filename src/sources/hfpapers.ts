import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId } from "../text.js";
import type { ResearchPaper, ResearchPaperMetadata, SourceFetchOptions } from "../types.js";
import { hfDailyPapersUrl, type HfDailyPapersUrlOptions } from "./hfpapers.urls.js";

export { HF_DAILY_PAPERS_URL, hfDailyPapersUrl } from "./hfpapers.urls.js";
export type { HfDailyPapersUrlOptions } from "./hfpapers.urls.js";

export type HfDailyPapersOptions = SourceFetchOptions & HfDailyPapersUrlOptions;

const HF_DAILY_PAPERS_SOURCE = "Hugging Face Daily Papers";
const ARXIV_ID_PATTERN = /^(?:[a-z][a-z\d.-]*\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i;

export async function fetchHfDailyPapers(
  options: HfDailyPapersOptions = {},
): Promise<ResearchPaper[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const url = hfDailyPapersUrl({
    ...(options.date !== undefined ? { date: options.date } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  return parseHfDailyPapers(await fetchText(url, options), limit);
}

export function parseHfDailyPapers(body: string, limit?: number): ResearchPaper[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("unexpected non-JSON Hugging Face daily papers response");
  }
  if (!Array.isArray(payload)) {
    throw new Error("unexpected Hugging Face daily papers response shape");
  }

  const papers: ResearchPaper[] = [];
  const seen = new Set<string>();
  for (const value of payload) {
    if (!isRecord(value) || Array.isArray(value)) continue;
    const paperRecord = value["paper"];
    if (!isRecord(paperRecord) || Array.isArray(paperRecord)) continue;

    let paper: ResearchPaper | undefined;
    try {
      paper = parseHfDailyPaper(paperRecord, value);
    } catch {
      continue;
    }
    const externalId = paper?.research.externalId;
    if (!paper || !externalId || seen.has(externalId)) continue;

    seen.add(externalId);
    papers.push(paper);
    if (normalizedLimit !== undefined && papers.length >= normalizedLimit) return papers;
  }

  if (payload.length > 0 && papers.length === 0) {
    throw new Error("Hugging Face daily papers response contained no valid records");
  }
  return papers;
}

function parseHfDailyPaper(
  paper: Record<string, unknown>,
  entry: Record<string, unknown>,
): ResearchPaper | undefined {
  const externalId = optionalCleanText(stringField(paper, "id"));
  const title = optionalCleanText(stringField(paper, "title"));
  if (!externalId || !ARXIV_ID_PATTERN.test(externalId) || !title) return undefined;

  const authors = uniqueStrings(
    recordArray(paper["authors"]).map((author) => optionalCleanText(stringField(author, "name"))),
  );
  const summary = optionalCleanText(stringField(paper, "summary"));
  const publishedAtText = nonBlankRaw(stringField(paper, "publishedAt"));
  const publishedAt = publishedAtText ? parsePublishedAt(publishedAtText)?.instant : undefined;
  const submittedOnDailyAt = nonBlankRaw(stringField(paper, "submittedOnDailyAt"));
  const submittedAt = submittedOnDailyAt
    ? parsePublishedAt(submittedOnDailyAt)?.instant
    : undefined;
  const announcedAtText = nonBlankRaw(stringField(entry, "publishedAt"));
  const announcedAt = announcedAtText ? parsePublishedAt(announcedAtText)?.instant : undefined;
  const url = `https://huggingface.co/papers/${externalId}`;
  const canonicalUrl = `https://arxiv.org/abs/${externalId}`;
  const pdfUrl = `https://arxiv.org/pdf/${externalId}`;

  const research: ResearchPaperMetadata = {
    ...(authors.length > 0 ? { authors } : {}),
    series: HF_DAILY_PAPERS_SOURCE,
    externalId,
    ...(submittedAt !== undefined ? { submittedAt } : {}),
    ...(announcedAt !== undefined ? { announcedAt } : {}),
    pdfUrl,
  };

  return {
    id: stableId(["hf-papers", externalId, title]),
    provider: "hf-papers",
    kind: "analysis",
    title,
    url,
    canonicalUrl,
    source: HF_DAILY_PAPERS_SOURCE,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(publishedAtText !== undefined ? { publishedAtText } : {}),
    ...(summary !== undefined ? { summary } : {}),
    research,
  };
}

function optionalCleanText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = cleanText(value);
  return cleaned || undefined;
}

function nonBlankRaw(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  return value;
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

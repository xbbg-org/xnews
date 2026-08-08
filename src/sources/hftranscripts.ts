import { parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import type { NewsItem } from "../types.js";
import {
  earningsTranscriptsFilterUrl,
  HF_EARNINGS_TRANSCRIPTS_DATASET,
  hfDatasetViewerUrl,
  type EarningsTranscriptQueryOptions,
  type HfDatasetRef,
} from "./hftranscripts.urls.js";
export {
  earningsTranscriptsFilterUrl,
  HF_EARNINGS_TRANSCRIPTS_DATASET,
  HF_MAX_PAGE_LENGTH,
  hfDatasetFilterUrl,
  hfDatasetRowsUrl,
  hfDatasetSearchUrl,
  hfDatasetViewerUrl,
} from "./hftranscripts.urls.js";
export type {
  EarningsTranscriptQueryOptions,
  HfDatasetRef,
  HfRowsOptions,
} from "./hftranscripts.urls.js";

/** One speaker turn of an earnings call. */
export interface EarningsCallTranscriptTurn {
  readonly speaker: string;
  readonly text: string;
}

/** One quarterly earnings call transcript from the Hugging Face dataset. */
export interface EarningsCallTranscript {
  readonly symbol: string;
  readonly companyName?: string;
  readonly year: number;
  readonly quarter: number;
  /** ISO 8601 UTC instant of the call, when the dataset row carries a date. */
  readonly publishedAt?: string;
  /** The dataset's raw date string, unmodified. */
  readonly publishedAtText?: string;
  /** Full transcript as one string. */
  readonly content: string;
  /** Speaker-attributed turns; empty when the row has no structured content. */
  readonly turns: readonly EarningsCallTranscriptTurn[];
  /** Dataset viewer page for this row. */
  readonly url: string;
}

/**
 * Fetches a company's earnings-call transcripts, newest first, from the
 * Hugging Face datasets-server — free and keyless. The upstream dataset is a
 * periodically refreshed snapshot (~685 US large-cap issuers, 2005 onward),
 * not a live wire: fresh calls appear only when the dataset is republished.
 */
export async function fetchEarningsCallTranscripts(
  symbol: string,
  options: EarningsTranscriptQueryOptions = {},
): Promise<EarningsCallTranscript[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const body = await fetchText(earningsTranscriptsFilterUrl(symbol, options), options);
  return parseEarningsCallTranscripts(body, {
    ...(limit !== undefined ? { limit } : {}),
    ...(options.dataset ? { dataset: options.dataset } : {}),
  });
}

/** Parses a datasets-server `/filter` or `/rows` response into transcripts. */
export function parseEarningsCallTranscripts(
  body: string,
  options: { readonly limit?: number; readonly dataset?: HfDatasetRef } = {},
): EarningsCallTranscript[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const payload = parseJsonRecord(body, "Hugging Face datasets-server");
  // datasets-server reports failures as {"error": "..."} bodies.
  const errorText = stringField(payload, "error");
  if (errorText) {
    throw new Error(`Hugging Face datasets-server request failed: ${errorText}`);
  }

  const dataset = options.dataset ?? HF_EARNINGS_TRANSCRIPTS_DATASET;
  const transcripts: EarningsCallTranscript[] = [];
  for (const entry of recordArray(payload["rows"])) {
    const row = entry["row"];
    if (!isRecord(row)) continue;

    const symbol = stringField(row, "symbol")?.trim().toUpperCase();
    const year = integerField(row, "year");
    const quarter = integerField(row, "quarter");
    const content = stringField(row, "content");
    if (!symbol || year === undefined || quarter === undefined || !content) continue;

    const rowIdx = integerField(entry, "row_idx");
    const dateText = stringField(row, "date")?.trim();
    const publishedAt = dateText ? parsePublishedAt(dateText)?.instant : undefined;
    const companyName = stringField(row, "company_name")?.trim();
    const turns: EarningsCallTranscriptTurn[] = [];
    for (const turn of recordArray(row["structured_content"])) {
      const speaker = stringField(turn, "speaker")?.trim();
      const text = stringField(turn, "text");
      if (speaker && text) turns.push({ speaker, text });
    }

    transcripts.push({
      symbol,
      ...(companyName ? { companyName } : {}),
      year,
      quarter,
      ...(publishedAt ? { publishedAt } : {}),
      ...(dateText ? { publishedAtText: dateText } : {}),
      content,
      turns,
      url: hfDatasetViewerUrl(dataset, rowIdx),
    });

    if (limit !== undefined && transcripts.length >= limit) break;
  }
  return transcripts;
}

const SUMMARY_MAX_LENGTH = 280;

/** Bridges one transcript into the news lane. */
export function earningsCallTranscriptToNewsItem(transcript: EarningsCallTranscript): NewsItem {
  const label = transcript.companyName
    ? `${transcript.companyName} (${transcript.symbol})`
    : transcript.symbol;
  const opening = transcript.turns[0]?.text ?? transcript.content;
  const summary =
    opening.length > SUMMARY_MAX_LENGTH
      ? `${opening.slice(0, SUMMARY_MAX_LENGTH).trimEnd()}…`
      : opening;
  return {
    id: stableId(["hf-transcripts", transcript.symbol, `${transcript.year}Q${transcript.quarter}`]),
    provider: "hf-transcripts",
    kind: "article",
    title: `${label} Q${transcript.quarter} ${transcript.year} earnings call transcript`,
    url: transcript.url,
    canonicalUrl: transcript.url,
    source: "Hugging Face Datasets",
    ticker: transcript.symbol,
    ...(transcript.companyName ? { companyName: transcript.companyName } : {}),
    ...(transcript.publishedAt ? { publishedAt: transcript.publishedAt } : {}),
    ...(transcript.publishedAtText ? { publishedAtText: transcript.publishedAtText } : {}),
    ...(summary ? { summary } : {}),
    eventKind: "earnings",
  };
}

/** Fetches a company's transcripts and maps them into news items. */
export async function fetchEarningsCallTranscriptNews(
  symbol: string,
  options: EarningsTranscriptQueryOptions = {},
): Promise<NewsItem[]> {
  const transcripts = await fetchEarningsCallTranscripts(symbol, options);
  return transcripts.map(earningsCallTranscriptToNewsItem);
}

function integerField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

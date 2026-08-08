import { normalizeLimit } from "../options.js";
import { hasAsciiControlCharacters } from "../text.js";
import type { SourceFetchOptions } from "../types.js";

/** One Hugging Face dataset split served by the datasets-server API. */
export interface HfDatasetRef {
  /** Dataset repository id, e.g. `"kurry/sp500_earnings_transcripts"`. */
  readonly dataset: string;
  /** Dataset config name; datasets-server calls the common case "default". */
  readonly config?: string;
  /** Split name; defaults to "train". */
  readonly split?: string;
}

/** Pagination for datasets-server row endpoints. */
export interface HfRowsOptions {
  readonly offset?: number;
  readonly length?: number;
}

const HF_DATASETS_SERVER_BASE = "https://datasets-server.huggingface.co";

/** datasets-server rejects `length` above 100 rows per page. */
export const HF_MAX_PAGE_LENGTH = 100;

/**
 * The canonical free earnings-call transcript dataset: quarterly calls from
 * ~685 US large-cap issuers (much of, but not all of, the S&P 500) from 2005
 * onward (MIT-licensed, refreshed as
 * snapshots rather than in real time). Columns: symbol, year, quarter, date,
 * content, structured_content [{speaker, text}], company_name.
 */
export const HF_EARNINGS_TRANSCRIPTS_DATASET: HfDatasetRef = {
  dataset: "kurry/sp500_earnings_transcripts",
  config: "default",
  split: "train",
};

/** Options for one earnings-transcript query against datasets-server. */
export interface EarningsTranscriptQueryOptions extends SourceFetchOptions {
  /** Fiscal year as labeled by the dataset, e.g. 2024. */
  readonly year?: number;
  /** Fiscal quarter 1-4 as labeled by the dataset. */
  readonly quarter?: number;
  /** Row offset for paging beyond the first `limit` transcripts. */
  readonly offset?: number;
  /** Override the queried dataset with a schema-compatible mirror. */
  readonly dataset?: HfDatasetRef;
}

function datasetParams(url: URL, ref: HfDatasetRef): void {
  const dataset = ref.dataset.trim();
  if (!dataset || hasAsciiControlCharacters(dataset)) {
    throw new TypeError("Hugging Face dataset id is required");
  }
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", ref.config?.trim() || "default");
  url.searchParams.set("split", ref.split?.trim() || "train");
}

function pageParams(url: URL, options: HfRowsOptions, defaultLength: number): void {
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError("offset must be a non-negative integer");
  }
  const length = options.length ?? defaultLength;
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError("length must be a non-negative integer");
  }
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(Math.min(length, HF_MAX_PAGE_LENGTH)));
}

/** Hugging Face datasets-server `/rows`: one page of raw rows. */
export function hfDatasetRowsUrl(ref: HfDatasetRef, options: HfRowsOptions = {}): string {
  const url = new URL(`${HF_DATASETS_SERVER_BASE}/rows`);
  datasetParams(url, ref);
  pageParams(url, options, HF_MAX_PAGE_LENGTH);
  return url.toString();
}

/**
 * Hugging Face datasets-server `/filter`: rows matching a SQL-ish `where`
 * clause with quoted column names (`"symbol"='AAPL'`), optionally ordered.
 */
export function hfDatasetFilterUrl(
  ref: HfDatasetRef,
  options: HfRowsOptions & { readonly where?: string; readonly orderby?: string } = {},
): string {
  const url = new URL(`${HF_DATASETS_SERVER_BASE}/filter`);
  datasetParams(url, ref);
  if (options.where) url.searchParams.set("where", options.where);
  if (options.orderby) url.searchParams.set("orderby", options.orderby);
  pageParams(url, options, HF_MAX_PAGE_LENGTH);
  return url.toString();
}

/** Hugging Face datasets-server `/search`: full-text search over string cells. */
export function hfDatasetSearchUrl(
  ref: HfDatasetRef,
  query: string,
  options: HfRowsOptions = {},
): string {
  const value = query.trim();
  if (!value) throw new TypeError("Hugging Face search query is required");
  const url = new URL(`${HF_DATASETS_SERVER_BASE}/search`);
  datasetParams(url, ref);
  url.searchParams.set("query", value);
  pageParams(url, options, HF_MAX_PAGE_LENGTH);
  return url.toString();
}

/** Human-facing dataset viewer page for a dataset split, optionally at one row. */
export function hfDatasetViewerUrl(ref: HfDatasetRef, row?: number): string {
  const dataset = ref.dataset.trim();
  if (!dataset || hasAsciiControlCharacters(dataset)) {
    throw new TypeError("Hugging Face dataset id is required");
  }
  const config = encodeURIComponent(ref.config?.trim() || "default");
  const split = encodeURIComponent(ref.split?.trim() || "train");
  const path = dataset.split("/").map(encodeURIComponent).join("/");
  const base = `https://huggingface.co/datasets/${path}/viewer/${config}/${split}`;
  return row !== undefined && Number.isInteger(row) && row >= 0 ? `${base}?row=${row}` : base;
}

const TRANSCRIPT_DEFAULT_PAGE = 8;

/**
 * Filter URL for one company's earnings-call transcripts, newest first.
 * `limit` caps the page (default 8, ceiling 100); `year`/`quarter` narrow to
 * a single call.
 */
export function earningsTranscriptsFilterUrl(
  symbol: string,
  options: Pick<EarningsTranscriptQueryOptions, "year" | "quarter" | "offset" | "dataset"> & {
    readonly limit?: number;
  } = {},
): string {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker || hasAsciiControlCharacters(ticker)) {
    throw new TypeError("Ticker symbol is required");
  }
  const clauses = [`"symbol"='${ticker.replace(/'/g, "''")}'`];
  if (options.year !== undefined) {
    if (!Number.isInteger(options.year) || options.year < 1990 || options.year > 2100) {
      throw new RangeError("year must be a four-digit year");
    }
    clauses.push(`"year"=${options.year}`);
  }
  if (options.quarter !== undefined) {
    if (!Number.isInteger(options.quarter) || options.quarter < 1 || options.quarter > 4) {
      throw new RangeError("quarter must be an integer between 1 and 4");
    }
    clauses.push(`"quarter"=${options.quarter}`);
  }
  return hfDatasetFilterUrl(options.dataset ?? HF_EARNINGS_TRANSCRIPTS_DATASET, {
    where: clauses.join(" AND "),
    orderby: '"date" DESC',
    ...(options.offset !== undefined ? { offset: options.offset } : {}),
    length: normalizeLimit(options.limit) ?? TRANSCRIPT_DEFAULT_PAGE,
  });
}

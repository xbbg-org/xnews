import { parseCsvTable } from "../csv.js";
import { fetchJsonText, fetchText } from "../http.js";
import { isRecord, parseJsonRecord } from "../json.js";
import { normalizeDateWindow, normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import {
  WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END,
  WIKIPEDIA_CONGRESS_EDITS_COVERAGE_START,
  WIKIPEDIA_CONGRESS_EDITS_DATA_URL,
  WIKIPEDIA_CONGRESS_EDITS_PAGE_URL,
  WIKIPEDIA_CONGRESS_EDITS_RANGES_URL,
} from "./wikipediacongressedits.urls.js";

export {
  WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_BASE_URL,
  WIKIPEDIA_CONGRESS_EDITS_ARCHIVE_ROW_COUNT,
  WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END,
  WIKIPEDIA_CONGRESS_EDITS_COVERAGE_START,
  WIKIPEDIA_CONGRESS_EDITS_DATA_URL,
  WIKIPEDIA_CONGRESS_EDITS_PAGE_URL,
  WIKIPEDIA_CONGRESS_EDITS_RANGES_URL,
} from "./wikipediacongressedits.urls.js";

const CONGRESS_EDITS_PROVIDER = "wikipedia-congress-edits";
const CONGRESS_EDITS_DATASET = "historical-edits";
const CONGRESS_EDITS_SHAPE_ERROR = "unexpected Wikipedia Congress edits archive shape";

export type CongressChamber = "house" | "senate" | "unknown";

export interface CongressionalIpRange {
  readonly chamber: CongressChamber;
  /** Archive label, normally `US House of Representatives` or `US Senate`. */
  readonly label: string;
  readonly startAddress: string;
  readonly endAddress: string;
  readonly start: number;
  readonly end: number;
}

export interface WikipediaCongressEditRow {
  readonly pageId: number;
  readonly title: string;
  /** HTTPS revision diff URL on English Wikipedia. */
  readonly diffUrl: string;
  readonly revisionId: number;
  readonly timestamp: string;
  /** Historical institutional-network IP published in the Wikimedia dump. */
  readonly contributorIp: string;
  readonly contributorIpInt: number;
  readonly chamber: CongressChamber;
  readonly congressionalNetwork: string;
}

export interface WikipediaCongressEditsOptions extends SourceFetchOptions {
  /** Restricts results to House, Senate, or archive labels not recognized by this version. */
  readonly chambers?: readonly CongressChamber[];
}

/**
 * Parses the archive's range manifest. The manifest, not a single hardcoded
 * CIDR, is authoritative: it currently includes six House ranges and one
 * Senate range, several of which are not adjacent.
 */
export function parseCongressionalIpRanges(body: string): CongressionalIpRange[] {
  const payload = parseJsonRecord(body, "Wikipedia Congress edits ranges");
  const rangesValue = payload["ranges"];
  if (!isRecord(rangesValue)) throw new Error(CONGRESS_EDITS_SHAPE_ERROR);

  const ranges: CongressionalIpRange[] = [];
  for (const [label, entries] of Object.entries(rangesValue)) {
    if (!Array.isArray(entries)) continue;
    const chamber = chamberFromLabel(label);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [startAddress, endAddress] = entry;
      if (typeof startAddress !== "string" || typeof endAddress !== "string") continue;
      const start = ipv4ToInteger(startAddress);
      const end = ipv4ToInteger(endAddress);
      if (start === undefined || end === undefined || start > end) continue;
      ranges.push({ chamber, label, startAddress, endAddress, start, end });
    }
  }

  if (ranges.length === 0) throw new Error(CONGRESS_EDITS_SHAPE_ERROR);
  return ranges;
}

export interface CongressionalIpMatch {
  readonly address: string;
  readonly integer: number;
  readonly range: CongressionalIpRange;
}

/** Matches one public IPv4 editor identity against the archive's range manifest. */
export function matchCongressionalIp(
  address: string,
  ranges: readonly CongressionalIpRange[],
): CongressionalIpMatch | undefined {
  const integer = ipv4ToInteger(address);
  if (integer === undefined) return undefined;
  const range = ranges.find((candidate) => integer >= candidate.start && integer <= candidate.end);
  return range === undefined ? undefined : { address, integer, range };
}
/**
 * Parses the historical archive. Rows are newest-first in the published CSV;
 * filters preserve that order and `limit` is applied after chamber/date
 * filtering, so a limit of ten means ten matching edits.
 */
export function parseWikipediaCongressEdits(
  body: string,
  ranges: readonly CongressionalIpRange[],
  options: WikipediaCongressEditsOptions = {},
): WikipediaCongressEditRow[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  if (ranges.length === 0) throw new Error(CONGRESS_EDITS_SHAPE_ERROR);

  const dateWindow = normalizeDateWindow(options);
  const chambers = options.chambers === undefined ? undefined : new Set(options.chambers);
  const records = parseCsvTable(body);
  if (records.length === 0) return [];
  assertCongressEditsColumns(records[0]!);

  const rows: WikipediaCongressEditRow[] = [];
  let recognizableRows = 0;
  for (const record of records) {
    const pageId = safeInteger(record["page_id"]);
    const revisionId = safeInteger(record["revision_id"]);
    const timestampSeconds = safeInteger(record["timestamp"]);
    const title = record["title"]?.trim();
    const contributorIp = record["contributor_ip"]?.trim();
    const publishedIpInt = safeInteger(record["contributor_ip_int"]);
    const diffUrl = wikipediaDiffUrl(record["diff_url"]);
    if (
      pageId === undefined ||
      revisionId === undefined ||
      timestampSeconds === undefined ||
      !title ||
      !contributorIp ||
      publishedIpInt === undefined ||
      diffUrl === undefined
    ) {
      continue;
    }
    recognizableRows += 1;

    const ipMatch = matchCongressionalIp(contributorIp, ranges);
    if (ipMatch === undefined || ipMatch.integer !== publishedIpInt) {
      throw new Error(CONGRESS_EDITS_SHAPE_ERROR);
    }
    const { range, integer: contributorIpInt } = ipMatch;
    if (chambers !== undefined && !chambers.has(range.chamber)) continue;

    const timestampMs = timestampSeconds * 1_000;
    if (!Number.isSafeInteger(timestampMs)) continue;
    if (dateWindow.sinceMs !== undefined && timestampMs < dateWindow.sinceMs) continue;
    if (dateWindow.untilMs !== undefined && timestampMs > dateWindow.untilMs) continue;

    rows.push({
      pageId,
      title,
      diffUrl,
      revisionId,
      timestamp: new Date(timestampMs).toISOString(),
      contributorIp,
      contributorIpInt,
      chamber: range.chamber,
      congressionalNetwork: range.label,
    });
    if (limit !== undefined && rows.length >= limit) break;
  }

  if (recognizableRows === 0) throw new Error(CONGRESS_EDITS_SHAPE_ERROR);
  return rows;
}

export async function fetchWikipediaCongressEdits(
  options: WikipediaCongressEditsOptions = {},
): Promise<WikipediaCongressEditRow[]> {
  if (normalizeLimit(options.limit) === 0) return [];
  const [csv, rangesBody] = await Promise.all([
    fetchText(WIKIPEDIA_CONGRESS_EDITS_DATA_URL, options),
    fetchJsonText(WIKIPEDIA_CONGRESS_EDITS_RANGES_URL, options),
  ]);
  return parseWikipediaCongressEdits(csv, parseCongressionalIpRanges(rangesBody), options);
}

/**
 * Binds the immutable historical archive to the data lane. `ifNewerThan` can
 * skip both 1.7 MB CSV and range-manifest requests because the archive's end
 * date is fixed and published as part of this adapter's contract.
 */
export function wikipediaCongressEditsDataSource(
  options: WikipediaCongressEditsOptions = {},
): DataSource<WikipediaCongressEditRow> {
  const merged = (
    fetchOptions: DataFetchOptions,
  ): WikipediaCongressEditsOptions & DataFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: CONGRESS_EDITS_PROVIDER,
    dataset: CONGRESS_EDITS_DATASET,
    requestUrls: (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      if (
        normalizeLimit(combined.limit) === 0 ||
        (combined.ifNewerThan !== undefined &&
          combined.ifNewerThan >= WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END)
      ) {
        return [];
      }
      return [WIKIPEDIA_CONGRESS_EDITS_DATA_URL, WIKIPEDIA_CONGRESS_EDITS_RANGES_URL];
    },
    fetchRelease: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      if (
        normalizeLimit(combined.limit) === 0 ||
        (combined.ifNewerThan !== undefined &&
          combined.ifNewerThan >= WIKIPEDIA_CONGRESS_EDITS_COVERAGE_END)
      ) {
        return undefined;
      }
      const rows = await fetchWikipediaCongressEdits(combined);
      if (rows.length === 0) return undefined;
      let asOf = WIKIPEDIA_CONGRESS_EDITS_COVERAGE_START;
      for (const row of rows) {
        const date = row.timestamp.slice(0, 10);
        if (date > asOf) asOf = date;
      }
      return {
        provider: CONGRESS_EDITS_PROVIDER,
        dataset: CONGRESS_EDITS_DATASET,
        asOf,
        url: WIKIPEDIA_CONGRESS_EDITS_PAGE_URL,
        rows,
      } satisfies DataRelease<WikipediaCongressEditRow>;
    },
  };
}

function chamberFromLabel(label: string): CongressChamber {
  const normalized = label.toLowerCase();
  if (normalized.includes("house")) return "house";
  if (normalized.includes("senate")) return "senate";
  return "unknown";
}

function ipv4ToInteger(value: string): number | undefined {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return undefined;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return undefined;
    result = result * 256 + octet;
  }
  return Number.isSafeInteger(result) ? result : undefined;
}

function safeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function wikipediaDiffUrl(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      url.hostname !== "en.wikipedia.org" ||
      (url.protocol !== "http:" && url.protocol !== "https:")
    ) {
      return undefined;
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

function assertCongressEditsColumns(record: Readonly<Record<string, string>>): void {
  const required = [
    "page_id",
    "title",
    "diff_url",
    "revision_id",
    "timestamp",
    "contributor_ip",
    "contributor_ip_int",
  ] as const;
  if (required.some((column) => !Object.hasOwn(record, column))) {
    throw new Error(CONGRESS_EDITS_SHAPE_ERROR);
  }
}

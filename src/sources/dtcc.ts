import { parseCsvTable } from "../csv.js";
import { normalizeDateOnly, parsePublishedAt } from "../dates.js";
import { XnewsFetchError, fetchRaw, fetchText } from "../http.js";
import { isRecord, numberField, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import { readZipEntries } from "../zip.js";
import type { DataFetchOptions, DataRelease, DataSource, NewsItem } from "../types.js";
import {
  type DtccAgency,
  type DtccAssetClass,
  type DtccSliceCatalogEntry,
  type DtccUrlOptions,
  dtccCumulativeFileName,
  dtccCumulativeUrl,
  dtccSliceCatalogUrl,
  dtccSliceUrl,
  parseDtccSliceFileName,
} from "./dtcc.urls.js";

export {
  DTCC_AGENCIES,
  DTCC_ASSET_CLASSES,
  DTCC_DATA_BASE_URL,
  DTCC_PPD_API_BASE_URL,
  DTCC_PPD_PAGE_URL,
  dtccCumulativeFileName,
  dtccCumulativeUrl,
  dtccSliceCatalogUrl,
  dtccSliceUrl,
  parseDtccSliceFileName,
} from "./dtcc.urls.js";
export type {
  DtccAgency,
  DtccAssetClass,
  DtccSliceCatalogEntry,
  DtccSliceFileNameInfo,
  DtccUrlOptions,
} from "./dtcc.urls.js";

/**
 * One publicly disseminated swap transaction event, normalized from a DTCC
 * PPD CSV row. The typed fields are the identity, lifecycle, product, and
 * price columns most consumers key on; the full 100+ column row survives
 * verbatim in `raw`. Numeric-looking values stay strings deliberately:
 * DTCC renders notionals with thousands separators and marks capped
 * amounts with a trailing `+` (`"25,000,000+"`), so number parsing is the
 * consumer's policy decision, not this library's.
 */
export interface DtccTradeEvent {
  /** File the event came from, for provenance. */
  readonly fileName: string;
  /** 1-based data-row position within the file. */
  readonly rowNumber: number;
  readonly disseminationId: string;
  readonly originalDisseminationId: string | null;
  /** Groups amendment chains: the original dissemination ID when present. */
  readonly lineageId: string;
  readonly actionType: string | null;
  readonly eventType: string | null;
  readonly eventTimestamp: string | null;
  readonly executionTimestamp: string | null;
  readonly effectiveDate: string | null;
  readonly expirationDate: string | null;
  /** DTCC asset-class code carried by the row (e.g. `"CR"`). */
  readonly assetClass: string | null;
  readonly productName: string | null;
  readonly cleared: string | null;
  readonly platformIdentifier: string | null;
  readonly notionalAmountLeg1: string | null;
  readonly notionalCurrencyLeg1: string | null;
  readonly fixedRateLeg1: string | null;
  readonly spreadLeg1: string | null;
  readonly spreadNotationLeg1: string | null;
  readonly price: string | null;
  readonly priceNotation: string | null;
  readonly packageIndicator: string | null;
  readonly uniqueProductIdentifier: string | null;
  readonly upiFisn: string | null;
  readonly upiUnderlierName: string | null;
  /** The complete CSV row, header-keyed and verbatim. */
  readonly raw: Readonly<Record<string, string>>;
}

export interface DtccFetchOptions extends DataFetchOptions, DtccUrlOptions {
  /** Reporting regime; defaults to `"cftc"`. */
  readonly agency?: DtccAgency;
  /** Asset class; defaults to `"credits"`. */
  readonly assetClass?: DtccAssetClass;
}

/** One cumulative end-of-day file, downloaded and parsed. */
export interface DtccCumulativeRelease {
  readonly businessDate: string;
  readonly fileName: string;
  readonly url: string;
  readonly events: readonly DtccTradeEvent[];
}

const DEFAULT_AGENCY: DtccAgency = "cftc";
const DEFAULT_ASSET_CLASS: DtccAssetClass = "credits";
/**
 * How many days `fetchDtccCumulativeEvents` walks back looking for the
 * newest published end-of-day file. Files appear in the evening US time
 * and never on weekends, so the newest one is at most a long weekend away.
 */
const CUMULATIVE_LOOKBACK_DAYS = 6;

const utf8Decoder = new TextDecoder();

/**
 * Parses a PPD slice-catalog JSON body. Entries are returned ascending by
 * `sliceId` — publication order — regardless of the API's ordering.
 * Entries without the catalog's own download URL get one built from
 * `agency` (default `"cftc"`) and `dataBaseUrl`.
 */
export function parseDtccSliceCatalog(
  body: string,
  options: Pick<DtccFetchOptions, "agency" | "dataBaseUrl"> = {},
): DtccSliceCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("unexpected non-JSON DTCC slice catalog response");
  }
  const agency = options.agency ?? DEFAULT_AGENCY;
  const entries: DtccSliceCatalogEntry[] = [];
  for (const value of parsed) {
    if (!isRecord(value)) continue;
    const sliceId = numberField(value, "sliceId");
    const fileName = stringField(value, "fileName")?.trim();
    if (sliceId === undefined || fileName === undefined || fileName.length === 0) continue;
    const fullFilePath = stringField(value, "fullFilePath")?.trim();
    entries.push({
      sliceId,
      fileName,
      startTs: stringField(value, "startTs") ?? "",
      endTs: stringField(value, "endTs") ?? "",
      rowCount: numberField(value, "rowCount") ?? 0,
      dissemDTM: stringField(value, "dissemDTM") ?? "",
      url: fullFilePath || dtccSliceUrl(agency, fileName, options),
    });
  }
  if (parsed.length > 0 && entries.length === 0) {
    throw new Error("unexpected DTCC slice catalog response shape");
  }
  return entries.toSorted((a, b) => a.sliceId - b.sliceId);
}

/**
 * Parses one DTCC trade CSV (the content of a slice or cumulative ZIP)
 * into normalized events. Pure and total — text in, events out. A row
 * without a Dissemination Identifier is format drift and throws rather
 * than silently dropping trades.
 */
export function parseDtccTradeCsv(
  text: string,
  context: { readonly fileName?: string; readonly limit?: number } = {},
): DtccTradeEvent[] {
  const limit = normalizeLimit(context.limit);
  if (limit === 0) return [];
  const fileName = context.fileName ?? "trades.csv";
  const rows = parseCsvTable(text);
  const events: DtccTradeEvent[] = [];
  for (const [index, row] of rows.entries()) {
    events.push(normalizeTradeRow(row, fileName, index + 1));
    if (limit !== undefined && events.length >= limit) break;
  }
  return events;
}

/**
 * Parses a DTCC slice or cumulative ZIP into normalized events. The
 * archive is expected to carry exactly one CSV; extra non-CSV members are
 * ignored and a CSV-less archive throws.
 */
export async function parseDtccTradeZip(
  bytes: Uint8Array,
  context: { readonly fileName?: string; readonly limit?: number } = {},
): Promise<DtccTradeEvent[]> {
  const limit = normalizeLimit(context.limit);
  if (limit === 0) return [];
  const label = context.fileName ?? "DTCC archive";
  const entries = await readZipEntries(bytes, label);
  const entry = entries.find((candidate) => candidate.name.toLowerCase().endsWith(".csv"));
  if (entry === undefined) throw new Error(`No CSV member found in ${label}`);
  return parseDtccTradeCsv(utf8Decoder.decode(entry.bytes), {
    fileName: context.fileName ?? entry.name,
    ...(limit === undefined ? {} : { limit }),
  });
}

/**
 * Fetches the intraday slice catalog for one (agency, asset class) pair,
 * ascending by `sliceId`. The catalog only covers the most recent days;
 * older data lives in the cumulative end-of-day files. `since`/`until`
 * bound entries by their file-name business date.
 */
export async function fetchDtccSliceCatalog(
  options: DtccFetchOptions = {},
): Promise<DtccSliceCatalogEntry[]> {
  const [since, until] = dtccDateBounds(options);
  if (normalizeLimit(options.limit) === 0) return [];
  const agency = options.agency ?? DEFAULT_AGENCY;
  const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
  const body = await fetchText(dtccSliceCatalogUrl(agency, assetClass, options), options);
  const entries = parseDtccSliceCatalog(body, { agency, ...options });
  if (since === undefined && until === undefined) return entries;
  return entries.filter((entry) => {
    const date = dtccSliceDate(entry);
    if (date === null) return false;
    return (since === undefined || date >= since) && (until === undefined || date <= until);
  });
}

/**
 * Downloads and parses one intraday slice. A slice that has rotated out
 * of retention (HTTP 404) resolves to an empty list rather than throwing,
 * mirroring the catalog's rolling window.
 */
export async function fetchDtccSliceEvents(
  slice: string | DtccSliceCatalogEntry,
  options: DtccFetchOptions = {},
): Promise<DtccTradeEvent[]> {
  dtccDateBounds(options);
  if (normalizeLimit(options.limit) === 0) return [];
  const agency = options.agency ?? DEFAULT_AGENCY;
  const fileName = typeof slice === "string" ? slice : slice.fileName;
  const url = typeof slice === "string" ? dtccSliceUrl(agency, fileName, options) : slice.url;
  let payload: Uint8Array;
  try {
    payload = (await fetchRaw(url, options)).bytes;
  } catch (error) {
    if (error instanceof XnewsFetchError && error.code === "http_status" && error.status === 404) {
      return [];
    }
    throw error;
  }
  return parseDtccTradeZip(payload, {
    fileName,
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
}

/**
 * Downloads and parses a cumulative end-of-day file. With a `businessDate`
 * it fetches exactly that date, resolving `undefined` when the file is not
 * published (weekends, holidays, or a day whose file is not out yet —
 * DTCC answers 403 or 404 for both). Without one it walks back from today
 * (UTC) and returns the newest published file, honoring `ifNewerThan` as
 * a skip hint and `since`/`until` as date bounds.
 */
export async function fetchDtccCumulativeEvents(
  businessDate?: string,
  options: DtccFetchOptions = {},
): Promise<DtccCumulativeRelease | undefined> {
  const bounds = dtccDateBounds(options);
  const ifNewerThan = requireDtccDateOnly(options.ifNewerThan, "ifNewerThan");
  const explicitDate =
    businessDate === undefined ? undefined : requireDtccDateOnly(businessDate, "businessDate");
  const dates =
    explicitDate === undefined
      ? cumulativeCandidateDates(options, bounds, ifNewerThan)
      : [explicitDate];
  if (normalizeLimit(options.limit) === 0) return undefined;
  const agency = options.agency ?? DEFAULT_AGENCY;
  const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
  for (const date of dates) {
    const url = dtccCumulativeUrl(agency, assetClass, date, options);
    let payload: Uint8Array;
    try {
      payload = (await fetchRaw(url, options)).bytes;
    } catch (error) {
      if (
        error instanceof XnewsFetchError &&
        error.code === "http_status" &&
        (error.status === 403 || error.status === 404)
      ) {
        continue;
      }
      throw error;
    }
    const fileName = dtccCumulativeFileName(agency, assetClass, date);
    const events = await parseDtccTradeZip(payload, {
      fileName,
      ...(options.limit === undefined ? {} : { limit: options.limit }),
    });
    return { businessDate: date, fileName, url, events };
  }
  return undefined;
}

/**
 * Binds one (agency, asset class) intraday slice stream to the data
 * lane's generic machinery as a sequenced source: each release is one
 * slice, `sequence` is its catalog `sliceId`, and `afterSequence` selects
 * the earliest unseen slice so `createDataReleaseWatcher` consumes the
 * stream in order and without gaps. Without `afterSequence` the latest
 * slice is served. Slices that rotated out before download are skipped.
 */
export function dtccSliceDataSource(options: DtccFetchOptions = {}): DataSource<DtccTradeEvent> {
  const agency = options.agency ?? DEFAULT_AGENCY;
  const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
  return {
    provider: "dtcc-sdr",
    dataset: `${agency}-${assetClass}-slices`,
    // Slice download URLs are only knowable after reading the catalog.
    requestUrls: (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions };
      dtccDateBounds(merged);
      return [dtccSliceCatalogUrl(agency, assetClass, merged)];
    },
    fetchRelease: async (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions, agency, assetClass };
      const catalog = await fetchDtccSliceCatalog(merged);
      const after = merged.afterSequence;
      const pending =
        after === undefined ? catalog.slice(-1) : catalog.filter((entry) => entry.sliceId > after);
      for (const entry of pending) {
        const asOf = dtccSliceDate(entry);
        if (asOf === null) {
          throw new Error("unexpected DTCC slice catalog response shape");
        }
        const rows = await fetchDtccSliceEvents(entry, merged);
        if (rows.length === 0) continue;
        return {
          provider: "dtcc-sdr",
          dataset: `${agency}-${assetClass}-slices`,
          asOf,
          sequence: entry.sliceId,
          url: entry.url,
          rows,
        };
      }
      return undefined;
    },
  };
}

/**
 * Binds one (agency, asset class) cumulative end-of-day stream to the
 * data lane's generic machinery: one release per business date carrying
 * the full day, discovered by walking back from today until the newest
 * published file.
 */
export function dtccCumulativeDataSource(
  options: DtccFetchOptions = {},
): DataSource<DtccTradeEvent> {
  const agency = options.agency ?? DEFAULT_AGENCY;
  const assetClass = options.assetClass ?? DEFAULT_ASSET_CLASS;
  return {
    provider: "dtcc-sdr",
    dataset: `${agency}-${assetClass}-eod`,
    requestUrls: (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions, agency, assetClass };
      return cumulativeCandidateDates(merged).map((date) =>
        dtccCumulativeUrl(agency, assetClass, date, merged),
      );
    },
    fetchRelease: async (fetchOptions = {}) => {
      const merged = { ...options, ...fetchOptions, agency, assetClass };
      const release = await fetchDtccCumulativeEvents(undefined, merged);
      if (release === undefined) return undefined;
      return {
        provider: "dtcc-sdr",
        dataset: `${agency}-${assetClass}-eod`,
        asOf: release.businessDate,
        url: release.url,
        rows: release.events,
      };
    },
  };
}

/**
 * Renders a DTCC release as one summary news item, so swap dissemination
 * activity can ride the news lane beside articles and filings. The title
 * names the file and count; the summary carries the action-type histogram
 * and the most active underliers.
 */
export function dtccReleaseToNewsItems(release: DataRelease<DtccTradeEvent>): NewsItem[] {
  if (release.rows.length === 0) return [];
  const [agency = "", assetClass = ""] = release.dataset.split("-");
  const scope = release.sequence === undefined ? "end-of-day" : `slice ${release.sequence}`;
  const title =
    `DTCC ${agency.toUpperCase()} ${assetClass} ${scope} (${release.asOf}): ` +
    `${release.rows.length} swap disseminations`;
  const published = parsePublishedAt(release.asOf);
  return [
    {
      id: stableId(["dtcc-sdr", `${release.dataset}:${release.asOf}`, scope]),
      provider: "dtcc-sdr",
      kind: "data",
      title,
      url: release.url,
      source: "DTCC SDR",
      ...(published ? { publishedAt: published.instant } : {}),
      publishedAtText: release.asOf,
      summary: summarizeRelease(release.rows),
      reportDate: release.asOf,
      eventKind: "market",
      tags: ["dtcc", agency, assetClass, release.sequence === undefined ? "eod" : "slices"],
    },
  ];
}

function summarizeRelease(rows: readonly DtccTradeEvent[]): string {
  const actions = new Map<string, number>();
  const underliers = new Map<string, number>();
  for (const row of rows) {
    const action = row.actionType ?? "?";
    actions.set(action, (actions.get(action) ?? 0) + 1);
    if (row.upiUnderlierName !== null) {
      underliers.set(row.upiUnderlierName, (underliers.get(row.upiUnderlierName) ?? 0) + 1);
    }
  }
  const parts = [`Actions: ${topCounts(actions)}`];
  if (underliers.size > 0) parts.push(`Top underliers: ${topCounts(underliers)}`);
  return parts.join(". ");
}

/** Renders the three largest counts as `label count`, largest first. */
function topCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, count]) => `${label} ${count}`)
    .join(", ");
}

function normalizeTradeRow(
  row: Record<string, string>,
  fileName: string,
  rowNumber: number,
): DtccTradeEvent {
  const disseminationId = optionalField(row, "Dissemination Identifier");
  if (disseminationId === null) {
    throw new Error(`Missing 'Dissemination Identifier' in ${fileName} row ${rowNumber}`);
  }
  const originalDisseminationId = optionalField(row, "Original Dissemination Identifier");
  return {
    fileName,
    rowNumber,
    disseminationId,
    originalDisseminationId,
    lineageId: originalDisseminationId ?? disseminationId,
    actionType: optionalField(row, "Action type"),
    eventType: optionalField(row, "Event type"),
    eventTimestamp: optionalField(row, "Event timestamp"),
    executionTimestamp: optionalField(row, "Execution Timestamp"),
    effectiveDate: optionalField(row, "Effective Date"),
    expirationDate: optionalField(row, "Expiration Date"),
    assetClass: optionalField(row, "Asset Class"),
    productName: optionalField(row, "Product name"),
    cleared: optionalField(row, "Cleared"),
    platformIdentifier: optionalField(row, "Platform identifier"),
    notionalAmountLeg1: optionalField(row, "Notional amount-Leg 1"),
    notionalCurrencyLeg1: optionalField(row, "Notional currency-Leg 1"),
    fixedRateLeg1: optionalField(row, "Fixed rate-Leg 1"),
    spreadLeg1: optionalField(row, "Spread-Leg 1"),
    spreadNotationLeg1: optionalField(row, "Spread notation-Leg 1"),
    price: optionalField(row, "Price"),
    priceNotation: optionalField(row, "Price notation"),
    packageIndicator: optionalField(row, "Package indicator"),
    uniqueProductIdentifier: optionalField(row, "Unique Product Identifier"),
    upiFisn: optionalField(row, "UPI FISN"),
    upiUnderlierName: optionalField(row, "UPI Underlier Name"),
    raw: row,
  };
}

function optionalField(row: Record<string, string>, column: string): string | null {
  const value = row[column];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Newest-first candidate business dates for the cumulative walk-back:
 * today (UTC) through `CUMULATIVE_LOOKBACK_DAYS` back, bounded by
 * `since`/`until` and pruned by the `ifNewerThan` skip hint.
 */
function cumulativeCandidateDates(
  options: DtccFetchOptions,
  [since, until] = dtccDateBounds(options),
  ifNewerThan = requireDtccDateOnly(options.ifNewerThan, "ifNewerThan"),
): string[] {
  const start = Date.now();
  const dates: string[] = [];
  for (let back = 0; back <= CUMULATIVE_LOOKBACK_DAYS; back += 1) {
    const date = new Date(start - back * 86_400_000).toISOString().slice(0, 10);
    if (until !== undefined && date > until) continue;
    if (since !== undefined && date < since) break;
    if (ifNewerThan !== undefined && date <= ifNewerThan) break;
    dates.push(date);
  }
  return dates;
}

function dtccDateBounds(
  options: Pick<DtccFetchOptions, "since" | "until">,
): readonly [string | undefined, string | undefined] {
  return [requireDtccDateOnly(options.since, "since"), requireDtccDateOnly(options.until, "until")];
}

function requireDtccDateOnly(
  value: string | Date | undefined,
  label: "businessDate" | "ifNewerThan" | "since" | "until",
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeDateOnly(value);
  if (normalized === null) {
    throw new RangeError(`${label} must be a valid date or ISO date-time`);
  }
  return normalized;
}

function dtccSliceDate(entry: DtccSliceCatalogEntry): string | null {
  const fileDate = parseDtccSliceFileName(entry.fileName)?.date;
  return normalizeDateOnly(fileDate ?? entry.dissemDTM);
}

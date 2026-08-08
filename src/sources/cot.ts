import { normalizeDateOnly, parsePublishedAt } from "../dates.js";
import { fetchText } from "../http.js";
import { isRecord, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import { stableId } from "../text.js";
import type { DataRelease, DataSource, NewsItem, SourceFetchOptions } from "../types.js";
import {
  COT_DATASETS,
  COT_FAMILY_COLUMNS,
  COT_MARKETS,
  cotDatasetDefinition,
  cotDatasetPageUrl,
  cotLatestDateUrl,
  cotReportUrl,
} from "./cot.urls.js";
import type {
  CotCategoryColumns,
  CotDataset,
  CotDatasetDefinition,
  CotReportFamily,
  CotReportUrlOptions,
} from "./cot.urls.js";

const CFTC_SHAPE_ERROR = "unexpected CFTC Socrata response shape";

export {
  COT_DATASETS,
  COT_DEFAULT_ROW_LIMIT,
  COT_FAMILY_COLUMNS,
  COT_IDENTITY_COLUMNS,
  COT_MARKETS,
  COT_MAX_ROW_LIMIT,
  cotDatasetDefinition,
  cotDatasetPageUrl,
  cotLatestDateUrl,
  cotMarketPreset,
  cotReportUrl,
  resolveCotMarketCodes,
} from "./cot.urls.js";
export type {
  CotCategoryColumns,
  CotDataset,
  CotDatasetDefinition,
  CotFamilyColumns,
  CotMarketPreset,
  CotReportFamily,
  CotReportUrlOptions,
} from "./cot.urls.js";

/** One trader category's open positions, in contracts. */
export interface CotPositions {
  readonly long: number;
  readonly short: number;
  readonly spreading?: number;
  /** Week-over-week changes; absent when CFTC publishes none. */
  readonly longChange?: number;
  readonly shortChange?: number;
  readonly spreadingChange?: number;
}

interface CotRowBase {
  readonly dataset: CotDataset;
  /** ISO date (`YYYY-MM-DD`) the positions are stated as of (a Tuesday). */
  readonly asOf: string;
  /** CFTC's combined market and exchange label. */
  readonly market: string;
  /** Contract market name without the exchange suffix. */
  readonly marketName: string;
  readonly cftcContractMarketCode: string;
  readonly cftcMarketCode?: string;
  readonly commodityName?: string;
  readonly commodityGroup?: string;
  readonly openInterest: number;
  readonly openInterestChange?: number;
  readonly tradersTotal?: number;
  readonly totalReportable: CotPositions;
  readonly nonReportable: CotPositions;
}

export interface CotLegacyRow extends CotRowBase {
  readonly family: "legacy";
  readonly nonCommercial: CotPositions;
  readonly commercial: CotPositions;
}

export interface CotDisaggregatedRow extends CotRowBase {
  readonly family: "disaggregated";
  readonly producerMerchant: CotPositions;
  readonly swapDealers: CotPositions;
  readonly managedMoney: CotPositions;
  readonly otherReportables: CotPositions;
}

export interface CotTffRow extends CotRowBase {
  readonly family: "tff";
  readonly dealers: CotPositions;
  readonly assetManagers: CotPositions;
  readonly leveragedFunds: CotPositions;
  readonly otherReportables: CotPositions;
}

export interface CotCitRow extends CotRowBase {
  readonly family: "cit";
  readonly nonCommercialExIndex: CotPositions;
  readonly commercialExIndex: CotPositions;
  readonly indexTraders: CotPositions;
}

export type CotRow = CotLegacyRow | CotDisaggregatedRow | CotTffRow | CotCitRow;

export interface CotFetchOptions extends SourceFetchOptions {
  /** Futures-and-options combined instead of futures only. */
  readonly combined?: boolean;
  /** Preset symbols, aliases, or raw CFTC contract market codes. */
  readonly markets?: readonly string[];
  /** Socrata app token; lifts the shared unauthenticated IP throttling pool. */
  readonly appToken?: string;
}

/**
 * Fetches CFTC Commitments of Traders rows as a typed `DataRelease`.
 *
 * Without `since`/`until` this resolves the dataset's latest report week in
 * one probe request and returns exactly that week's rows. With a date bound
 * it returns rows across the window, newest first, capped by `limit`
 * (default 5000, Socrata ceiling 50000). Resolves `undefined` when nothing
 * matches (or `limit` is 0).
 */
export async function fetchCotReport(
  family: "legacy",
  options?: CotFetchOptions,
): Promise<DataRelease<CotLegacyRow> | undefined>;
export async function fetchCotReport(
  family: "disaggregated",
  options?: CotFetchOptions,
): Promise<DataRelease<CotDisaggregatedRow> | undefined>;
export async function fetchCotReport(
  family: "tff",
  options?: CotFetchOptions,
): Promise<DataRelease<CotTffRow> | undefined>;
export async function fetchCotReport(
  family: "cit",
  options?: CotFetchOptions,
): Promise<DataRelease<CotCitRow> | undefined>;
export async function fetchCotReport(
  family: CotReportFamily,
  options?: CotFetchOptions,
): Promise<DataRelease<CotRow> | undefined>;
export async function fetchCotReport(
  family: CotReportFamily,
  options: CotFetchOptions = {},
): Promise<DataRelease<CotRow> | undefined> {
  const definition = cotDatasetDefinition(family, options);
  const urlOptions = cotUrlOptions(options);
  if (normalizeLimit(options.limit) === 0) return undefined;

  let asOf: string | undefined;
  if (options.since === undefined && options.until === undefined) {
    const probeBody = await fetchText(cotLatestDateUrl(definition, urlOptions), options);
    asOf = parseCotLatestDate(probeBody);
    if (asOf === undefined) return undefined;
  }

  const reportUrl = cotReportUrl(definition, { ...urlOptions, ...(asOf ? { asOf } : {}) });
  const rows = parseCotRows(await fetchText(reportUrl, options), definition.dataset, options.limit);
  const releaseAsOf = asOf ?? rows[0]?.asOf;
  if (releaseAsOf === undefined) return undefined;

  return {
    provider: "cftc-cot",
    dataset: definition.dataset,
    asOf: releaseAsOf,
    url: cotDatasetPageUrl(definition),
    rows,
  };
}

/**
 * Binds one COT dataset (with fixed query options) to the data lane's
 * generic machinery — `fetchDataRelease` and `createDataReleaseWatcher`.
 * Per-call transport options override the bound options.
 */
export function cotDataSource(
  family: CotReportFamily,
  options: CotFetchOptions = {},
): DataSource<CotRow> {
  const definition = cotDatasetDefinition(family, options);
  const merged = (fetchOptions: SourceFetchOptions): CotFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: "cftc-cot",
    dataset: definition.dataset,
    requestUrls: (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const urlOptions = cotUrlOptions(combined);
      return combined.since === undefined && combined.until === undefined
        ? [cotLatestDateUrl(definition, urlOptions), cotReportUrl(definition, urlOptions)]
        : [cotReportUrl(definition, urlOptions)];
    },
    fetchRelease: (fetchOptions = {}) => fetchCotReport(family, merged(fetchOptions)),
  };
}

/** Parses a Socrata COT JSON body into typed rows. Pure and network-free. */
export function parseCotRows(body: string, dataset: CotDataset, limit?: number): CotRow[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];
  const definition = requireDatasetDefinition(dataset);
  const columns = COT_FAMILY_COLUMNS[definition.family];
  const records = parseSocrataRecords(body);

  const rows: CotRow[] = [];
  for (const record of records) {
    const row = parseCotRow(record, definition, columns);
    if (!row) continue;
    rows.push(row);
    if (normalizedLimit !== undefined && rows.length >= normalizedLimit) break;
  }
  if (records.length > 0 && rows.length === 0) {
    throw new Error(CFTC_SHAPE_ERROR);
  }
  return rows;
}

const FAMILY_LABELS: Record<CotReportFamily, string> = {
  legacy: "Legacy",
  disaggregated: "Disaggregated",
  tff: "TFF",
  cit: "CIT",
};

/**
 * Renders a COT release as news items — one per market — so scheduled data
 * releases can ride the news lane (watchers, merging, classification). The
 * headline tracks each family's most-watched speculative category; the
 * summary carries every category's net position and week-over-week change.
 */
export function cotReleaseToNewsItems(release: DataRelease<CotRow>): NewsItem[] {
  const items: NewsItem[] = [];
  for (const row of release.rows) {
    const lead = leadCategory(row);
    const net = lead.positions.long - lead.positions.short;
    const delta = positionsNetChange(lead.positions);
    const title =
      `COT ${FAMILY_LABELS[row.family]}: ${row.marketName} - ${lead.label} net ` +
      `${formatSigned(net)}${delta === undefined ? "" : ` (${formatSigned(delta)} w/w)`}` +
      ` - week ending ${row.asOf}`;
    const published = parsePublishedAt(row.asOf);

    items.push({
      id: stableId(["cftc-cot", `${row.dataset}:${row.cftcContractMarketCode}:${row.asOf}`, title]),
      provider: "cftc-cot",
      kind: "data",
      title,
      url: release.url,
      source: "CFTC",
      ...(published ? { publishedAt: published.instant } : {}),
      publishedAtText: row.asOf,
      summary: summarizeCotRow(row),
      reportDate: row.asOf,
      eventKind: "market",
      tags: cotItemTags(row),
    });
  }
  return items;
}

interface LabeledPositions {
  readonly label: string;
  readonly positions: CotPositions;
}

function leadCategory(row: CotRow): LabeledPositions {
  if (row.family === "legacy") return { label: "Non-commercials", positions: row.nonCommercial };
  if (row.family === "disaggregated") {
    return { label: "Managed money", positions: row.managedMoney };
  }
  if (row.family === "tff") return { label: "Leveraged funds", positions: row.leveragedFunds };
  return { label: "Index traders", positions: row.indexTraders };
}

function familyCategories(row: CotRow): readonly LabeledPositions[] {
  if (row.family === "legacy") {
    return [
      { label: "Non-commercials", positions: row.nonCommercial },
      { label: "Commercials", positions: row.commercial },
    ];
  }
  if (row.family === "disaggregated") {
    return [
      { label: "Producer/Merchant", positions: row.producerMerchant },
      { label: "Swap dealers", positions: row.swapDealers },
      { label: "Managed money", positions: row.managedMoney },
      { label: "Other reportables", positions: row.otherReportables },
    ];
  }
  if (row.family === "tff") {
    return [
      { label: "Dealers", positions: row.dealers },
      { label: "Asset managers", positions: row.assetManagers },
      { label: "Leveraged funds", positions: row.leveragedFunds },
      { label: "Other reportables", positions: row.otherReportables },
    ];
  }
  return [
    { label: "Non-commercials ex-index", positions: row.nonCommercialExIndex },
    { label: "Commercials ex-index", positions: row.commercialExIndex },
    { label: "Index traders", positions: row.indexTraders },
  ];
}

function summarizeCotRow(row: CotRow): string {
  const openInterestChange =
    row.openInterestChange === undefined ? "" : ` (${formatSigned(row.openInterestChange)} w/w)`;
  const parts = [`Open interest ${formatInteger(row.openInterest)}${openInterestChange}`];
  for (const { label, positions } of familyCategories(row)) {
    const delta = positionsNetChange(positions);
    parts.push(
      `${label} net ${formatSigned(positions.long - positions.short)}` +
        (delta === undefined ? "" : ` (${formatSigned(delta)} w/w)`),
    );
  }
  return `${parts.join("; ")}.`;
}

function positionsNetChange(positions: CotPositions): number | undefined {
  if (positions.longChange === undefined || positions.shortChange === undefined) return undefined;
  return positions.longChange - positions.shortChange;
}

function cotItemTags(row: CotRow): readonly string[] {
  const symbol = COT_MARKETS.find(
    (market) =>
      market.cftcContractMarketCode === row.cftcContractMarketCode ||
      market.historicalContractMarketCodes.includes(row.cftcContractMarketCode),
  )?.symbol;
  return ["cot", row.family, row.dataset, ...(symbol ? [symbol] : [])];
}

function cotUrlOptions(options: CotFetchOptions): CotReportUrlOptions {
  const since = requireCotBound(options.since, "since");
  const until = requireCotBound(options.until, "until");
  return {
    ...(options.markets !== undefined ? { markets: options.markets } : {}),
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.appToken !== undefined ? { appToken: options.appToken } : {}),
  };
}

function requireCotBound(
  value: string | Date | undefined,
  label: "since" | "until",
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeDateOnly(value);
  if (normalized === null) {
    throw new RangeError(`${label} must be a valid date or ISO date-time`);
  }
  return normalized;
}

function requireDatasetDefinition(dataset: CotDataset): CotDatasetDefinition {
  const definition = COT_DATASETS.find((entry) => entry.dataset === dataset);
  if (!definition) {
    const choices = COT_DATASETS.map((entry) => entry.dataset).join(", ");
    throw new RangeError(
      `unknown COT dataset ${JSON.stringify(dataset)}; expected one of: ${choices}`,
    );
  }
  return definition;
}

function parseCotLatestDate(body: string): string | undefined {
  const records = parseSocrataRecords(body);
  if (records.length === 0) return undefined;

  for (const record of records) {
    const latest = stringField(record, "latest");
    if (latest === undefined) continue;
    const normalized = normalizeDateOnly(latest);
    if (normalized !== null) return normalized;
  }
  throw new Error(CFTC_SHAPE_ERROR);
}

function parseSocrataRecords(body: string): readonly Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed)) {
    throw new Error("unexpected non-JSON CFTC Socrata response");
  }
  const records = parsed.filter(isRecord);
  if (parsed.length > 0 && records.length === 0) {
    throw new Error(CFTC_SHAPE_ERROR);
  }
  return records;
}

function parseCotRow(
  record: Record<string, unknown>,
  definition: CotDatasetDefinition,
  columns: (typeof COT_FAMILY_COLUMNS)[CotReportFamily],
): CotRow | undefined {
  const asOfRaw = stringField(record, "report_date_as_yyyy_mm_dd");
  const market = stringField(record, "market_and_exchange_names")?.trim();
  const code = stringField(record, "cftc_contract_market_code")?.trim();
  if (!asOfRaw || !market || !code || asOfRaw !== asOfRaw.trim()) return undefined;

  const asOf = normalizeDateOnly(asOfRaw);
  if (asOf === null) return undefined;

  const openInterest = numericColumn(record, columns.openInterest);
  if (openInterest === undefined) return undefined;

  const positions: Record<string, CotPositions> = {};
  for (const category of columns.categories) {
    const parsedPositions = parsePositions(record, category);
    if (!parsedPositions) return undefined;
    positions[category.key] = parsedPositions;
  }

  const totalReportable = positions["totalReportable"];
  const nonReportable = positions["nonReportable"];
  if (!totalReportable || !nonReportable) return undefined;

  const marketCode = stringField(record, "cftc_market_code")?.trim();
  const commodityName = stringField(record, "commodity_name")?.trim();
  const commodityGroup = stringField(record, "commodity_group_name")?.trim();
  const openInterestChange = numericColumn(record, columns.openInterestChange);
  const tradersTotal = numericColumn(record, columns.tradersTotal);

  const base = {
    dataset: definition.dataset,
    asOf,
    market,
    marketName: stringField(record, "contract_market_name")?.trim() ?? market,
    cftcContractMarketCode: code,
    ...(marketCode ? { cftcMarketCode: marketCode } : {}),
    ...(commodityName ? { commodityName } : {}),
    ...(commodityGroup ? { commodityGroup } : {}),
    openInterest,
    ...(openInterestChange !== undefined ? { openInterestChange } : {}),
    ...(tradersTotal !== undefined ? { tradersTotal } : {}),
    totalReportable,
    nonReportable,
  };

  if (definition.family === "legacy") {
    const nonCommercial = positions["nonCommercial"];
    const commercial = positions["commercial"];
    if (!nonCommercial || !commercial) return undefined;
    return {
      ...base,
      family: "legacy",
      nonCommercial,
      commercial,
    };
  }
  if (definition.family === "disaggregated") {
    const producerMerchant = positions["producerMerchant"];
    const swapDealers = positions["swapDealers"];
    const managedMoney = positions["managedMoney"];
    const otherReportables = positions["otherReportables"];
    if (!producerMerchant || !swapDealers || !managedMoney || !otherReportables) {
      return undefined;
    }
    return {
      ...base,
      family: "disaggregated",
      producerMerchant,
      swapDealers,
      managedMoney,
      otherReportables,
    };
  }
  if (definition.family === "tff") {
    const dealers = positions["dealers"];
    const assetManagers = positions["assetManagers"];
    const leveragedFunds = positions["leveragedFunds"];
    const otherReportables = positions["otherReportables"];
    if (!dealers || !assetManagers || !leveragedFunds || !otherReportables) {
      return undefined;
    }
    return {
      ...base,
      family: "tff",
      dealers,
      assetManagers,
      leveragedFunds,
      otherReportables,
    };
  }
  const nonCommercialExIndex = positions["nonCommercialExIndex"];
  const commercialExIndex = positions["commercialExIndex"];
  const indexTraders = positions["indexTraders"];
  if (!nonCommercialExIndex || !commercialExIndex || !indexTraders) return undefined;
  return {
    ...base,
    family: "cit",
    nonCommercialExIndex,
    commercialExIndex,
    indexTraders,
  };
}

function parsePositions(
  record: Record<string, unknown>,
  category: CotCategoryColumns,
): CotPositions | undefined {
  const long = numericColumn(record, category.long);
  const short = numericColumn(record, category.short);
  if (long === undefined || short === undefined) return undefined;

  const spreading = category.spreading ? numericColumn(record, category.spreading) : undefined;
  const longChange = category.longChange ? numericColumn(record, category.longChange) : undefined;
  const shortChange = category.shortChange
    ? numericColumn(record, category.shortChange)
    : undefined;
  const spreadingChange = category.spreadingChange
    ? numericColumn(record, category.spreadingChange)
    : undefined;
  return {
    long,
    short,
    ...(spreading !== undefined ? { spreading } : {}),
    ...(longChange !== undefined ? { longChange } : {}),
    ...(shortChange !== undefined ? { shortChange } : {}),
    ...(spreadingChange !== undefined ? { spreadingChange } : {}),
  };
}

function numericColumn(record: Record<string, unknown>, column: string): number | undefined {
  const value = record[column];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatInteger(value: number): string {
  const digits = String(Math.round(Math.abs(value)));
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    const fromEnd = digits.length - index;
    grouped += digits[index];
    if (fromEnd > 3 && fromEnd % 3 === 1) grouped += ",";
  }
  return `${value < 0 ? "-" : ""}${grouped}`;
}

function formatSigned(value: number): string {
  return value < 0 ? formatInteger(value) : `+${formatInteger(value)}`;
}

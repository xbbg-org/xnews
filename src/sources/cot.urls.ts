import { normalizeDateOnly } from "../dates.js";
import { normalizeLimit } from "../options.js";
import type { SourceFetchOptions } from "../types.js";

/**
 * CFTC Commitments of Traders via the Socrata Open Data API
 * (https://publicreporting.cftc.gov). One dataset per report family and
 * futures-only/combined variant; every value arrives as a string. Column
 * names are CFTC's, preserved verbatim — including the published typos
 * (`noncomm_postions_spread_all`, `change_in_noncomm_spead_all`), the
 * `swap__*` double underscores, and the supplemental (CIT) dataset's mixed
 * casing. `test/cot.test.ts` pins them; `bun run smoke:cot` catches
 * upstream renames.
 */

export type CotReportFamily = "legacy" | "disaggregated" | "tff" | "cit";

export type CotDataset =
  | "legacy_futures_only"
  | "legacy_combined"
  | "disaggregated_futures_only"
  | "disaggregated_combined"
  | "tff_futures_only"
  | "tff_combined"
  | "cit_supplemental";

export interface CotDatasetDefinition {
  readonly dataset: CotDataset;
  readonly family: CotReportFamily;
  /** Futures-and-options combined (`true`) or futures only (`false`). */
  readonly combined: boolean;
  readonly socrataId: string;
  readonly name: string;
}

export const COT_DATASETS: readonly CotDatasetDefinition[] = [
  {
    dataset: "legacy_futures_only",
    family: "legacy",
    combined: false,
    socrataId: "6dca-aqww",
    name: "Legacy - Futures Only",
  },
  {
    dataset: "legacy_combined",
    family: "legacy",
    combined: true,
    socrataId: "jun7-fc8e",
    name: "Legacy - Futures and Options Combined",
  },
  {
    dataset: "disaggregated_futures_only",
    family: "disaggregated",
    combined: false,
    socrataId: "72hh-3qpy",
    name: "Disaggregated - Futures Only",
  },
  {
    dataset: "disaggregated_combined",
    family: "disaggregated",
    combined: true,
    socrataId: "kh3c-gbw2",
    name: "Disaggregated - Futures and Options Combined",
  },
  {
    dataset: "tff_futures_only",
    family: "tff",
    combined: false,
    socrataId: "gpe5-46if",
    name: "Traders in Financial Futures - Futures Only",
  },
  {
    dataset: "tff_combined",
    family: "tff",
    combined: true,
    socrataId: "yw9f-hn96",
    name: "Traders in Financial Futures - Futures and Options Combined",
  },
  {
    dataset: "cit_supplemental",
    family: "cit",
    combined: true,
    socrataId: "4zgm-a668",
    name: "Supplemental Commodity Index Traders",
  },
];

/**
 * Resolves a report family and variant to its dataset definition. The
 * supplemental (CIT) report is only published futures-and-options combined,
 * so `family: "cit"` with `combined: false` is a `RangeError`.
 */
export function cotDatasetDefinition(
  family: CotReportFamily,
  options: { readonly combined?: boolean } = {},
): CotDatasetDefinition {
  if (family === "cit" && options.combined === false) {
    throw new RangeError(
      "the supplemental (cit) report is only published futures-and-options combined",
    );
  }
  const combined = family === "cit" ? true : (options.combined ?? false);
  const definition = COT_DATASETS.find(
    (entry) => entry.family === family && entry.combined === combined,
  );
  if (!definition) {
    throw new RangeError(
      `unknown COT report family ${JSON.stringify(family)}; expected one of: legacy, disaggregated, tff, cit`,
    );
  }
  return definition;
}

function requireDataset(dataset: CotDataset | CotDatasetDefinition): CotDatasetDefinition {
  if (typeof dataset !== "string") return dataset;
  const definition = COT_DATASETS.find((entry) => entry.dataset === dataset);
  if (!definition) {
    const choices = COT_DATASETS.map((entry) => entry.dataset).join(", ");
    throw new RangeError(
      `unknown COT dataset ${JSON.stringify(dataset)}; expected one of: ${choices}`,
    );
  }
  return definition;
}

export interface CotMarketPreset {
  readonly symbol: string;
  readonly name: string;
  readonly cftcContractMarketCode: string;
  /** Codes the same market reported under in earlier years. */
  readonly historicalContractMarketCodes: readonly string[];
  readonly cftcMarketCode: string;
  /** Lowercase lookup aliases accepted by `cotMarketPreset`. */
  readonly aliases: readonly string[];
}

/** Named financial-futures markets with their CFTC contract market codes. */
export const COT_MARKETS: readonly CotMarketPreset[] = [
  {
    symbol: "ES",
    name: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE",
    cftcContractMarketCode: "13874A",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CME",
    aliases: ["sp500", "e-mini s&p 500"],
  },
  {
    symbol: "NQ",
    name: "NASDAQ MINI - CHICAGO MERCANTILE EXCHANGE",
    cftcContractMarketCode: "209742",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CME",
    aliases: ["nasdaq", "nasdaq-100", "nasdaq mini"],
  },
  {
    symbol: "YM",
    name: "DJIA x $5 - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "124603",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["dow", "e-mini dow", "djia"],
  },
  {
    symbol: "RTY",
    name: "RUSSELL E-MINI - CHICAGO MERCANTILE EXCHANGE",
    cftcContractMarketCode: "239742",
    historicalContractMarketCodes: ["23977A"],
    cftcMarketCode: "CME",
    aliases: ["russell", "russell 2000", "russell e-mini"],
  },
  {
    symbol: "ZT",
    name: "UST 2Y NOTE - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "042601",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["tu", "2y", "2-year treasury", "two-year treasury"],
  },
  {
    symbol: "ZF",
    name: "UST 5Y NOTE - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "044601",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["fv", "5y", "5-year treasury", "five-year treasury"],
  },
  {
    symbol: "ZN",
    name: "UST 10Y NOTE - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "043602",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["ty", "10y", "10-year treasury", "ten-year treasury"],
  },
  {
    symbol: "ZB",
    name: "UST BOND - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "020601",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["us", "30y", "treasury bond"],
  },
  {
    symbol: "UB",
    name: "ULTRA US T BOND - CHICAGO BOARD OF TRADE",
    cftcContractMarketCode: "020604",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CBT",
    aliases: ["wn", "ultra bond", "ultra treasury bond"],
  },
  {
    symbol: "VIX",
    name: "VIX FUTURES - CBOE FUTURES EXCHANGE",
    cftcContractMarketCode: "1170E1",
    historicalContractMarketCodes: [],
    cftcMarketCode: "CFE",
    aliases: ["vx", "ux", "vix futures", "volatility"],
  },
];

/** Looks up a market preset by symbol or alias, case-insensitively. */
export function cotMarketPreset(symbolOrAlias: string): CotMarketPreset | undefined {
  const needle = symbolOrAlias.trim().toLowerCase();
  if (!needle) return undefined;
  return COT_MARKETS.find(
    (market) => market.symbol.toLowerCase() === needle || market.aliases.includes(needle),
  );
}

const COT_MARKET_CODE_PATTERN = /^[0-9A-Za-z]{4,10}$/;

/**
 * Resolves preset symbols, aliases, and raw CFTC contract market codes to a
 * deduplicated code list (presets contribute their historical codes too).
 * Anything that is neither a preset nor code-shaped is a `RangeError`.
 */
export function resolveCotMarketCodes(markets: readonly string[]): readonly string[] {
  const codes = new Set<string>();
  for (const market of markets) {
    const preset = cotMarketPreset(market);
    if (preset) {
      codes.add(preset.cftcContractMarketCode);
      for (const code of preset.historicalContractMarketCodes) codes.add(code);
      continue;
    }
    const raw = market.trim().toUpperCase();
    if (!COT_MARKET_CODE_PATTERN.test(raw)) {
      const symbols = COT_MARKETS.map((entry) => entry.symbol).join(", ");
      throw new RangeError(
        `unknown COT market ${JSON.stringify(market)}; expected a preset symbol (${symbols}), a preset alias, or a raw CFTC contract market code`,
      );
    }
    codes.add(raw);
  }
  return [...codes];
}

export interface CotCategoryColumns {
  /** Property name on the parsed row (e.g. `"leveragedFunds"`). */
  readonly key: string;
  /** Human-readable label used by `cotReleaseToNewsItems`. */
  readonly label: string;
  readonly long: string;
  readonly short: string;
  readonly spreading?: string;
  readonly longChange?: string;
  readonly shortChange?: string;
  readonly spreadingChange?: string;
}

export interface CotFamilyColumns {
  readonly openInterest: string;
  readonly openInterestChange: string;
  readonly tradersTotal: string;
  readonly categories: readonly CotCategoryColumns[];
}

/** Identity columns shared by every COT dataset. */
export const COT_IDENTITY_COLUMNS: readonly string[] = [
  "report_date_as_yyyy_mm_dd",
  "market_and_exchange_names",
  "contract_market_name",
  "cftc_contract_market_code",
  "cftc_market_code",
  "commodity_name",
  "commodity_group_name",
];

const TOTAL_REPORTABLE_COLUMNS: CotCategoryColumns = {
  key: "totalReportable",
  label: "Total reportable",
  long: "tot_rept_positions_long_all",
  short: "tot_rept_positions_short",
  longChange: "change_in_tot_rept_long_all",
  shortChange: "change_in_tot_rept_short",
};

const NON_REPORTABLE_COLUMNS: CotCategoryColumns = {
  key: "nonReportable",
  label: "Non-reportable",
  long: "nonrept_positions_long_all",
  short: "nonrept_positions_short_all",
  longChange: "change_in_nonrept_long_all",
  shortChange: "change_in_nonrept_short_all",
};

const OTHER_REPORTABLES_COLUMNS: CotCategoryColumns = {
  key: "otherReportables",
  label: "Other reportables",
  long: "other_rept_positions_long",
  short: "other_rept_positions_short",
  spreading: "other_rept_positions_spread",
  longChange: "change_in_other_rept_long",
  shortChange: "change_in_other_rept_short",
  spreadingChange: "change_in_other_rept_spread",
};

/** Semantic column maps per report family, verbatim from the live API. */
export const COT_FAMILY_COLUMNS: Record<CotReportFamily, CotFamilyColumns> = {
  legacy: {
    openInterest: "open_interest_all",
    openInterestChange: "change_in_open_interest_all",
    tradersTotal: "traders_tot_all",
    categories: [
      {
        key: "nonCommercial",
        label: "Non-commercials",
        long: "noncomm_positions_long_all",
        short: "noncomm_positions_short_all",
        spreading: "noncomm_postions_spread_all",
        longChange: "change_in_noncomm_long_all",
        shortChange: "change_in_noncomm_short_all",
        spreadingChange: "change_in_noncomm_spead_all",
      },
      {
        key: "commercial",
        label: "Commercials",
        long: "comm_positions_long_all",
        short: "comm_positions_short_all",
        longChange: "change_in_comm_long_all",
        shortChange: "change_in_comm_short_all",
      },
      TOTAL_REPORTABLE_COLUMNS,
      NON_REPORTABLE_COLUMNS,
    ],
  },
  disaggregated: {
    openInterest: "open_interest_all",
    openInterestChange: "change_in_open_interest_all",
    tradersTotal: "traders_tot_all",
    categories: [
      {
        key: "producerMerchant",
        label: "Producer/Merchant",
        long: "prod_merc_positions_long",
        short: "prod_merc_positions_short",
        longChange: "change_in_prod_merc_long",
        shortChange: "change_in_prod_merc_short",
      },
      {
        key: "swapDealers",
        label: "Swap dealers",
        long: "swap_positions_long_all",
        short: "swap__positions_short_all",
        spreading: "swap__positions_spread_all",
        longChange: "change_in_swap_long_all",
        shortChange: "change_in_swap_short_all",
        spreadingChange: "change_in_swap_spread_all",
      },
      {
        key: "managedMoney",
        label: "Managed money",
        long: "m_money_positions_long_all",
        short: "m_money_positions_short_all",
        spreading: "m_money_positions_spread",
        longChange: "change_in_m_money_long_all",
        shortChange: "change_in_m_money_short_all",
        spreadingChange: "change_in_m_money_spread",
      },
      OTHER_REPORTABLES_COLUMNS,
      TOTAL_REPORTABLE_COLUMNS,
      NON_REPORTABLE_COLUMNS,
    ],
  },
  tff: {
    openInterest: "open_interest_all",
    openInterestChange: "change_in_open_interest_all",
    tradersTotal: "traders_tot_all",
    categories: [
      {
        key: "dealers",
        label: "Dealers",
        long: "dealer_positions_long_all",
        short: "dealer_positions_short_all",
        spreading: "dealer_positions_spread_all",
        longChange: "change_in_dealer_long_all",
        shortChange: "change_in_dealer_short_all",
        spreadingChange: "change_in_dealer_spread_all",
      },
      {
        key: "assetManagers",
        label: "Asset managers",
        long: "asset_mgr_positions_long",
        short: "asset_mgr_positions_short",
        spreading: "asset_mgr_positions_spread",
        longChange: "change_in_asset_mgr_long",
        shortChange: "change_in_asset_mgr_short",
        spreadingChange: "change_in_asset_mgr_spread",
      },
      {
        key: "leveragedFunds",
        label: "Leveraged funds",
        long: "lev_money_positions_long",
        short: "lev_money_positions_short",
        spreading: "lev_money_positions_spread",
        longChange: "change_in_lev_money_long",
        shortChange: "change_in_lev_money_short",
        spreadingChange: "change_in_lev_money_spread",
      },
      OTHER_REPORTABLES_COLUMNS,
      TOTAL_REPORTABLE_COLUMNS,
      NON_REPORTABLE_COLUMNS,
    ],
  },
  cit: {
    openInterest: "open_interest_all",
    openInterestChange: "change_open_interest_all",
    tradersTotal: "traders_tot_all",
    categories: [
      {
        key: "nonCommercialExIndex",
        label: "Non-commercials ex-index",
        long: "NComm_Postions_Long_All_NoCIT",
        short: "NComm_Postions_Short_All_NoCIT",
        spreading: "NComm_Postions_Spread_All_NoCIT",
        longChange: "change_noncomm_long_all_nocit",
        shortChange: "Change_NonComm_Short_All_NoCIT",
        spreadingChange: "Change_NonComm_Spead_All_NoCIT",
      },
      {
        key: "commercialExIndex",
        label: "Commercials ex-index",
        long: "comm_positions_long_all_nocit",
        short: "Comm_Positions_Short_All_NoCIT",
        longChange: "change_comm_long_all_nocit",
        shortChange: "change_comm_short_all_nocit",
      },
      {
        key: "indexTraders",
        label: "Index traders",
        long: "cit_positions_long_all",
        short: "cit_positions_short_all",
        longChange: "change_cit_long_all",
        shortChange: "change_cit_short_all",
      },
      {
        key: "totalReportable",
        label: "Total reportable",
        long: "tot_rept_positions_long_all",
        short: "tot_rept_positions_short",
        longChange: "change_tot_rept_long_all",
        shortChange: "change_tot_rept_short_all",
      },
      {
        key: "nonReportable",
        label: "Non-reportable",
        long: "nonrept_positions_long_all",
        short: "nonrept_positions_short_all",
        longChange: "change_nonrept_long_all",
        shortChange: "change_nonrept_short_all",
      },
    ],
  },
};

const SOCRATA_BASE = "https://publicreporting.cftc.gov";
const REPORT_DATE_COLUMN = "report_date_as_yyyy_mm_dd";

/** Default `$limit` when the caller does not bound a query. */
export const COT_DEFAULT_ROW_LIMIT = 5000;
/** Socrata's per-request row ceiling. Page longer ranges with `since`/`until`. */
export const COT_MAX_ROW_LIMIT = 50_000;

export interface CotReportUrlOptions extends Pick<SourceFetchOptions, "limit" | "since" | "until"> {
  /** Preset symbols, aliases, or raw CFTC contract market codes. */
  readonly markets?: readonly string[];
  /** Exact report date (`YYYY-MM-DD`); how latest-week fetches pin a week. */
  readonly asOf?: string;
  /** Socrata app token; lifts the shared unauthenticated IP throttling pool. */
  readonly appToken?: string;
}

/**
 * Builds the row query for a COT dataset: curated `$select` columns, date
 * and market `$where` filters, newest-first `$order`, and a bounded
 * `$limit` (default {@link COT_DEFAULT_ROW_LIMIT}, ceiling
 * {@link COT_MAX_ROW_LIMIT}).
 */
export function cotReportUrl(
  dataset: CotDataset | CotDatasetDefinition,
  options: CotReportUrlOptions = {},
): string {
  const definition = requireDataset(dataset);
  const where = cotWhereClause(options);
  const url = new URL(`${SOCRATA_BASE}/resource/${definition.socrataId}.json`);
  url.searchParams.set("$select", cotSelectColumns(definition.family).join(","));
  if (where) url.searchParams.set("$where", where);
  url.searchParams.set("$order", `${REPORT_DATE_COLUMN} DESC,cftc_contract_market_code`);
  url.searchParams.set("$limit", String(cotRowLimit(options.limit)));
  if (options.appToken) url.searchParams.set("$$app_token", options.appToken);
  return url.toString();
}

/** Builds the one-row probe for a dataset's most recent report date. */
export function cotLatestDateUrl(
  dataset: CotDataset | CotDatasetDefinition,
  options: Pick<CotReportUrlOptions, "markets" | "appToken"> = {},
): string {
  const definition = requireDataset(dataset);
  const url = new URL(`${SOCRATA_BASE}/resource/${definition.socrataId}.json`);
  url.searchParams.set("$select", `max(${REPORT_DATE_COLUMN}) AS latest`);
  const where = cotWhereClause(options);
  if (where) url.searchParams.set("$where", where);
  if (options.appToken) url.searchParams.set("$$app_token", options.appToken);
  return url.toString();
}

/** Human-facing Socrata page for a dataset. */
export function cotDatasetPageUrl(dataset: CotDataset | CotDatasetDefinition): string {
  return `${SOCRATA_BASE}/d/${requireDataset(dataset).socrataId}`;
}

function cotSelectColumns(family: CotReportFamily): readonly string[] {
  const columns = COT_FAMILY_COLUMNS[family];
  const selected = [
    ...COT_IDENTITY_COLUMNS,
    columns.openInterest,
    columns.openInterestChange,
    columns.tradersTotal,
  ];
  for (const category of columns.categories) {
    selected.push(category.long, category.short);
    if (category.spreading) selected.push(category.spreading);
    if (category.longChange) selected.push(category.longChange);
    if (category.shortChange) selected.push(category.shortChange);
    if (category.spreadingChange) selected.push(category.spreadingChange);
  }
  return selected;
}

function cotWhereClause(options: Omit<CotReportUrlOptions, "limit">): string | undefined {
  const clauses: string[] = [];
  if (options.markets?.length) {
    const codes = resolveCotMarketCodes(options.markets);
    clauses.push(`cftc_contract_market_code in (${codes.map(quoteSoql).join(",")})`);
  }
  const asOf = requireDateOnly(options.asOf, "asOf");
  if (asOf) clauses.push(`${REPORT_DATE_COLUMN} = ${quoteSoql(asOf)}`);
  const since = requireDateOnly(options.since, "since");
  if (since) clauses.push(`${REPORT_DATE_COLUMN} >= ${quoteSoql(since)}`);
  const until = requireDateOnly(options.until, "until");
  if (until) clauses.push(`${REPORT_DATE_COLUMN} <= ${quoteSoql(until)}`);
  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

function cotRowLimit(limit: number | undefined): number {
  const normalized = normalizeLimit(limit) ?? COT_DEFAULT_ROW_LIMIT;
  if (normalized > COT_MAX_ROW_LIMIT) {
    throw new RangeError(
      `limit must be at most ${COT_MAX_ROW_LIMIT} (Socrata's row ceiling); page longer ranges with since/until`,
    );
  }
  return normalized;
}

function quoteSoql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requireDateOnly(
  value: string | Date | undefined,
  label: "asOf" | "since" | "until",
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeDateOnly(value);
  if (normalized === null) {
    throw new RangeError(`${label} must be a valid date or ISO date-time`);
  }
  return normalized;
}

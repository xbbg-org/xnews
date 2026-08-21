import { fetchText } from "../http.js";
import { isRecord, numberField, stringField } from "../json.js";
import type { DataFetchOptions, DataSource, SourceFetchOptions } from "../types.js";
import { WORLD_BANK_AGGREGATE_CODES, worldBankIndicatorUrl } from "./worldbankindicators.urls.js";

export {
  isWorldBankIndicatorAlias,
  WORLD_BANK_AGGREGATE_CODES,
  WORLD_BANK_INDICATORS,
  worldBankIndicatorUrl,
} from "./worldbankindicators.urls.js";
export type {
  WorldBankIndicatorAlias,
  WorldBankIndicatorDefinition,
} from "./worldbankindicators.urls.js";

const WORLD_BANK_INDICATORS_PROVIDER_ID = "world-bank-indicators";
const WORLD_BANK_INDICATORS_SHAPE_ERROR = "unexpected World Bank Indicators response shape";

export interface WorldBankIndicatorRow {
  readonly indicatorCode: string;
  readonly indicatorName: string;
  readonly countryName: string;
  readonly countryIso3: string;
  readonly year: string;
  readonly value: number;
  readonly unit?: string;
  /** Consumers wanting sovereign-only comparisons must exclude aggregate rows. */
  readonly isAggregate: boolean;
}

export interface WorldBankIndicatorDataSourceOptions extends SourceFetchOptions {
  /** A key from `WORLD_BANK_INDICATORS` or a raw World Bank indicator code. */
  readonly indicator: string;
}

/** Fetches the most recent non-empty observation for every country and aggregate. */
export async function fetchWorldBankIndicator(
  indicator: string,
  options: SourceFetchOptions = {},
): Promise<WorldBankIndicatorRow[]> {
  const url = worldBankIndicatorUrl(indicator);
  return parseWorldBankIndicator(await fetchText(url, options));
}

/** Parses a World Bank Indicators `[metadata, rows]` response. Pure and network-free. */
export function parseWorldBankIndicator(body: string): WorldBankIndicatorRow[] {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = undefined;
  }

  if (!Array.isArray(payload) || payload.length !== 2) {
    throw new Error(WORLD_BANK_INDICATORS_SHAPE_ERROR);
  }

  const metadata = payload[0];
  const sourceRows = payload[1];
  if (!isWorldBankMetadata(metadata)) {
    throw new Error(WORLD_BANK_INDICATORS_SHAPE_ERROR);
  }
  if (sourceRows === null && Number(metadata["total"]) === 0) return [];
  if (!Array.isArray(sourceRows)) {
    throw new Error(WORLD_BANK_INDICATORS_SHAPE_ERROR);
  }

  let nonNullCandidates = 0;
  const rows: WorldBankIndicatorRow[] = [];
  for (const sourceRow of sourceRows) {
    if (isRecord(sourceRow) && !Array.isArray(sourceRow) && sourceRow["value"] === null) {
      continue;
    }

    nonNullCandidates += 1;
    if (!isRecord(sourceRow) || Array.isArray(sourceRow)) continue;
    const row = parseWorldBankIndicatorRow(sourceRow);
    if (row !== undefined) rows.push(row);
  }

  if (nonNullCandidates > 0 && rows.length === 0) {
    throw new Error("World Bank Indicators response contained no valid records");
  }
  return rows;
}

/** Binds one World Bank indicator to the generic structured-data lane. */
export function worldBankIndicatorDataSource(
  options: WorldBankIndicatorDataSourceOptions,
): DataSource<WorldBankIndicatorRow> {
  const { indicator, ...sourceOptions } = options;
  const dataset = indicator.trim();
  const requestUrl = worldBankIndicatorUrl(dataset);
  const merged = (fetchOptions: DataFetchOptions): SourceFetchOptions => ({
    ...sourceOptions,
    ...fetchOptions,
  });

  return {
    provider: WORLD_BANK_INDICATORS_PROVIDER_ID,
    dataset,
    requestUrls: () => [requestUrl],
    fetchRelease: async (fetchOptions = {}) => {
      const rows = await fetchWorldBankIndicator(dataset, merged(fetchOptions));
      const first = rows[0];
      if (first === undefined) return undefined;

      let maxYear = first.year;
      for (let index = 1; index < rows.length; index += 1) {
        const year = rows[index]?.year;
        if (year !== undefined && year > maxYear) maxYear = year;
      }
      // The API reports annual periods only. Year-end preserves that finest
      // granularity instead of fabricating a month and day from the fetch date.
      const asOf = `${maxYear}-12-31`;
      if (fetchOptions.ifNewerThan !== undefined && fetchOptions.ifNewerThan >= asOf) {
        return undefined;
      }

      return {
        provider: WORLD_BANK_INDICATORS_PROVIDER_ID,
        dataset,
        asOf,
        url: requestUrl,
        rows,
      };
    },
  };
}

function parseWorldBankIndicatorRow(
  record: Record<string, unknown>,
): WorldBankIndicatorRow | undefined {
  const indicator = record["indicator"];
  const country = record["country"];
  if (
    !isRecord(indicator) ||
    Array.isArray(indicator) ||
    !isRecord(country) ||
    Array.isArray(country)
  ) {
    return undefined;
  }

  const indicatorCode = stringField(indicator, "id")?.trim();
  const indicatorName = stringField(indicator, "value")?.trim();
  const countryName = stringField(country, "value")?.trim();
  const countryIso3 = stringField(record, "countryiso3code")?.trim();
  const year = stringField(record, "date")?.trim();
  const value = numberField(record, "value");
  if (
    !indicatorCode ||
    !indicatorName ||
    !countryName ||
    !countryIso3 ||
    !year ||
    year === "0000" ||
    !/^\d{4}$/.test(year) ||
    value === undefined
  ) {
    return undefined;
  }

  const unit = stringField(record, "unit")?.trim();
  return {
    indicatorCode,
    indicatorName,
    countryName,
    countryIso3,
    year,
    value,
    ...(unit ? { unit } : {}),
    isAggregate: WORLD_BANK_AGGREGATE_CODES.has(countryIso3),
  };
}

function isWorldBankMetadata(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  return (
    isNonNegativeInteger(value["page"]) &&
    isNonNegativeInteger(value["pages"]) &&
    isNonNegativeInteger(value["per_page"]) &&
    isNonNegativeInteger(value["total"])
  );
}

function isNonNegativeInteger(value: unknown): boolean {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0;
  return typeof value === "string" && /^(0|[1-9]\d*)$/.test(value);
}

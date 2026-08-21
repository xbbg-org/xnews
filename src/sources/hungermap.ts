import { normalizeDateOnly } from "../dates.js";
import { fetchRaw } from "../http.js";
import { isRecord, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import { HUNGERMAP_FOOD_SECURITY_URL, hungerMapAuthHeaders } from "./hungermap.urls.js";
import type { HungerMapCredentials } from "./hungermap.urls.js";

const HUNGERMAP_SHAPE_ERROR = "unexpected WFP HungerMap response shape";

export { HUNGERMAP_FOOD_SECURITY_URL, hungerMapAuthHeaders } from "./hungermap.urls.js";
export type { HungerMapCredentials } from "./hungermap.urls.js";

export type HungerMapFetchOptions = SourceFetchOptions & HungerMapCredentials;

export interface HungerMapFoodSecurityRow {
  readonly countryIso3: string;
  readonly countryName: string;
  readonly peopleInsufficientFood?: number;
  readonly prevalence?: number;
  readonly asOfDate?: string;
}

/**
 * Fetches WFP HungerMap country-level food-security estimates. Requires an
 * `apiKey`: WFP withdrew anonymous access to this endpoint.
 */
export async function fetchHungerMapFoodSecurity(
  options: HungerMapFetchOptions = {},
): Promise<HungerMapFoodSecurityRow[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const response = await fetchRaw(HUNGERMAP_FOOD_SECURITY_URL, options, {
    headers: hungerMapAuthHeaders(options),
  });
  const rows = parseHungerMapFoodSecurity(new TextDecoder().decode(response.bytes));
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** Parses HungerMap's nested `body.countries` response without performing I/O. */
export function parseHungerMapFoodSecurity(body: string): HungerMapFoodSecurityRow[] {
  const payload = parseJsonRecord(body, "WFP HungerMap");
  const responseBody = payload["body"];
  if (!isRecord(responseBody)) throw new Error(HUNGERMAP_SHAPE_ERROR);
  const countries = responseBody["countries"];
  if (!Array.isArray(countries)) throw new Error(HUNGERMAP_SHAPE_ERROR);
  const records = recordArray(countries);
  const rows: HungerMapFoodSecurityRow[] = [];
  for (const record of records) {
    const country = record["country"];
    if (!isRecord(country)) continue;
    const countryIso3 = cleanStringField(country, "iso3");
    const countryName = cleanStringField(country, "name");
    if (countryIso3 === undefined || countryName === undefined) continue;

    const metrics = record["metrics"];
    const fcs = isRecord(metrics) ? metrics["fcs"] : undefined;
    const peopleInsufficientFood = isRecord(fcs) ? numericField(fcs, "people") : undefined;
    const prevalence = isRecord(fcs) ? numericField(fcs, "prevalence") : undefined;
    const asOfDate = normalizeStringDate(stringField(record, "date"));
    rows.push({
      countryIso3,
      countryName,
      ...(peopleInsufficientFood !== undefined ? { peopleInsufficientFood } : {}),
      ...(prevalence !== undefined ? { prevalence } : {}),
      ...(asOfDate !== undefined ? { asOfDate } : {}),
    });
  }
  if (countries.length > 0 && rows.length === 0) throw new Error(HUNGERMAP_SHAPE_ERROR);
  return rows;
}

/** Binds WFP's food-security country dataset to the data lane. */
export function hungerMapDataSource(
  options: HungerMapFetchOptions = {},
): DataSource<HungerMapFoodSecurityRow> {
  return {
    provider: "wfp-hungermap",
    dataset: "food-security",
    requestUrls: (fetchOptions = {}) =>
      normalizeLimit({ ...options, ...fetchOptions }.limit) === 0
        ? []
        : [HUNGERMAP_FOOD_SECURITY_URL],
    fetchRelease: (fetchOptions = {}) => fetchHungerMapRelease({ ...options, ...fetchOptions }),
  };
}

async function fetchHungerMapRelease(
  options: HungerMapFetchOptions & DataFetchOptions,
): Promise<DataRelease<HungerMapFoodSecurityRow> | undefined> {
  const rows = await fetchHungerMapFoodSecurity(options);
  if (rows.length === 0) return undefined;
  let asOf: string | undefined;
  for (const row of rows) {
    if (row.asOfDate !== undefined && (asOf === undefined || row.asOfDate > asOf)) {
      asOf = row.asOfDate;
    }
  }
  if (asOf === undefined) throw new Error(HUNGERMAP_SHAPE_ERROR);
  if (options.ifNewerThan !== undefined && options.ifNewerThan >= asOf) return undefined;
  return {
    provider: "wfp-hungermap",
    dataset: "food-security",
    asOf,
    url: HUNGERMAP_FOOD_SECURITY_URL,
    rows,
  };
}

function cleanStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key)?.trim();
  return value ? value : undefined;
}

function normalizeStringDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return normalizeDateOnly(value) ?? undefined;
}

function numericField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

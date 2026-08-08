import { parseCsvRecords } from "../csv.js";
import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { isRecord } from "../json.js";
import { normalizeLimit } from "../options.js";
import type { DataSource, SourceFetchOptions } from "../types.js";
import {
  HMDA_AGGREGATION_DIMENSIONS,
  HMDA_DATA_BROWSER_API_BASE_URL,
  HMDA_DATA_BROWSER_URL,
  hmdaAggregationsUrl,
  hmdaCountUrl,
  hmdaCsvUrl,
  hmdaFilersUrl,
  hmdaNationwideAggregationsUrl,
  hmdaNationwideCsvUrl,
  hmdaNationwidePipeUrl,
  hmdaPipeUrl,
} from "./hmda.urls.js";
import type {
  HmdaAggregationDimension,
  HmdaCountQuery,
  HmdaFilerQuery,
  HmdaFilterSet,
  HmdaNationwideQuery,
  HmdaQuery,
} from "./hmda.urls.js";

export {
  HMDA_AGGREGATION_DIMENSIONS,
  HMDA_DATA_BROWSER_API_BASE_URL,
  HMDA_DATA_BROWSER_API_DOCUMENTATION_URL,
  HMDA_DATA_BROWSER_URL,
  HMDA_MODIFIED_LAR_DOCUMENTATION_URL,
  hmdaAggregationsUrl,
  hmdaCountUrl,
  hmdaCsvUrl,
  hmdaFilersUrl,
  hmdaNationwideAggregationsUrl,
  hmdaNationwideCsvUrl,
  hmdaNationwidePipeUrl,
  hmdaPipeUrl,
} from "./hmda.urls.js";
export type {
  HmdaActionTaken,
  HmdaAggregationDimension,
  HmdaApplicantAge,
  HmdaConstructionMethod,
  HmdaCountQuery,
  HmdaDimensionFilters,
  HmdaDwellingCategory,
  HmdaEthnicity,
  HmdaFilerQuery,
  HmdaFilterList,
  HmdaFilterSet,
  HmdaGeographyFilters,
  HmdaLienStatus,
  HmdaLoanProduct,
  HmdaLoanPurpose,
  HmdaLoanType,
  HmdaNationwideQuery,
  HmdaQuery,
  HmdaRace,
  HmdaSex,
  HmdaTotalUnits,
  HmdaYear,
  HmdaYearFilter,
} from "./hmda.urls.js";

export interface HmdaAggregation {
  readonly count?: number;
  readonly sum?: number;
  readonly dimensions: Readonly<Partial<Record<HmdaAggregationDimension, string>>>;
  readonly warnings: readonly string[];
}

export interface HmdaFiler {
  readonly lei: string;
  readonly name: string;
  readonly count?: number;
  readonly period?: number;
  readonly warnings: readonly string[];
}

/**
 * One row of the public modified LAR. Frequently queried identity, geography,
 * loan, pricing, and applicant fields are normalized; every published column
 * remains available verbatim in `raw` because CFPB revises the public schema.
 */
export interface HmdaLoanRecord {
  /** 1-based data-row position within the export. */
  readonly rowNumber: number;
  readonly activityYear?: number;
  readonly lei: string;
  readonly derivedMsaMd: string | null;
  readonly stateCode: string | null;
  readonly countyCode: string | null;
  readonly censusTract: string | null;
  readonly derivedLoanProductType: string | null;
  readonly derivedDwellingCategory: string | null;
  readonly derivedEthnicity: string | null;
  readonly derivedRace: string | null;
  readonly derivedSex: string | null;
  readonly actionTaken?: number;
  readonly purchaserType?: number;
  readonly loanType?: number;
  readonly loanPurpose?: number;
  readonly lienStatus?: number;
  readonly loanAmount?: number;
  readonly loanToValueRatio?: number;
  readonly interestRate?: number;
  readonly rateSpread?: number;
  readonly propertyValue?: number;
  readonly constructionMethod?: number;
  readonly occupancyType?: number;
  readonly totalUnits: string | null;
  readonly income?: number;
  readonly debtToIncomeRatio: string | null;
  readonly applicantAge: string | null;
  readonly coApplicantAge: string | null;
  /** The complete modified-LAR row, header-keyed and verbatim. */
  readonly raw: Readonly<Record<string, string>>;
  /** Per-field notes for values this adapter could not coerce. */
  readonly warnings: readonly string[];
}

export interface HmdaDataSourceOptions extends HmdaFilterSet, SourceFetchOptions {
  /** Uses the nationwide aggregation endpoint, which does not accept geography filters. */
  readonly nationwide?: boolean;
}

export function parseHmdaAggregations(
  body: string,
  options: Pick<SourceFetchOptions, "limit"> = {},
): HmdaAggregation[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const payload = parseHmdaJsonRecord(body, "aggregation", HMDA_DATA_BROWSER_API_BASE_URL);
  const sourceRows = payload["aggregations"];
  if (!Array.isArray(sourceRows)) {
    throwUnexpectedHmdaPayload("aggregation", HMDA_DATA_BROWSER_API_BASE_URL);
  }

  const rows: HmdaAggregation[] = [];
  for (const value of sourceRows) {
    if (!isPlainRecord(value)) {
      throwUnexpectedHmdaPayload("aggregation", HMDA_DATA_BROWSER_API_BASE_URL);
    }
    if (!("count" in value) || !("sum" in value)) {
      throwUnexpectedHmdaPayload("aggregation", HMDA_DATA_BROWSER_API_BASE_URL);
    }
    const warnings: string[] = [];
    const count = coerceNumber(value["count"], "count", warnings, { integer: true, minimum: 0 });
    const sum = coerceNumber(value["sum"], "sum", warnings, { minimum: 0 });
    const dimensions: Partial<Record<HmdaAggregationDimension, string>> = {};
    for (const dimension of HMDA_AGGREGATION_DIMENSIONS) {
      const rawValue = value[dimension];
      if (rawValue === undefined) continue;
      if (typeof rawValue === "string") {
        dimensions[dimension] = rawValue;
      } else {
        warnings.push(
          `hmda aggregation: could not coerce ${dimension} ${displayRawValue(rawValue)}`,
        );
      }
    }
    rows.push({
      ...(count === undefined ? {} : { count }),
      ...(sum === undefined ? {} : { sum }),
      dimensions,
      warnings,
    });
    if (limit !== undefined && rows.length >= limit) break;
  }
  return rows;
}

export function parseHmdaFilers(
  body: string,
  options: Pick<SourceFetchOptions, "limit"> = {},
): HmdaFiler[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const payload = parseHmdaJsonRecord(body, "filer", `${HMDA_DATA_BROWSER_API_BASE_URL}/filers`);
  const institutions = payload["institutions"];
  if (!Array.isArray(institutions)) {
    throwUnexpectedHmdaPayload("filer", `${HMDA_DATA_BROWSER_API_BASE_URL}/filers`);
  }

  const filers: HmdaFiler[] = [];
  for (const value of institutions) {
    if (!isPlainRecord(value)) {
      throwUnexpectedHmdaPayload("filer", `${HMDA_DATA_BROWSER_API_BASE_URL}/filers`);
    }
    const lei = typeof value["lei"] === "string" ? value["lei"].trim() : "";
    const name = typeof value["name"] === "string" ? value["name"].trim() : "";
    if (lei === "" || name === "" || !("period" in value)) {
      throwUnexpectedHmdaPayload("filer", `${HMDA_DATA_BROWSER_API_BASE_URL}/filers`);
    }
    const warnings: string[] = [];
    const count =
      "count" in value
        ? coerceNumber(value["count"], "count", warnings, { integer: true, minimum: 0 })
        : undefined;
    const period = coerceNumber(value["period"], "period", warnings, {
      integer: true,
      minimum: 2018,
      maximum: 9999,
    });
    filers.push({
      lei,
      name,
      ...(count === undefined ? {} : { count }),
      ...(period === undefined ? {} : { period }),
      warnings,
    });
    if (limit !== undefined && filers.length >= limit) break;
  }
  return filers;
}

export function parseHmdaLoanCsv(
  text: string,
  options: Pick<SourceFetchOptions, "limit"> = {},
): HmdaLoanRecord[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  let records: string[][];
  try {
    records = parseCsvRecords(text);
  } catch {
    throwUnexpectedHmdaPayload("loan CSV", `${HMDA_DATA_BROWSER_API_BASE_URL}/csv`);
  }
  return normalizeHmdaLoanRecords(records, ",", limit);
}

export function parseHmdaLoanPipe(
  text: string,
  options: Pick<SourceFetchOptions, "limit"> = {},
): HmdaLoanRecord[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const records: string[][] = [];
  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    if (line.endsWith("\r")) {
      throwUnexpectedHmdaPayload("loan pipe", `${HMDA_DATA_BROWSER_API_BASE_URL}/pipe`);
    }
    if (line !== "") records.push(line.split("|"));
  }
  return normalizeHmdaLoanRecords(records, "|", limit);
}

export async function fetchHmdaCount(
  query: HmdaCountQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaAggregation | undefined> {
  if (normalizeLimit(options.limit) === 0) return undefined;
  const url = hmdaCountUrl(query);
  const rows = parseHmdaAggregations(
    await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT),
    { limit: 2 },
  );
  if (rows.length > 1) throwUnexpectedHmdaPayload("count", url);
  return rows[0];
}

export async function fetchHmdaAggregations(
  query: HmdaQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaAggregation[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaAggregationsUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaAggregations(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaNationwideAggregations(
  query: HmdaNationwideQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaAggregation[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaNationwideAggregationsUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaAggregations(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaFilers(
  query: HmdaFilerQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaFiler[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaFilersUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaFilers(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaLoanRecords(
  query: HmdaQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaLoanRecord[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaCsvUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaLoanCsv(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaPipeLoanRecords(
  query: HmdaQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaLoanRecord[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaPipeUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaLoanPipe(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaNationwideLoanRecords(
  query: HmdaNationwideQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaLoanRecord[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaNationwideCsvUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaLoanCsv(body, limit === undefined ? {} : { limit });
}

export async function fetchHmdaNationwidePipeLoanRecords(
  query: HmdaNationwideQuery,
  options: SourceFetchOptions = {},
): Promise<HmdaLoanRecord[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const url = hmdaNationwidePipeUrl(query);
  const body = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseHmdaLoanPipe(body, limit === undefined ? {} : { limit });
}

/**
 * Binds an aggregation filter set to an initial HMDA data year. Once a watcher
 * has seen that year, a 100-byte count request for the next year establishes
 * publication before the aggregation endpoint is queried.
 */
export function hmdaDataSource(
  year: number,
  options: HmdaDataSourceOptions,
): DataSource<HmdaAggregation> {
  if (!Number.isSafeInteger(year) || year < 2018 || year > 9999) {
    throw new RangeError("HMDA data source year must be an integer from 2018 through 9999");
  }
  const filters = hmdaFiltersFromOptions(options);
  const initialQuery = { years: year, ...filters };
  const initialUrl = options.nationwide
    ? hmdaNationwideAggregationsUrl(initialQuery)
    : hmdaAggregationsUrl(initialQuery);
  const datasetUrl = new URL(initialUrl);
  datasetUrl.searchParams.delete("years");
  const filterIdentity = datasetUrl.searchParams.toString() || "all";
  const dataset = `${options.nationwide ? "nationwide-" : ""}aggregations:${year}:${filterIdentity}`;
  const baseFetchOptions = transportOptions(options);

  return {
    provider: "hmda",
    dataset,
    requestUrls: (fetchOptions = {}) => {
      validateHmdaDataSourceFilters(filters, options.nationwide === true, initialUrl);
      const candidateYear = hmdaCandidateYear(year, fetchOptions.ifNewerThan, initialUrl);
      const query = { years: candidateYear, ...filters };
      const aggregationUrl = options.nationwide
        ? hmdaNationwideAggregationsUrl(query)
        : hmdaAggregationsUrl(query);
      return candidateYear > year
        ? [hmdaCountUrl({ years: candidateYear, states: "DC" }), aggregationUrl]
        : [aggregationUrl];
    },
    fetchRelease: async (fetchOptions = {}) => {
      validateHmdaDataSourceFilters(filters, options.nationwide === true, initialUrl);
      if (normalizeLimit(fetchOptions.limit ?? baseFetchOptions.limit) === 0) return undefined;
      const candidateYear = hmdaCandidateYear(year, fetchOptions.ifNewerThan, initialUrl);
      const mergedOptions = { ...baseFetchOptions, ...fetchOptions };
      if (candidateYear > year) {
        const available = await isHmdaYearAvailable(candidateYear, mergedOptions);
        if (!available) return undefined;
      }
      const query = { years: candidateYear, ...filters };
      const rows = options.nationwide
        ? await fetchHmdaNationwideAggregations(query, mergedOptions)
        : await fetchHmdaAggregations(query, mergedOptions);
      return {
        provider: "hmda",
        dataset,
        asOf: `${candidateYear}-12-31`,
        url: HMDA_DATA_BROWSER_URL,
        rows,
      };
    },
  };
}

function normalizeHmdaLoanRecords(
  records: readonly string[][],
  delimiter: "," | "|",
  limit: number | undefined,
): HmdaLoanRecord[] {
  const errorUrl = `${HMDA_DATA_BROWSER_API_BASE_URL}/${delimiter === "," ? "csv" : "pipe"}`;
  const header = records[0];
  if (
    header === undefined ||
    !header.includes("activity_year") ||
    !header.includes("lei") ||
    !header.includes("action_taken") ||
    new Set(header).size !== header.length
  ) {
    throwUnexpectedHmdaPayload(`loan ${delimiter === "," ? "CSV" : "pipe"}`, errorUrl);
  }

  const rows: HmdaLoanRecord[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index];
    if (cells === undefined || cells.length !== header.length) {
      throwUnexpectedHmdaPayload(`loan ${delimiter === "," ? "CSV" : "pipe"}`, errorUrl);
    }
    const raw: Record<string, string> = {};
    for (let column = 0; column < header.length; column += 1) {
      const name = header[column];
      const value = cells[column];
      if (name !== undefined && value !== undefined) raw[name] = value;
    }
    const lei = raw["lei"]?.trim() ?? "";
    if (lei === "") {
      throwUnexpectedHmdaPayload(`loan ${delimiter === "," ? "CSV" : "pipe"}`, errorUrl);
    }
    rows.push(normalizeHmdaLoanRow(raw, index, lei));
    if (limit !== undefined && rows.length >= limit) break;
  }
  return rows;
}

function normalizeHmdaLoanRow(
  raw: Readonly<Record<string, string>>,
  rowNumber: number,
  lei: string,
): HmdaLoanRecord {
  const warnings: string[] = [];
  const activityYear = coerceLarNumber(raw, "activity_year", rowNumber, warnings, {
    integer: true,
    minimum: 2018,
    maximum: 9999,
  });
  const actionTaken = coerceLarNumber(raw, "action_taken", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const purchaserType = coerceLarNumber(raw, "purchaser_type", rowNumber, warnings, {
    integer: true,
    minimum: 0,
  });
  const loanType = coerceLarNumber(raw, "loan_type", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const loanPurpose = coerceLarNumber(raw, "loan_purpose", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const lienStatus = coerceLarNumber(raw, "lien_status", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const loanAmount = coerceLarNumber(raw, "loan_amount", rowNumber, warnings, { minimum: 0 });
  const loanToValueRatio = coerceLarNumber(raw, "loan_to_value_ratio", rowNumber, warnings);
  const interestRate = coerceLarNumber(raw, "interest_rate", rowNumber, warnings);
  const rateSpread = coerceLarNumber(raw, "rate_spread", rowNumber, warnings);
  const propertyValue = coerceLarNumber(raw, "property_value", rowNumber, warnings, {
    minimum: 0,
  });
  const constructionMethod = coerceLarNumber(raw, "construction_method", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const occupancyType = coerceLarNumber(raw, "occupancy_type", rowNumber, warnings, {
    integer: true,
    minimum: 1,
  });
  const income = coerceLarNumber(raw, "income", rowNumber, warnings);

  return {
    rowNumber,
    ...(activityYear === undefined ? {} : { activityYear }),
    lei,
    derivedMsaMd: nonBlankString(raw["derived_msa-md"]),
    stateCode: nonBlankString(raw["state_code"]),
    countyCode: nonBlankString(raw["county_code"]),
    censusTract: nonBlankString(raw["census_tract"]),
    derivedLoanProductType: nonBlankString(raw["derived_loan_product_type"]),
    derivedDwellingCategory: nonBlankString(raw["derived_dwelling_category"]),
    derivedEthnicity: nonBlankString(raw["derived_ethnicity"]),
    derivedRace: nonBlankString(raw["derived_race"]),
    derivedSex: nonBlankString(raw["derived_sex"]),
    ...(actionTaken === undefined ? {} : { actionTaken }),
    ...(purchaserType === undefined ? {} : { purchaserType }),
    ...(loanType === undefined ? {} : { loanType }),
    ...(loanPurpose === undefined ? {} : { loanPurpose }),
    ...(lienStatus === undefined ? {} : { lienStatus }),
    ...(loanAmount === undefined ? {} : { loanAmount }),
    ...(loanToValueRatio === undefined ? {} : { loanToValueRatio }),
    ...(interestRate === undefined ? {} : { interestRate }),
    ...(rateSpread === undefined ? {} : { rateSpread }),
    ...(propertyValue === undefined ? {} : { propertyValue }),
    ...(constructionMethod === undefined ? {} : { constructionMethod }),
    ...(occupancyType === undefined ? {} : { occupancyType }),
    totalUnits: nonBlankString(raw["total_units"]),
    ...(income === undefined ? {} : { income }),
    debtToIncomeRatio: nonBlankString(raw["debt_to_income_ratio"]),
    applicantAge: nonBlankString(raw["applicant_age"]),
    coApplicantAge: nonBlankString(raw["co-applicant_age"]),
    raw,
    warnings,
  };
}

function coerceLarNumber(
  raw: Readonly<Record<string, string>>,
  field: string,
  rowNumber: number,
  warnings: string[],
  bounds: NumberBounds = {},
): number | undefined {
  const value = raw[field];
  if (value === undefined || value.trim() === "" || isHmdaMissingValue(value)) return undefined;
  const parsed = Number(value);
  if (!numberMatchesBounds(parsed, bounds)) {
    warnings.push(`hmda row ${rowNumber}: could not coerce ${field} ${JSON.stringify(value)}`);
    return undefined;
  }
  return parsed;
}

interface NumberBounds {
  readonly integer?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
}

function coerceNumber(
  value: unknown,
  field: string,
  warnings: string[],
  bounds: NumberBounds = {},
): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  if (!numberMatchesBounds(parsed, bounds)) {
    warnings.push(`hmda: could not coerce ${field} ${displayRawValue(value)}`);
    return undefined;
  }
  return parsed;
}

function numberMatchesBounds(value: number, bounds: NumberBounds): boolean {
  return (
    Number.isFinite(value) &&
    (!bounds.integer || Number.isSafeInteger(value)) &&
    (bounds.minimum === undefined || value >= bounds.minimum) &&
    (bounds.maximum === undefined || value <= bounds.maximum)
  );
}

function isHmdaMissingValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "na" || normalized === "exempt";
}

function nonBlankString(value: string | undefined): string | null {
  if (value === undefined || value.trim() === "") return null;
  return value;
}

function parseHmdaJsonRecord(body: string, label: string, url: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throwUnexpectedHmdaPayload(label, url);
  }
  if (!isPlainRecord(parsed)) throwUnexpectedHmdaPayload(label, url);
  return parsed;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function throwUnexpectedHmdaPayload(label: string, url: string): never {
  throw new XnewsFetchError("network", `HMDA ${label} response had an unexpected shape`, { url });
}

function displayRawValue(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function hmdaFiltersFromOptions(options: HmdaDataSourceOptions): HmdaFilterSet {
  return {
    ...(options.states === undefined ? {} : { states: options.states }),
    ...(options.counties === undefined ? {} : { counties: options.counties }),
    ...(options.msamds === undefined ? {} : { msamds: options.msamds }),
    ...(options.leis === undefined ? {} : { leis: options.leis }),
    ...(options.actions_taken === undefined ? {} : { actions_taken: options.actions_taken }),
    ...(options.loan_types === undefined ? {} : { loan_types: options.loan_types }),
    ...(options.loan_purposes === undefined ? {} : { loan_purposes: options.loan_purposes }),
    ...(options.lien_statuses === undefined ? {} : { lien_statuses: options.lien_statuses }),
    ...(options.construction_methods === undefined
      ? {}
      : { construction_methods: options.construction_methods }),
    ...(options.sexes === undefined ? {} : { sexes: options.sexes }),
    ...(options.races === undefined ? {} : { races: options.races }),
    ...(options.ageapplicant === undefined ? {} : { ageapplicant: options.ageapplicant }),
    ...(options.ethnicities === undefined ? {} : { ethnicities: options.ethnicities }),
    ...(options.total_units === undefined ? {} : { total_units: options.total_units }),
    ...(options.dwelling_categories === undefined
      ? {}
      : { dwelling_categories: options.dwelling_categories }),
    ...(options.loan_products === undefined ? {} : { loan_products: options.loan_products }),
  };
}

function validateHmdaDataSourceFilters(
  filters: HmdaFilterSet,
  nationwide: boolean,
  url: string,
): void {
  let dimensionCount = 0;
  for (const dimension of HMDA_AGGREGATION_DIMENSIONS) {
    const value = filters[dimension];
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) dimensionCount += 1;
  }
  if (dimensionCount === 0 || dimensionCount > 2) {
    throw new XnewsFetchError(
      "config",
      "HMDA aggregation data sources require one or two aggregation dimensions",
      { url },
    );
  }

  const geographyCount = [filters.states, filters.counties, filters.msamds].filter(
    (value) => value !== undefined && (!Array.isArray(value) || value.length > 0),
  ).length;
  if (nationwide) {
    if (geographyCount > 0 || filters.leis !== undefined) {
      throw new XnewsFetchError(
        "config",
        "HMDA nationwide aggregation data sources do not accept geography or LEI filters",
        { url },
      );
    }
  } else if (geographyCount > 1 || (geographyCount === 0 && filters.leis === undefined)) {
    throw new XnewsFetchError(
      "config",
      "HMDA aggregation data sources require one geography filter or an LEI filter",
      { url },
    );
  }
}

function hmdaCandidateYear(
  initialYear: number,
  ifNewerThan: string | undefined,
  url: string,
): number {
  if (ifNewerThan === undefined) return initialYear;
  const parsed = parsePublishedAt(ifNewerThan);
  if (parsed === null || parsed.format !== "date_only") {
    throw new XnewsFetchError("config", "HMDA ifNewerThan must be a real ISO date", { url });
  }
  const date = parsed.instant.slice(0, 10);
  const checkpointYear = Number(date.slice(0, 4));
  const nextYear = date < `${checkpointYear}-12-31` ? checkpointYear : checkpointYear + 1;
  if (nextYear > 9999) return 9999;
  return Math.max(initialYear, nextYear);
}

async function isHmdaYearAvailable(year: number, options: SourceFetchOptions): Promise<boolean> {
  try {
    const count = await fetchHmdaCount({ years: year, states: "DC" }, { ...options, limit: 1 });
    return count !== undefined;
  } catch (error) {
    if (error instanceof XnewsFetchError && error.code === "http_status" && error.status === 400) {
      return false;
    }
    throw error;
  }
}

function transportOptions(options: SourceFetchOptions): SourceFetchOptions {
  return {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.redirect === undefined ? {} : { redirect: options.redirect }),
    ...(options.allowCrossOriginRedirects === undefined
      ? {}
      : { allowCrossOriginRedirects: options.allowCrossOriginRedirects }),
    ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  };
}

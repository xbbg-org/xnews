export const HMDA_DATA_BROWSER_API_BASE_URL = "https://ffiec.cfpb.gov/v2/data-browser-api/view";
export const HMDA_DATA_BROWSER_URL = "https://ffiec.cfpb.gov/data-browser/";
export const HMDA_DATA_BROWSER_API_DOCUMENTATION_URL =
  "https://ffiec.cfpb.gov/documentation/api/data-browser/";
export const HMDA_MODIFIED_LAR_DOCUMENTATION_URL =
  "https://ffiec.cfpb.gov/documentation/publications/modified-lar/resources/using-mlar-data";

export const HMDA_AGGREGATION_DIMENSIONS = [
  "actions_taken",
  "loan_types",
  "loan_purposes",
  "lien_statuses",
  "construction_methods",
  "sexes",
  "races",
  "ageapplicant",
  "ethnicities",
  "total_units",
  "dwelling_categories",
  "loan_products",
] as const;
const HMDA_QUERY_PARAMETERS: Readonly<Record<string, true>> = {
  years: true,
  states: true,
  counties: true,
  msamds: true,
  leis: true,
  actions_taken: true,
  loan_types: true,
  loan_purposes: true,
  lien_statuses: true,
  construction_methods: true,
  sexes: true,
  races: true,
  ageapplicant: true,
  ethnicities: true,
  total_units: true,
  dwelling_categories: true,
  loan_products: true,
};

export type HmdaAggregationDimension = (typeof HMDA_AGGREGATION_DIMENSIONS)[number];
export type HmdaFilterList<T> = T | readonly T[];
export type HmdaYear = number | `${number}`;
export type HmdaActionTaken = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | `${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type HmdaLoanType = 1 | 2 | 3 | 4 | `${1 | 2 | 3 | 4}`;
export type HmdaLoanPurpose = 1 | 2 | 31 | 32 | 4 | 5 | `${1 | 2 | 31 | 32 | 4 | 5}`;
export type HmdaLienStatus = 1 | 2 | `${1 | 2}`;
export type HmdaConstructionMethod = 1 | 2 | `${1 | 2}`;
export type HmdaSex = "Male" | "Female" | "Joint" | "Sex Not Available";
export type HmdaRace =
  | "American Indian or Alaska Native"
  | "Asian"
  | "Black or African American"
  | "Native Hawaiian or Other Pacific Islander"
  | "White"
  | "2 or more minority races"
  | "Joint"
  | "Free Form Text Only"
  | "Race Not Available";
export type HmdaApplicantAge =
  | "<25"
  | "25-34"
  | "35-44"
  | "45-54"
  | "55-64"
  | "65-74"
  | ">74"
  | "8888";
export type HmdaEthnicity =
  | "Hispanic or Latino"
  | "Not Hispanic or Latino"
  | "Joint"
  | "Ethnicity Not Available"
  | "Free Form Text Only";
export type HmdaTotalUnits =
  | 1
  | 2
  | 3
  | 4
  | `${1 | 2 | 3 | 4}`
  | "5-24"
  | "25-49"
  | "50-99"
  | "100-149"
  | ">149";
export type HmdaDwellingCategory =
  | "Single Family (1-4 Units):Site-Built"
  | "Multifamily:Site-Built"
  | "Single Family (1-4 Units):Manufactured"
  | "Multifamily:Manufactured";
export type HmdaLoanProduct =
  | "Conventional:First Lien"
  | "FHA:First Lien"
  | "VA:First Lien"
  | "FSA/RHS:First Lien"
  | "Conventional:Subordinate Lien"
  | "FHA:Subordinate Lien"
  | "VA:Subordinate Lien"
  | "FSA/RHS:Subordinate Lien";

export interface HmdaYearFilter {
  readonly years: HmdaFilterList<HmdaYear>;
}

export interface HmdaGeographyFilters {
  readonly states?: HmdaFilterList<string>;
  readonly counties?: HmdaFilterList<string>;
  readonly msamds?: HmdaFilterList<string>;
  readonly leis?: HmdaFilterList<string>;
}

export interface HmdaDimensionFilters {
  readonly actions_taken?: HmdaFilterList<HmdaActionTaken>;
  readonly loan_types?: HmdaFilterList<HmdaLoanType>;
  readonly loan_purposes?: HmdaFilterList<HmdaLoanPurpose>;
  readonly lien_statuses?: HmdaFilterList<HmdaLienStatus>;
  readonly construction_methods?: HmdaFilterList<HmdaConstructionMethod>;
  readonly sexes?: HmdaFilterList<HmdaSex>;
  readonly races?: HmdaFilterList<HmdaRace>;
  readonly ageapplicant?: HmdaFilterList<HmdaApplicantAge>;
  readonly ethnicities?: HmdaFilterList<HmdaEthnicity>;
  readonly total_units?: HmdaFilterList<HmdaTotalUnits>;
  readonly dwelling_categories?: HmdaFilterList<HmdaDwellingCategory>;
  readonly loan_products?: HmdaFilterList<HmdaLoanProduct>;
}

export interface HmdaFilterSet extends HmdaGeographyFilters, HmdaDimensionFilters {}
export interface HmdaQuery extends HmdaYearFilter, HmdaFilterSet {}
export interface HmdaNationwideQuery extends HmdaYearFilter, HmdaDimensionFilters {}
export interface HmdaCountQuery extends HmdaYearFilter, Omit<HmdaGeographyFilters, "leis"> {}
export interface HmdaFilerQuery extends HmdaYearFilter, Omit<HmdaGeographyFilters, "leis"> {}

export function hmdaCountUrl(query: HmdaCountQuery): string {
  return hmdaUrl("count", query);
}

export function hmdaAggregationsUrl(query: HmdaQuery): string {
  return hmdaUrl("aggregations", query);
}

export function hmdaNationwideAggregationsUrl(query: HmdaNationwideQuery): string {
  return hmdaUrl("nationwide/aggregations", query);
}

export function hmdaFilersUrl(query: HmdaFilerQuery): string {
  return hmdaUrl("filers", query);
}

export function hmdaCsvUrl(query: HmdaQuery): string {
  return hmdaUrl("csv", query);
}

export function hmdaPipeUrl(query: HmdaQuery): string {
  return hmdaUrl("pipe", query);
}

export function hmdaNationwideCsvUrl(query: HmdaNationwideQuery): string {
  return hmdaUrl("nationwide/csv", query);
}

export function hmdaNationwidePipeUrl(query: HmdaNationwideQuery): string {
  return hmdaUrl("nationwide/pipe", query);
}

function hmdaUrl(path: string, query: HmdaYearFilter & Partial<HmdaFilterSet>): string {
  for (const key of Object.keys(query)) {
    if (!Object.hasOwn(HMDA_QUERY_PARAMETERS, key)) {
      throw new RangeError(`Unknown HMDA query parameter ${JSON.stringify(key)}`);
    }
  }
  const url = new URL(`${HMDA_DATA_BROWSER_API_BASE_URL}/${path}`);
  setYears(url, query.years);
  setList(url, "states", query.states);
  setList(url, "counties", query.counties);
  setList(url, "msamds", query.msamds);
  setList(url, "leis", query.leis);
  setList(url, "actions_taken", query.actions_taken);
  setList(url, "loan_types", query.loan_types);
  setList(url, "loan_purposes", query.loan_purposes);
  setList(url, "lien_statuses", query.lien_statuses);
  setList(url, "construction_methods", query.construction_methods);
  setList(url, "sexes", query.sexes);
  setList(url, "races", query.races);
  setList(url, "ageapplicant", query.ageapplicant);
  setList(url, "ethnicities", query.ethnicities);
  setList(url, "total_units", query.total_units);
  setList(url, "dwelling_categories", query.dwelling_categories);
  setList(url, "loan_products", query.loan_products);
  return url.toString();
}

function setYears(url: URL, years: HmdaFilterList<HmdaYear> | undefined): void {
  const values: readonly unknown[] =
    years === undefined ? [] : Array.isArray(years) ? years : [years];
  const value = values.map(String).join(",").trim();
  const entries = value.split(",").map((entry) => entry.trim());
  if (value === "" || entries.some((entry) => !/^\d{4}$/.test(entry) || Number(entry) < 2018)) {
    throw new RangeError("HMDA queries require at least one data year of 2018 or later");
  }
  url.searchParams.set("years", entries.join(","));
}

function setList<T>(url: URL, key: string, value: HmdaFilterList<T> | undefined): void {
  if (value === undefined) return;
  const values: readonly unknown[] = Array.isArray(value) ? value : [value];
  const encoded = values.map(String).join(",");
  if (encoded !== "") url.searchParams.set(key, encoded);
}

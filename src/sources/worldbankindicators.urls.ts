export interface WorldBankIndicatorDefinition {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
}

/** Curated aliases for frequently used World Bank development indicators. */
export const WORLD_BANK_INDICATORS = {
  inflation: {
    code: "FP.CPI.TOTL.ZG",
    name: "Inflation, consumer prices",
    unit: "percent",
  },
  unemployment: {
    code: "SL.UEM.TOTL.ZS",
    name: "Unemployment, total",
    unit: "percent of labor force",
  },
  "gdp-growth": {
    code: "NY.GDP.MKTP.KD.ZG",
    name: "GDP growth",
    unit: "percent",
  },
  "extreme-poverty": {
    code: "SI.POV.DDAY",
    name: "Poverty headcount at $2.15/day",
    unit: "percent of population",
  },
} as const satisfies Record<string, WorldBankIndicatorDefinition>;

export type WorldBankIndicatorAlias = keyof typeof WORLD_BANK_INDICATORS;

/**
 * Codes classified as aggregates by the World Bank country catalog. Consumers
 * wanting sovereign-only comparisons must filter rows where `isAggregate` is true.
 */
export const WORLD_BANK_AGGREGATE_CODES: ReadonlySet<string> = new Set([
  "AFE",
  "AFR",
  "AFW",
  "ARB",
  "BEA",
  "BEC",
  "BHI",
  "BLA",
  "BMN",
  "BSS",
  "CAA",
  "CEA",
  "CEB",
  "CEU",
  "CLA",
  "CME",
  "CSA",
  "CSS",
  "DEA",
  "DEC",
  "DLA",
  "DMN",
  "DNS",
  "DSA",
  "DSF",
  "DSS",
  "EAP",
  "EAR",
  "EAS",
  "ECA",
  "ECS",
  "EMU",
  "EUU",
  "FXS",
  "HIC",
  "HPC",
  "IBB",
  "IBD",
  "IBT",
  "IDA",
  "IDB",
  "IDX",
  "INX",
  "LAC",
  "LCN",
  "LDC",
  "LIC",
  "LMC",
  "LMY",
  "LTE",
  "MDE",
  "MEA",
  "MIC",
  "MNA",
  "NAC",
  "NAF",
  "NRS",
  "NXS",
  "OED",
  "OSS",
  "PRE",
  "PSS",
  "PST",
  "RRS",
  "SAS",
  "SSA",
  "SSF",
  "SST",
  "SXZ",
  "TEA",
  "TEC",
  "TLA",
  "TMN",
  "TSA",
  "TSS",
  "UMC",
  "WLD",
  "XZN",
]);

const WORLD_BANK_INDICATORS_BASE_URL = "https://api.worldbank.org";

/** Builds the latest non-empty country observation query for an alias or raw indicator code. */
export function worldBankIndicatorUrl(indicator: string): string {
  const code = resolveWorldBankIndicatorCode(indicator);
  const url = new URL(
    `/v2/country/all/indicator/${encodeURIComponent(code)}`,
    WORLD_BANK_INDICATORS_BASE_URL,
  );
  url.searchParams.set("format", "json");
  url.searchParams.set("per_page", "400");
  url.searchParams.set("mrnev", "1");
  return url.toString();
}

function resolveWorldBankIndicatorCode(indicator: string): string {
  const candidate = indicator.trim();
  if (candidate.length === 0) {
    throw new RangeError("World Bank indicator must not be empty");
  }
  if (isWorldBankIndicatorAlias(candidate)) {
    return WORLD_BANK_INDICATORS[candidate].code;
  }
  return candidate;
}

/** Narrows a caller-supplied string to a known alias, so raw indicator codes pass through untouched. */
export function isWorldBankIndicatorAlias(value: string): value is WorldBankIndicatorAlias {
  return Object.hasOwn(WORLD_BANK_INDICATORS, value);
}

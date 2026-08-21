import { normalizeLimit } from "../options.js";

export const UNHCR_POPULATION_API_URL = "https://api.unhcr.org/population/v1/population/";
export const UNHCR_POPULATION_DEFAULT_LIMIT = 1000;

export interface UnhcrPopulationUrlOptions {
  readonly limit?: number;
}

/** Builds an annual country-of-origin displacement query. */
export function unhcrPopulationUrl(year: number, options: UnhcrPopulationUrlOptions = {}): string {
  if (!Number.isSafeInteger(year) || year < 1951 || year > 9999) {
    throw new RangeError("UNHCR year must be an integer from 1951 through 9999");
  }
  const limit = normalizeLimit(options.limit) ?? UNHCR_POPULATION_DEFAULT_LIMIT;
  const url = new URL(UNHCR_POPULATION_API_URL);
  url.searchParams.set("yearFrom", String(year));
  url.searchParams.set("yearTo", String(year));
  url.searchParams.set("coo_all", "true");
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

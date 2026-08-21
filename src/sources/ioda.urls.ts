export const IODA_PROVIDER = "ioda-outages";
export const IODA_DATASET = "country-outages";
export const IODA_OUTAGES_BASE_URL = "https://api.ioda.inetintel.cc.gatech.edu/v2/outages/summary";
export const IODA_OUTAGES_LIMIT = 20;

export interface IodaOutagesUrlOptions {
  readonly fromUnixSeconds: number;
  readonly untilUnixSeconds: number;
}

/** Builds the IODA country-outage query. Both bounds are UNIX seconds. */
export function iodaOutagesUrl(options: IodaOutagesUrlOptions): string {
  const { fromUnixSeconds, untilUnixSeconds } = options;
  if (
    !Number.isSafeInteger(fromUnixSeconds) ||
    !Number.isSafeInteger(untilUnixSeconds) ||
    fromUnixSeconds < 0 ||
    untilUnixSeconds < fromUnixSeconds
  ) {
    throw new RangeError("IODA outage bounds must be ordered non-negative UNIX seconds");
  }

  const url = new URL(IODA_OUTAGES_BASE_URL);
  url.searchParams.set("entityType", "country");
  url.searchParams.set("from", String(fromUnixSeconds));
  url.searchParams.set("until", String(untilUnixSeconds));
  url.searchParams.set("limit", String(IODA_OUTAGES_LIMIT));
  return url.toString();
}

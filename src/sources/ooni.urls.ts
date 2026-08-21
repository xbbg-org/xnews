export const OONI_PROVIDER = "ooni-censorship";
export const OONI_DATASET = "anomaly-aggregation";
export const OONI_AGGREGATION_BASE_URL = "https://api.ooni.org/api/v1/aggregation";
export const OONI_DEFAULT_LOOKBACK_DAYS = 14;

/** Builds the country-axis OONI anomaly aggregation query. */
export function ooniAggregationUrl(sinceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    throw new RangeError("OONI since date must be a canonical ISO date");
  }
  const parsed = new Date(`${sinceDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== sinceDate) {
    throw new RangeError("OONI since date must be a real ISO date");
  }

  const url = new URL(OONI_AGGREGATION_BASE_URL);
  url.searchParams.set("since", sinceDate);
  url.searchParams.set("axis_x", "probe_cc");
  url.searchParams.set("anomaly", "true");
  return url.toString();
}

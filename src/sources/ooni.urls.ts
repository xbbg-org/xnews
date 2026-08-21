export const OONI_PROVIDER = "ooni-censorship";
export const OONI_DATASET = "anomaly-aggregation";
export const OONI_AGGREGATION_BASE_URL = "https://api.ooni.org/api/v1/aggregation";
export const OONI_DEFAULT_LOOKBACK_DAYS = 14;

/** Builds the bounded country-axis OONI anomaly aggregation query. */
export function ooniAggregationUrl(sinceDate: string, untilDate?: string): string {
  requireIsoDate(sinceDate, "since");
  if (untilDate !== undefined) requireIsoDate(untilDate, "until");

  const url = new URL(OONI_AGGREGATION_BASE_URL);
  url.searchParams.set("since", sinceDate);
  if (untilDate !== undefined) url.searchParams.set("until", untilDate);
  url.searchParams.set("axis_x", "probe_cc");
  url.searchParams.set("anomaly", "true");
  return url.toString();
}

function requireIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`OONI ${label} date must be a canonical ISO date`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`OONI ${label} date must be a real ISO date`);
  }
}

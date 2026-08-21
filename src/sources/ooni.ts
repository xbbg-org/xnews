import { fetchText } from "../http.js";
import { numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeDateWindow } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource } from "../types.js";
import {
  OONI_AGGREGATION_BASE_URL,
  OONI_DATASET,
  OONI_DEFAULT_LOOKBACK_DAYS,
  OONI_PROVIDER,
  ooniAggregationUrl,
} from "./ooni.urls.js";

const OONI_SHAPE_ERROR = "unexpected OONI aggregation response shape";
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

export {
  OONI_AGGREGATION_BASE_URL,
  OONI_DATASET,
  OONI_DEFAULT_LOOKBACK_DAYS,
  OONI_PROVIDER,
  ooniAggregationUrl,
} from "./ooni.urls.js";

export interface OoniCensorshipRow {
  readonly probeCountryCode: string;
  readonly anomalyCount?: number;
  readonly confirmedCount?: number;
  readonly failureCount?: number;
  readonly measurementCount?: number;
  readonly okCount?: number;
  /** Absent when the measurement count is zero or either input count is missing. */
  readonly anomalyRate?: number;
}

interface OoniRequest {
  readonly url: string;
  readonly asOf: string;
}

/** Fetches OONI anomaly aggregates by probe country. */
export async function fetchOoniCensorship(
  options: DataFetchOptions = {},
): Promise<OoniCensorshipRow[]> {
  const request = resolveOoniRequest(options);
  return parseOoniCensorship(await fetchText(request.url, options));
}

/** Parses OONI's aggregation response. Pure and network-free. */
export function parseOoniCensorship(body: string): OoniCensorshipRow[] {
  const payload = parseJsonRecord(body, "OONI");
  const result = payload["result"];
  if (!Array.isArray(result)) throw new Error(OONI_SHAPE_ERROR);

  const records = recordArray(result);
  const rows = records.flatMap((record) => {
    const probeCountryCode = stringField(record, "probe_cc")?.trim();
    if (!probeCountryCode) return [];

    const anomalyCount = numberField(record, "anomaly_count");
    const confirmedCount = numberField(record, "confirmed_count");
    const failureCount = numberField(record, "failure_count");
    const measurementCount = numberField(record, "measurement_count");
    const okCount = numberField(record, "ok_count");
    const anomalyRate =
      anomalyCount !== undefined && measurementCount !== undefined && measurementCount > 0
        ? anomalyCount / measurementCount
        : undefined;
    return [
      {
        probeCountryCode: probeCountryCode.toUpperCase(),
        ...(anomalyCount === undefined ? {} : { anomalyCount }),
        ...(confirmedCount === undefined ? {} : { confirmedCount }),
        ...(failureCount === undefined ? {} : { failureCount }),
        ...(measurementCount === undefined ? {} : { measurementCount }),
        ...(okCount === undefined ? {} : { okCount }),
        ...(anomalyRate === undefined ? {} : { anomalyRate }),
      },
    ];
  });
  if (result.length > 0 && rows.length === 0) throw new Error(OONI_SHAPE_ERROR);
  return rows;
}

/** Binds OONI country anomaly aggregates to the shared data lane. */
export function ooniDataSource(options: DataFetchOptions = {}): DataSource<OoniCensorshipRow> {
  const merged = (fetchOptions: DataFetchOptions): DataFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: OONI_PROVIDER,
    dataset: OONI_DATASET,
    requestUrls: (fetchOptions = {}) => [resolveOoniRequest(merged(fetchOptions)).url],
    fetchRelease: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const request = resolveOoniRequest(combined);
      const rows = parseOoniCensorship(await fetchText(request.url, combined));
      if (rows.length === 0) return undefined;
      return {
        provider: OONI_PROVIDER,
        dataset: OONI_DATASET,
        asOf: request.asOf,
        url: OONI_AGGREGATION_BASE_URL,
        rows,
      } satisfies DataRelease<OoniCensorshipRow>;
    },
  };
}

function resolveOoniRequest(options: DataFetchOptions, nowMs = Date.now()): OoniRequest {
  // `since` is optional here, and exactOptionalPropertyTypes forbids passing
  // an explicit `undefined` through to the window normalizer.
  const window = normalizeDateWindow(options.since === undefined ? {} : { since: options.since });
  const sinceMs = window.sinceMs ?? nowMs - OONI_DEFAULT_LOOKBACK_DAYS * ONE_DAY_MS;
  const asOf = new Date(sinceMs).toISOString().slice(0, 10);
  return { url: ooniAggregationUrl(asOf), asOf };
}

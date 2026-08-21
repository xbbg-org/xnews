import { fetchText } from "../http.js";
import { isRecord, numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import { normalizeDateWindow } from "../options.js";
import type { DataFetchOptions, DataRelease, DataSource } from "../types.js";
import { IODA_DATASET, IODA_OUTAGES_BASE_URL, IODA_PROVIDER, iodaOutagesUrl } from "./ioda.urls.js";
import type { IodaOutagesUrlOptions } from "./ioda.urls.js";

const IODA_SHAPE_ERROR = "unexpected IODA outage response shape";
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

export {
  IODA_DATASET,
  IODA_OUTAGES_BASE_URL,
  IODA_OUTAGES_LIMIT,
  IODA_PROVIDER,
  iodaOutagesUrl,
} from "./ioda.urls.js";
export type { IodaOutagesUrlOptions } from "./ioda.urls.js";

export interface IodaOutageRow {
  readonly countryCode: string;
  readonly countryName: string;
  /** Absent when IODA does not publish a finite score for the country. */
  readonly overallScore?: number;
}

interface IodaRequest {
  readonly url: string;
  readonly asOf: string;
}

/** Fetches country-level IODA outage summaries for the requested window. */
export async function fetchIodaOutages(options: DataFetchOptions = {}): Promise<IodaOutageRow[]> {
  const request = resolveIodaRequest(options);
  return parseIodaOutages(await fetchText(request.url, options));
}

/** Parses IODA's outage summary response. Pure and network-free. */
export function parseIodaOutages(body: string): IodaOutageRow[] {
  const payload = parseJsonRecord(body, "IODA");
  const data = payload["data"];
  if (!Array.isArray(data)) throw new Error(IODA_SHAPE_ERROR);

  const records = recordArray(data);
  const rows = records.flatMap((record) => {
    const entity = record["entity"];
    if (!isRecord(entity)) return [];
    const countryCode = stringField(entity, "code")?.trim();
    const countryName = stringField(entity, "name")?.trim();
    if (!countryCode || !countryName) return [];
    const overallScore = numberField(record, "overall_score");
    return [
      {
        countryCode: countryCode.toUpperCase(),
        countryName,
        ...(overallScore === undefined ? {} : { overallScore }),
      },
    ];
  });
  if (data.length > 0 && rows.length === 0) throw new Error(IODA_SHAPE_ERROR);
  return rows;
}

/** Binds IODA country outages to the shared data lane. */
export function iodaDataSource(options: DataFetchOptions = {}): DataSource<IodaOutageRow> {
  const merged = (fetchOptions: DataFetchOptions): DataFetchOptions => ({
    ...options,
    ...fetchOptions,
  });
  return {
    provider: IODA_PROVIDER,
    dataset: IODA_DATASET,
    requestUrls: (fetchOptions = {}) => [resolveIodaRequest(merged(fetchOptions)).url],
    fetchRelease: async (fetchOptions = {}) => {
      const combined = merged(fetchOptions);
      const request = resolveIodaRequest(combined);
      const rows = parseIodaOutages(await fetchText(request.url, combined));
      if (rows.length === 0) return undefined;
      return {
        provider: IODA_PROVIDER,
        dataset: IODA_DATASET,
        asOf: request.asOf,
        url: IODA_OUTAGES_BASE_URL,
        rows,
      } satisfies DataRelease<IodaOutageRow>;
    },
  };
}

function resolveIodaRequest(options: DataFetchOptions, nowMs = Date.now()): IodaRequest {
  const window = normalizeDateWindow(options);
  const untilMs = window.untilMs ?? nowMs;
  const sinceMs = window.sinceMs ?? untilMs - ONE_DAY_MS;
  if (sinceMs > untilMs) throw new RangeError("since must be before or equal to until");

  const urlOptions: IodaOutagesUrlOptions = {
    fromUnixSeconds: Math.floor(sinceMs / 1_000),
    untilUnixSeconds: Math.floor(untilMs / 1_000),
  };
  return {
    url: iodaOutagesUrl(urlOptions),
    asOf: new Date(untilMs).toISOString().slice(0, 10),
  };
}

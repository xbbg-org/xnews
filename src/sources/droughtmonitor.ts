import { fetchJsonText } from "../http.js";
import { recordArray, stringField } from "../json.js";
import { DROUGHT_MONITOR_BASE_URL, droughtMonitorUrl } from "./droughtmonitor.urls.js";
import type { DataRelease, DataSource, SourceFetchOptions } from "../types.js";
import type { DroughtMonitorUrlOptions } from "./droughtmonitor.urls.js";

const DROUGHT_MONITOR_SHAPE_ERROR = "unexpected US Drought Monitor response shape";

export {
  DROUGHT_MONITOR_BASE_URL,
  droughtMonitorApiDate,
  droughtMonitorUrl,
} from "./droughtmonitor.urls.js";
export type { DroughtMonitorUrlOptions } from "./droughtmonitor.urls.js";

export interface DroughtMonitorRow {
  readonly mapDate: string;
  /** USDM's area label for the row, e.g. `CONUS`. */
  readonly areaOfInterest?: string;
  readonly none?: number;
  readonly d0?: number;
  readonly d1?: number;
  readonly d2?: number;
  readonly d3?: number;
  readonly d4?: number;
}

export interface DroughtMonitorFetchOptions extends SourceFetchOptions {
  readonly startDate?: string | Date;
  readonly endDate?: string | Date;
  /** Controls the default 21-day request window without changing the system clock. */
  readonly now?: Date;
}

/**
 * Parses the JSON representation selected by the API's `Accept` header.
 *
 * The JSON surface returns camelCase keys (`mapDate`, `d0`) and an ISO
 * datetime, while the XML surface returns PascalCase (`MapDate`, `D0`) and a
 * compact `YYYYMMDD`. Both spellings are read so a negotiated representation
 * change degrades to nothing worse than the fields it actually renamed.
 */
export function parseDroughtMonitor(body: string): DroughtMonitorRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(DROUGHT_MONITOR_SHAPE_ERROR);
  }
  if (!Array.isArray(parsed)) throw new Error(DROUGHT_MONITOR_SHAPE_ERROR);

  const records = recordArray(parsed);
  if (parsed.length > 0 && records.length === 0) {
    throw new Error(DROUGHT_MONITOR_SHAPE_ERROR);
  }
  const rows: DroughtMonitorRow[] = [];
  for (const record of records) {
    const mapDate = droughtDate(firstField(record, "mapDate", "MapDate"));
    if (mapDate === undefined) continue;
    const areaOfInterest = stringField(record, "areaOfInterest");
    const none = numericField(firstField(record, "none", "None"));
    const d0 = numericField(firstField(record, "d0", "D0"));
    const d1 = numericField(firstField(record, "d1", "D1"));
    const d2 = numericField(firstField(record, "d2", "D2"));
    const d3 = numericField(firstField(record, "d3", "D3"));
    const d4 = numericField(firstField(record, "d4", "D4"));
    rows.push({
      mapDate,
      ...(areaOfInterest ? { areaOfInterest } : {}),
      ...(none === undefined ? {} : { none }),
      ...(d0 === undefined ? {} : { d0 }),
      ...(d1 === undefined ? {} : { d1 }),
      ...(d2 === undefined ? {} : { d2 }),
      ...(d3 === undefined ? {} : { d3 }),
      ...(d4 === undefined ? {} : { d4 }),
    });
  }
  if (records.length > 0 && rows.length === 0) {
    throw new Error(DROUGHT_MONITOR_SHAPE_ERROR);
  }
  return rows;
}

export async function fetchDroughtMonitor(
  options: DroughtMonitorFetchOptions = {},
): Promise<DroughtMonitorRow[]> {
  const range = droughtDateRange(options);
  return parseDroughtMonitor(await fetchJsonText(droughtMonitorUrl(range), options));
}

export function droughtMonitorDataSource(
  options: DroughtMonitorFetchOptions = {},
): DataSource<DroughtMonitorRow> {
  return {
    provider: "us-drought-monitor",
    dataset: "area-percent",
    requestUrls: () => [droughtMonitorUrl(droughtDateRange(options))],
    fetchRelease: async (
      fetchOptions = {},
    ): Promise<DataRelease<DroughtMonitorRow> | undefined> => {
      const rows = await fetchDroughtMonitor({ ...options, ...fetchOptions });
      let asOf: string | undefined;
      for (const row of rows) {
        if (asOf === undefined || row.mapDate > asOf) asOf = row.mapDate;
      }
      if (asOf === undefined) return undefined;
      return {
        provider: "us-drought-monitor",
        dataset: "area-percent",
        asOf,
        url: DROUGHT_MONITOR_BASE_URL,
        rows,
      };
    },
  };
}

function droughtDateRange(options: DroughtMonitorFetchOptions): DroughtMonitorUrlOptions {
  const now = options.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be a valid date");
  const endDate = options.endDate ?? now;
  const startDate = options.startDate ?? new Date(now.getTime() - 21 * 86_400_000);
  return { startDate, endDate };
}

/**
 * Accepts USDM's two date renderings: the JSON surface's ISO datetime
 * (`2026-08-18T00:00:00`) and the XML surface's compact `YYYYMMDD`.
 */
function droughtDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const isoDate = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}`
    : /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0];
  if (isoDate === undefined) return undefined;
  const instant = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(instant.getTime())) return undefined;
  return instant.toISOString().slice(0, 10) === isoDate ? isoDate : undefined;
}

function firstField(record: Record<string, unknown>, ...keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function numericField(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

import { fetchText } from "../http.js";
import { numberField, parseJsonRecord, recordArray, stringField } from "../json.js";
import type { DataFetchOptions, DataSource } from "../types.js";
import { fredSeriesObservationsUrl, fredSeriesSearchUrl, fredSeriesUrl } from "./fred.urls.js";
import type {
  FredDataSourceOptions,
  FredObservationsOptions,
  FredSeriesOptions,
  FredSeriesSearchOptions,
  FredSortOrder,
  FredUnits,
} from "./fred.urls.js";

export { fredSeriesObservationsUrl, fredSeriesSearchUrl, fredSeriesUrl } from "./fred.urls.js";
export type {
  FredAggregationMethod,
  FredDate,
  FredFrequency,
  FredDataSourceOptions,
  FredObservationsOptions,
  FredRequestOptions,
  FredSeriesFilterVariable,
  FredSeriesOptions,
  FredSeriesSearchOptions,
  FredSeriesSearchOrderBy,
  FredSeriesSearchType,
  FredSortOrder,
  FredUnits,
} from "./fred.urls.js";

export interface FredPage<T> {
  readonly items: readonly T[];
  readonly realtimeStart?: string;
  readonly realtimeEnd?: string;
  readonly observationStart?: string;
  readonly observationEnd?: string;
  readonly units?: FredUnits;
  readonly outputType?: number;
  readonly orderBy?: string;
  readonly sortOrder?: FredSortOrder;
  readonly count?: number;
  readonly offset?: number;
  readonly limit?: number;
}

export interface FredSeries {
  readonly id: string;
  readonly realtimeStart: string;
  readonly realtimeEnd: string;
  readonly title: string;
  readonly observationStart: string;
  readonly observationEnd: string;
  readonly frequency: string;
  readonly frequencyShort: string;
  readonly units: string;
  readonly unitsShort: string;
  readonly seasonalAdjustment: string;
  readonly seasonalAdjustmentShort: string;
  readonly lastUpdated: string;
  readonly popularity: number;
  readonly groupPopularity?: number;
  readonly notes?: string;
}

export interface FredObservation {
  readonly realtimeStart: string;
  readonly realtimeEnd: string;
  readonly date: string;
  readonly value: number | null;
  readonly rawValue: string;
}

export function parseFredSeriesSearch(body: string): FredPage<FredSeries> {
  const payload = parseJsonRecord(body, "FRED series search");
  const sourceItems = payload["seriess"];
  if (!Array.isArray(sourceItems)) {
    throw new Error("unexpected FRED series search response shape");
  }

  const items: FredSeries[] = [];
  for (const record of recordArray(sourceItems)) {
    const series = parseSeriesRecord(record);
    if (series !== undefined) items.push(series);
  }
  if (sourceItems.length > 0 && items.length === 0) {
    throw new Error("FRED series search response contained no valid records");
  }
  return fredPage(payload, items);
}

export function parseFredSeries(body: string): FredSeries | undefined {
  const payload = parseJsonRecord(body, "FRED series");
  const sourceItems = payload["seriess"];
  if (!Array.isArray(sourceItems)) {
    throw new Error("unexpected FRED series response shape");
  }

  for (const record of recordArray(sourceItems)) {
    const series = parseSeriesRecord(record);
    if (series !== undefined) return series;
  }
  if (sourceItems.length > 0) {
    throw new Error("FRED series response contained no valid records");
  }
  return undefined;
}

export function parseFredObservations(body: string): FredPage<FredObservation> {
  const payload = parseJsonRecord(body, "FRED observations");
  const sourceItems = payload["observations"];
  if (!Array.isArray(sourceItems)) {
    throw new Error("unexpected FRED observations response shape");
  }

  const items: FredObservation[] = [];
  for (const record of recordArray(sourceItems)) {
    const realtimeStart = dateField(record, "realtime_start");
    const realtimeEnd = dateField(record, "realtime_end");
    const date = dateField(record, "date");
    const rawValue = stringField(record, "value");
    if (!realtimeStart || !realtimeEnd || !date || rawValue === undefined) continue;

    let value: number | null;
    if (rawValue === ".") {
      value = null;
    } else {
      if (!rawValue.trim()) continue;
      value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
    }
    items.push({ realtimeStart, realtimeEnd, date, value, rawValue });
  }
  if (sourceItems.length > 0 && items.length === 0) {
    throw new Error("FRED observations response contained no valid records");
  }
  return fredPage(payload, items);
}

export async function searchFredSeries(
  searchText: string,
  options: FredSeriesSearchOptions,
): Promise<FredPage<FredSeries>> {
  const url = fredSeriesSearchUrl(searchText, options);
  if (options.limit === 0) {
    return { items: [], count: 0, offset: options.offset ?? 0, limit: 0 };
  }
  return parseFredSeriesSearch(await fetchText(url, options));
}

export async function fetchFredSeries(
  seriesId: string,
  options: FredSeriesOptions,
): Promise<FredSeries | undefined> {
  const url = fredSeriesUrl(seriesId, options);
  return parseFredSeries(await fetchText(url, options));
}

export async function fetchFredObservations(
  seriesId: string,
  options: FredObservationsOptions,
): Promise<FredPage<FredObservation>> {
  const url = fredSeriesObservationsUrl(seriesId, options);
  if (options.limit === 0) {
    return { items: [], count: 0, offset: options.offset ?? 0, limit: 0 };
  }
  return parseFredObservations(await fetchText(url, options));
}

export function fredDataSource(
  seriesId: string,
  options: FredDataSourceOptions,
): DataSource<FredObservation> {
  const dataset = seriesId.trim().toUpperCase();
  const merged = (fetchOptions: DataFetchOptions): FredObservationsOptions => ({
    ...options,
    ...(fetchOptions.fetch !== undefined ? { fetch: fetchOptions.fetch } : {}),
    ...(fetchOptions.signal !== undefined ? { signal: fetchOptions.signal } : {}),
    ...(fetchOptions.timeoutMs !== undefined ? { timeoutMs: fetchOptions.timeoutMs } : {}),
    ...(fetchOptions.maxResponseBytes !== undefined
      ? { maxResponseBytes: fetchOptions.maxResponseBytes }
      : {}),
    ...(fetchOptions.redirect !== undefined ? { redirect: fetchOptions.redirect } : {}),
    ...(fetchOptions.userAgent !== undefined ? { userAgent: fetchOptions.userAgent } : {}),
  });

  return {
    provider: "fred",
    dataset,
    requestUrls: (fetchOptions = {}) => {
      const url = new URL(fredSeriesObservationsUrl(dataset, merged(fetchOptions)));
      url.searchParams.set("api_key", "<redacted>");
      return [url.toString()];
    },
    fetchRelease: async (fetchOptions = {}) => {
      const observations = await fetchFredObservations(dataset, merged(fetchOptions));
      const first = observations.items[0];
      if (first === undefined) return undefined;

      let asOf = first.date;
      for (let index = 1; index < observations.items.length; index += 1) {
        const date = observations.items[index]?.date;
        if (date !== undefined && date > asOf) asOf = date;
      }
      if (fetchOptions.ifNewerThan !== undefined && fetchOptions.ifNewerThan >= asOf) {
        return undefined;
      }

      return {
        provider: "fred",
        dataset,
        asOf,
        url: `https://fred.stlouisfed.org/series/${encodeURIComponent(dataset)}`,
        rows: observations.items,
      };
    },
  };
}

function parseSeriesRecord(record: Record<string, unknown>): FredSeries | undefined {
  const id = stringField(record, "id")?.trim();
  const realtimeStart = dateField(record, "realtime_start");
  const realtimeEnd = dateField(record, "realtime_end");
  const title = stringField(record, "title")?.trim();
  const observationStart = dateField(record, "observation_start");
  const observationEnd = dateField(record, "observation_end");
  const frequency = stringField(record, "frequency");
  const frequencyShort = stringField(record, "frequency_short");
  const units = stringField(record, "units");
  const unitsShort = stringField(record, "units_short");
  const seasonalAdjustment = stringField(record, "seasonal_adjustment");
  const seasonalAdjustmentShort = stringField(record, "seasonal_adjustment_short");
  const lastUpdated = stringField(record, "last_updated");
  const popularity = numberField(record, "popularity");
  if (
    !id ||
    !realtimeStart ||
    !realtimeEnd ||
    !title ||
    !observationStart ||
    !observationEnd ||
    frequency === undefined ||
    frequencyShort === undefined ||
    units === undefined ||
    unitsShort === undefined ||
    seasonalAdjustment === undefined ||
    seasonalAdjustmentShort === undefined ||
    lastUpdated === undefined ||
    popularity === undefined
  ) {
    return undefined;
  }

  const groupPopularity = numberField(record, "group_popularity");
  const notes = stringField(record, "notes");
  return {
    id,
    realtimeStart,
    realtimeEnd,
    title,
    observationStart,
    observationEnd,
    frequency,
    frequencyShort,
    units,
    unitsShort,
    seasonalAdjustment,
    seasonalAdjustmentShort,
    lastUpdated,
    popularity,
    ...(groupPopularity !== undefined ? { groupPopularity } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

function fredPage<T>(payload: Record<string, unknown>, items: readonly T[]): FredPage<T> {
  const realtimeStart = dateField(payload, "realtime_start");
  const realtimeEnd = dateField(payload, "realtime_end");
  const observationStart = dateField(payload, "observation_start");
  const observationEnd = dateField(payload, "observation_end");
  const units = fredUnitsField(payload, "units");
  const outputType = numberField(payload, "output_type");
  const orderBy = stringField(payload, "order_by");
  const sortOrder = sortOrderField(payload, "sort_order");
  const count = numberField(payload, "count");
  const offset = numberField(payload, "offset");
  const limit = numberField(payload, "limit");
  return {
    items,
    ...(realtimeStart !== undefined ? { realtimeStart } : {}),
    ...(realtimeEnd !== undefined ? { realtimeEnd } : {}),
    ...(observationStart !== undefined ? { observationStart } : {}),
    ...(observationEnd !== undefined ? { observationEnd } : {}),
    ...(units !== undefined ? { units } : {}),
    ...(outputType !== undefined ? { outputType } : {}),
    ...(orderBy !== undefined ? { orderBy } : {}),
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    ...(count !== undefined ? { count } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function dateField(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key);
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function sortOrderField(record: Record<string, unknown>, key: string): FredSortOrder | undefined {
  const value = stringField(record, key);
  return value === "asc" || value === "desc" ? value : undefined;
}

function fredUnitsField(record: Record<string, unknown>, key: string): FredUnits | undefined {
  const value = stringField(record, key);
  switch (value) {
    case "lin":
    case "chg":
    case "ch1":
    case "pch":
    case "pc1":
    case "pca":
    case "cch":
    case "cca":
    case "log":
      return value;
    default:
      return undefined;
  }
}

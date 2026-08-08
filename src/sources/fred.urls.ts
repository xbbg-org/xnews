import { XnewsFetchError } from "../errors.js";
import type { SourceFetchOptions } from "../types.js";

const FRED_API_BASE = "https://api.stlouisfed.org/fred";

type FredTransportOptions = Pick<
  SourceFetchOptions,
  "fetch" | "signal" | "timeoutMs" | "maxResponseBytes" | "redirect" | "userAgent"
>;

export type FredSortOrder = "asc" | "desc";
export type FredDate = string | Date;
export type FredSeriesSearchType = "full_text" | "series_id";
export type FredSeriesSearchOrderBy =
  | "search_rank"
  | "series_id"
  | "title"
  | "units"
  | "frequency"
  | "seasonal_adjustment"
  | "realtime_start"
  | "realtime_end"
  | "last_updated"
  | "observation_start"
  | "observation_end"
  | "popularity"
  | "group_popularity";
export type FredSeriesFilterVariable = "frequency" | "units" | "seasonal_adjustment";
export type FredUnits = "lin" | "chg" | "ch1" | "pch" | "pc1" | "pca" | "cch" | "cca" | "log";
export type FredFrequency =
  | "d"
  | "w"
  | "bw"
  | "m"
  | "q"
  | "sa"
  | "a"
  | "wef"
  | "weth"
  | "wew"
  | "wetu"
  | "wem"
  | "wesu"
  | "wesa"
  | "bwew"
  | "bwem";
export type FredAggregationMethod = "avg" | "sum" | "eop";

export interface FredRequestOptions extends FredTransportOptions {
  readonly apiKey: string;
}

export interface FredSeriesSearchOptions extends FredRequestOptions {
  readonly searchType?: FredSeriesSearchType;
  readonly realtimeStart?: FredDate;
  readonly realtimeEnd?: FredDate;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: FredSeriesSearchOrderBy;
  readonly sortOrder?: FredSortOrder;
  readonly filterVariable?: FredSeriesFilterVariable;
  readonly filterValue?: string;
  readonly tagNames?: string | readonly string[];
  readonly excludeTagNames?: string | readonly string[];
}

export interface FredSeriesOptions extends FredRequestOptions {
  readonly realtimeStart?: FredDate;
  readonly realtimeEnd?: FredDate;
}

export interface FredObservationsOptions extends FredRequestOptions {
  readonly realtimeStart?: FredDate;
  readonly realtimeEnd?: FredDate;
  readonly limit?: number;
  readonly offset?: number;
  readonly sortOrder?: FredSortOrder;
  readonly observationStart?: FredDate;
  readonly observationEnd?: FredDate;
  readonly units?: FredUnits;
  readonly frequency?: FredFrequency;
  readonly aggregationMethod?: FredAggregationMethod;
  readonly vintageDates?: string | readonly FredDate[];
}

export type FredDataSourceOptions = FredObservationsOptions;

export function fredSeriesSearchUrl(searchText: string, options: FredSeriesSearchOptions): string {
  const url = fredApiUrl("series/search", options.apiKey);
  url.searchParams.set("search_text", searchText);
  url.searchParams.set("limit", String(options.limit ?? 8));
  url.searchParams.set("order_by", options.orderBy ?? "popularity");
  url.searchParams.set("sort_order", options.sortOrder ?? "desc");
  setString(url, "search_type", options.searchType);
  setDate(url, "realtime_start", options.realtimeStart);
  setDate(url, "realtime_end", options.realtimeEnd);
  setNumber(url, "offset", options.offset);
  setString(url, "filter_variable", options.filterVariable);
  setString(url, "filter_value", options.filterValue);
  setList(url, "tag_names", options.tagNames, ";");
  setList(url, "exclude_tag_names", options.excludeTagNames, ";");
  return url.toString();
}

export function fredSeriesUrl(seriesId: string, options: FredSeriesOptions): string {
  const url = fredApiUrl("series", options.apiKey);
  url.searchParams.set("series_id", seriesId);
  setDate(url, "realtime_start", options.realtimeStart);
  setDate(url, "realtime_end", options.realtimeEnd);
  return url.toString();
}

export function fredSeriesObservationsUrl(
  seriesId: string,
  options: FredObservationsOptions,
): string {
  const url = fredApiUrl("series/observations", options.apiKey);
  url.searchParams.set("series_id", seriesId);
  setDate(url, "realtime_start", options.realtimeStart);
  setDate(url, "realtime_end", options.realtimeEnd);
  setNumber(url, "limit", options.limit);
  setNumber(url, "offset", options.offset);
  setString(url, "sort_order", options.sortOrder);
  setDate(url, "observation_start", options.observationStart);
  setDate(url, "observation_end", options.observationEnd);
  setString(url, "units", options.units);
  setString(url, "frequency", options.frequency);
  setString(url, "aggregation_method", options.aggregationMethod);
  setDateList(url, "vintage_dates", options.vintageDates);
  return url.toString();
}

function fredApiUrl(path: string, apiKey: string): URL {
  const url = new URL(`${FRED_API_BASE}/${path}`);
  if (!apiKey.trim()) {
    throw new XnewsFetchError("config", "FRED requires a non-blank apiKey", { url: url.href });
  }
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("file_type", "json");
  return url;
}

function setString(url: URL, key: string, value: string | undefined): void {
  if (value !== undefined) url.searchParams.set(key, value);
}

function setDate(url: URL, key: string, value: FredDate | undefined): void {
  if (value === undefined) return;
  if (typeof value === "string") {
    url.searchParams.set(key, value);
    return;
  }
  if (Number.isNaN(value.getTime())) {
    throw new XnewsFetchError("config", `FRED ${key} must be a valid Date`, {
      url: url.href,
    });
  }
  url.searchParams.set(key, value.toISOString().slice(0, 10));
}

function setNumber(url: URL, key: string, value: number | undefined): void {
  if (value !== undefined) url.searchParams.set(key, String(value));
}

function setList(
  url: URL,
  key: string,
  value: string | readonly string[] | undefined,
  separator: string,
): void {
  if (value !== undefined) {
    url.searchParams.set(key, typeof value === "string" ? value : value.join(separator));
  }
}

function setDateList(url: URL, key: string, value: string | readonly FredDate[] | undefined): void {
  if (value === undefined) return;
  if (typeof value === "string") {
    url.searchParams.set(key, value);
    return;
  }
  const dates: string[] = [];
  for (const date of value) {
    if (typeof date === "string") {
      dates.push(date);
    } else {
      if (Number.isNaN(date.getTime())) {
        throw new XnewsFetchError("config", `FRED ${key} must contain only valid Dates`, {
          url: url.href,
        });
      }
      dates.push(date.toISOString().slice(0, 10));
    }
  }
  if (dates.length === 0) {
    throw new XnewsFetchError("config", `FRED ${key} must contain at least one date`, {
      url: url.href,
    });
  }
  url.searchParams.set(key, dates.join(","));
}

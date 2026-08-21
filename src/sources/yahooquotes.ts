import { fetchJsonText, XnewsFetchError } from "../http.js";
import { isRecord, numberField, parseJsonRecord, stringField } from "../json.js";
import { yahooChartUrl } from "./yahooquotes.urls.js";
import type { SourceFetchOptions } from "../types.js";
import type { YahooChartInterval, YahooChartRange } from "./yahooquotes.urls.js";

export { YAHOO_FUTURES_SYMBOLS, yahooChartUrl } from "./yahooquotes.urls.js";
export type {
  YahooChartHost,
  YahooChartInterval,
  YahooChartRange,
  YahooChartUrlOptions,
} from "./yahooquotes.urls.js";

const YAHOO_CHART_SHAPE_ERROR = "unexpected Yahoo Finance chart response shape";
const DEFAULT_INTERVAL: YahooChartInterval = "1d";
const DEFAULT_RANGE: YahooChartRange = "1mo";

export interface YahooChartFetchOptions extends SourceFetchOptions {
  readonly interval?: YahooChartInterval;
  readonly range?: YahooChartRange;
}

export interface YahooQuote {
  readonly symbol: string;
  readonly currency?: string;
  readonly exchangeName?: string;
  readonly price: number;
  readonly previousClose?: number;
  readonly change?: number;
  readonly changePercent?: number;
  readonly dayHigh?: number;
  readonly dayLow?: number;
  readonly volume?: number;
  readonly marketTime?: string;
}

export interface YahooBar {
  readonly timestamp: string;
  readonly open?: number;
  readonly high?: number;
  readonly low?: number;
  readonly close?: number;
  readonly volume?: number;
}

export interface YahooChartResult {
  readonly quote: YahooQuote | undefined;
  readonly bars: YahooBar[];
}

/** Fetches the latest usable quote observation for a Yahoo Finance symbol. */
export async function fetchYahooQuote(
  symbol: string,
  options: YahooChartFetchOptions = {},
): Promise<YahooQuote | undefined> {
  const body = await fetchYahooChartBody(symbol, options);
  return parseYahooChart(body, symbol).quote;
}

/** Fetches timestamped chart bars, retaining Yahoo's null-padded observations. */
export async function fetchYahooBars(
  symbol: string,
  options: YahooChartFetchOptions = {},
): Promise<YahooBar[]> {
  const body = await fetchYahooChartBody(symbol, options);
  return parseYahooChart(body, symbol).bars;
}

/** Parses one Yahoo Finance chart response into its quote and bar views. */
export function parseYahooChart(body: string, symbol: string): YahooChartResult {
  const payload = parseJsonRecord(body, "Yahoo Finance chart");
  const chart = payload["chart"];
  if (!isRecord(chart)) throw new Error(YAHOO_CHART_SHAPE_ERROR);

  const rawResult = chart["result"];
  if (rawResult === null) throw yahooChartShapeError(chart);
  if (!Array.isArray(rawResult)) throw new Error(YAHOO_CHART_SHAPE_ERROR);
  if (rawResult.length === 0) return { quote: undefined, bars: [] };

  const result = rawResult[0];
  if (!isRecord(result)) throw new Error(YAHOO_CHART_SHAPE_ERROR);
  const meta = result["meta"];
  const indicators = result["indicators"];
  if (!isRecord(meta) || !isRecord(indicators)) {
    throw new Error(YAHOO_CHART_SHAPE_ERROR);
  }

  const rawQuotes = indicators["quote"];
  if (!Array.isArray(rawQuotes)) throw new Error(YAHOO_CHART_SHAPE_ERROR);
  const quoteFields = rawQuotes[0];
  if (quoteFields !== undefined && !isRecord(quoteFields)) {
    throw new Error(YAHOO_CHART_SHAPE_ERROR);
  }

  const fields = quoteFields ?? {};
  const closes = numericArrayField(fields, "close");
  return {
    quote: parseYahooQuote(meta, closes, symbol),
    bars: parseYahooBars(result["timestamp"], fields),
  };
}

async function fetchYahooChartBody(
  symbol: string,
  options: YahooChartFetchOptions,
): Promise<string> {
  const interval = options.interval ?? DEFAULT_INTERVAL;
  const range = options.range ?? DEFAULT_RANGE;
  try {
    return await fetchJsonText(yahooChartUrl(symbol, { interval, range, host: "query1" }), options);
  } catch (error) {
    if (
      !(error instanceof XnewsFetchError) ||
      (error.code !== "network" && error.code !== "http_status" && error.code !== "timeout")
    ) {
      throw error;
    }
  }

  return fetchJsonText(yahooChartUrl(symbol, { interval, range, host: "query2" }), options);
}

function parseYahooQuote(
  meta: Record<string, unknown>,
  closes: readonly unknown[],
  symbol: string,
): YahooQuote | undefined {
  const price = lastFiniteNumber(closes) ?? numberField(meta, "regularMarketPrice");
  if (price === undefined) return undefined;

  const previousClose =
    numberField(meta, "chartPreviousClose") ?? numberField(meta, "previousClose");
  let change: number | undefined;
  let changePercent: number | undefined;
  if (previousClose !== undefined && previousClose !== 0) {
    const derivedChange = price - previousClose;
    const derivedPercent = (derivedChange / previousClose) * 100;
    if (Number.isFinite(derivedChange)) change = derivedChange;
    if (Number.isFinite(derivedPercent)) changePercent = derivedPercent;
  }
  const marketTime = epochSecondsToIso(numberField(meta, "regularMarketTime"));
  const currency = trimmedStringField(meta, "currency");
  const exchangeName = trimmedStringField(meta, "exchangeName");
  const dayHigh = numberField(meta, "regularMarketDayHigh");
  const dayLow = numberField(meta, "regularMarketDayLow");
  const volume = numberField(meta, "regularMarketVolume");

  return {
    symbol,
    ...(currency ? { currency } : {}),
    ...(exchangeName ? { exchangeName } : {}),
    price,
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(change !== undefined ? { change } : {}),
    ...(changePercent !== undefined ? { changePercent } : {}),
    ...(dayHigh !== undefined ? { dayHigh } : {}),
    ...(dayLow !== undefined ? { dayLow } : {}),
    ...(volume !== undefined ? { volume } : {}),
    ...(marketTime ? { marketTime } : {}),
  };
}

function parseYahooBars(timestamps: unknown, fields: Record<string, unknown>): YahooBar[] {
  if (!Array.isArray(timestamps)) return [];

  const opens = numericArrayField(fields, "open");
  const highs = numericArrayField(fields, "high");
  const lows = numericArrayField(fields, "low");
  const closes = numericArrayField(fields, "close");
  const volumes = numericArrayField(fields, "volume");
  const bars: YahooBar[] = [];

  for (let index = 0; index < timestamps.length; index++) {
    const timestamp = epochSecondsToIso(timestamps[index]);
    if (timestamp === undefined) continue;

    const open = finiteNumber(opens[index]);
    const high = finiteNumber(highs[index]);
    const low = finiteNumber(lows[index]);
    const close = finiteNumber(closes[index]);
    const volume = finiteNumber(volumes[index]);
    bars.push({
      timestamp,
      ...(open !== undefined ? { open } : {}),
      ...(high !== undefined ? { high } : {}),
      ...(low !== undefined ? { low } : {}),
      ...(close !== undefined ? { close } : {}),
      ...(volume !== undefined ? { volume } : {}),
    });
  }

  return bars;
}

function numericArrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function lastFiniteNumber(values: readonly unknown[]): number | undefined {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = finiteNumber(values[index]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function trimmedStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = stringField(record, key)?.trim();
  return value || undefined;
}

function epochSecondsToIso(value: unknown): string | undefined {
  const seconds = finiteNumber(value);
  if (seconds === undefined) return undefined;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function yahooChartShapeError(chart: Record<string, unknown>): Error {
  const responseError = chart["error"];
  if (!isRecord(responseError)) return new Error(YAHOO_CHART_SHAPE_ERROR);

  const code = trimmedStringField(responseError, "code");
  const description = trimmedStringField(responseError, "description");
  const detail = [code, description].filter((value) => value !== undefined).join(": ");
  return new Error(detail ? `${YAHOO_CHART_SHAPE_ERROR}: ${detail}` : YAHOO_CHART_SHAPE_ERROR);
}

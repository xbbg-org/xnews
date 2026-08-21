export type YahooChartHost = "query1" | "query2";

export type YahooChartInterval =
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "90m"
  | "1h"
  | "1d"
  | "5d"
  | "1wk"
  | "1mo"
  | "3mo";

export type YahooChartRange =
  | "1d"
  | "5d"
  | "1mo"
  | "3mo"
  | "6mo"
  | "1y"
  | "2y"
  | "5y"
  | "10y"
  | "ytd"
  | "max";

export interface YahooChartUrlOptions {
  readonly interval: YahooChartInterval;
  readonly range: YahooChartRange;
  readonly host: YahooChartHost;
}

const YAHOO_CHART_ORIGINS: Record<YahooChartHost, string> = {
  query1: "https://query1.finance.yahoo.com",
  query2: "https://query2.finance.yahoo.com",
};

const YAHOO_CHART_INTERVALS: Record<YahooChartInterval, true> = {
  "1m": true,
  "2m": true,
  "5m": true,
  "15m": true,
  "30m": true,
  "60m": true,
  "90m": true,
  "1h": true,
  "1d": true,
  "5d": true,
  "1wk": true,
  "1mo": true,
  "3mo": true,
};

const YAHOO_CHART_RANGES: Record<YahooChartRange, true> = {
  "1d": true,
  "5d": true,
  "1mo": true,
  "3mo": true,
  "6mo": true,
  "1y": true,
  "2y": true,
  "5y": true,
  "10y": true,
  ytd: true,
  max: true,
};

/**
 * Common Yahoo Finance futures and benchmark symbols. Labels make enumerated
 * curve inputs self-describing while preserving Yahoo's exact ticker strings.
 */
export const YAHOO_FUTURES_SYMBOLS: Readonly<Record<string, string>> = {
  "CL=F": "WTI crude oil futures",
  "BZ=F": "Brent crude oil futures",
  "NG=F": "Natural gas futures",
  "GC=F": "Gold futures",
  "SI=F": "Silver futures",
  "HG=F": "Copper futures",
  "ZC=F": "Corn futures",
  "ZW=F": "Wheat futures",
  "ZS=F": "Soybean futures",
  "ES=F": "S&P 500 E-mini futures",
  "NQ=F": "Nasdaq 100 E-mini futures",
  "^VIX": "CBOE Volatility Index",
  "DX-Y.NYB": "U.S. Dollar Index",
  "^TNX": "U.S. Treasury 10-year yield",
};

/** Builds a validated Yahoo Finance chart API URL. */
export function yahooChartUrl(symbol: string, options: YahooChartUrlOptions): string {
  if (!Object.hasOwn(YAHOO_CHART_INTERVALS, options.interval)) {
    throw new RangeError(`Unsupported Yahoo chart interval: ${options.interval}`);
  }
  if (!Object.hasOwn(YAHOO_CHART_RANGES, options.range)) {
    throw new RangeError(`Unsupported Yahoo chart range: ${options.range}`);
  }

  if (!Object.hasOwn(YAHOO_CHART_ORIGINS, options.host)) {
    throw new RangeError(`Unsupported Yahoo chart host: ${options.host}`);
  }
  const origin = YAHOO_CHART_ORIGINS[options.host];

  const url = new URL(`/v8/finance/chart/${encodeURIComponent(symbol)}`, origin);
  url.searchParams.set("interval", options.interval);
  url.searchParams.set("range", options.range);
  return url.toString();
}

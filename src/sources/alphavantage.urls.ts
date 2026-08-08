import { XnewsFetchError } from "../errors.js";
import { hasAsciiControlCharacters } from "../text.js";
import type { SourceFetchOptions } from "../types.js";

/** Options for one Alpha Vantage earnings-call transcript fetch. */
export interface AlphaVantageTranscriptOptions extends SourceFetchOptions {
  /**
   * Alpha Vantage API key. Free keys (https://www.alphavantage.co/support/#api-key)
   * allow 25 requests per day at 5 per minute; the key rides as a query
   * parameter and is redacted from reported URLs and errors.
   */
  readonly apiKey: string;
}

const ALPHA_VANTAGE_QUERY_ENDPOINT = "https://www.alphavantage.co/query";

const QUARTER_PATTERN = /^\d{4}Q[1-4]$/;

/**
 * Alpha Vantage `EARNINGS_CALL_TRANSCRIPT` request for one fiscal quarter
 * (`"2024Q1"` labels). Requires a non-blank `apiKey`; a blank key fails
 * closed with a `config` error before any network I/O.
 */
export function alphaVantageTranscriptUrl(
  symbol: string,
  quarter: string,
  options: AlphaVantageTranscriptOptions,
): string {
  const ticker = symbol.trim().toUpperCase();
  if (!ticker || hasAsciiControlCharacters(ticker)) {
    throw new TypeError("Ticker symbol is required");
  }
  const fiscalQuarter = quarter.trim().toUpperCase();
  if (!QUARTER_PATTERN.test(fiscalQuarter)) {
    throw new RangeError('quarter must look like "2024Q1"');
  }
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new XnewsFetchError("config", "Alpha Vantage requires a non-blank apiKey", {
      url: ALPHA_VANTAGE_QUERY_ENDPOINT,
    });
  }
  const url = new URL(ALPHA_VANTAGE_QUERY_ENDPOINT);
  url.searchParams.set("function", "EARNINGS_CALL_TRANSCRIPT");
  url.searchParams.set("symbol", ticker);
  url.searchParams.set("quarter", fiscalQuarter);
  url.searchParams.set("apikey", apiKey);
  return url.toString();
}

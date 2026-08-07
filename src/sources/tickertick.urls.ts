import { normalizeLimit } from "../options.js";

/**
 * TickerTick API (https://github.com/hczhu/TickerTick-API): free, keyless,
 * rate-limited to 10 requests per minute per IP.
 */
export function tickerTickFeedUrl(ticker: string, limit?: number): string {
  const url = new URL("https://api.tickertick.com/feed");
  url.searchParams.set("q", `z:${ticker.toLowerCase()}`);
  url.searchParams.set("n", String(Math.min(normalizeLimit(limit) ?? 42, 1000)));
  return url.toString();
}

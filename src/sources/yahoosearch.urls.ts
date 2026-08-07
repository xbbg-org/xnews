import { normalizeLimit } from "../options.js";

export function yahooSearchUrl(query: string, limit?: number): string {
  const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
  url.searchParams.set("q", query);
  url.searchParams.set("newsCount", String(Math.min(normalizeLimit(limit) ?? 20, 50)));
  url.searchParams.set("quotesCount", "0");
  return url.toString();
}

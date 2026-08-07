const FINVIZ_BASE_URL = "https://finviz.com";

export function finvizQuoteUrl(ticker: string): string {
  const url = new URL("/quote.ashx", FINVIZ_BASE_URL);
  url.searchParams.set("t", ticker.toUpperCase());
  url.searchParams.set("p", "d");
  return url.toString();
}

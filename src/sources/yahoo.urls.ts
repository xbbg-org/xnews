export function yahooFinanceRssUrl(ticker: string, region = "US", lang = "en-US"): string {
  const url = new URL("https://feeds.finance.yahoo.com/rss/2.0/headline");
  url.searchParams.set("s", ticker.toUpperCase());
  url.searchParams.set("region", region);
  url.searchParams.set("lang", lang);
  return url.toString();
}

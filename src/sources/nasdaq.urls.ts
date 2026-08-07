export function nasdaqRssUrl(ticker: string): string {
  const url = new URL("https://www.nasdaq.com/feed/rssoutbound");
  url.searchParams.set("symbol", ticker.toUpperCase());
  return url.toString();
}

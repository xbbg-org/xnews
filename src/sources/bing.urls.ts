export function bingNewsRssUrl(query: string): string {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  return url.toString();
}

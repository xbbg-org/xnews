export function googleNewsRssUrl(query: string, region = "US", lang = "en-US"): string {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", query);
  url.searchParams.set("hl", lang);
  url.searchParams.set("gl", region);
  url.searchParams.set("ceid", `${region}:en`);
  return url.toString();
}

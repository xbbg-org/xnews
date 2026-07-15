import { fetchText } from "../http";
import { parseRssItems } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

export function bingNewsRssUrl(query: string): string {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "rss");
  return url.toString();
}

export async function fetchBingNews(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(bingNewsRssUrl(query), {
    ...options,
    userAgent: options.userAgent ?? "Mozilla/5.0 xnews/0.1.0",
  });
  return parseBingNews(xml, options.limit);
}

export function parseBingNews(xml: string, limit?: number): NewsItem[] {
  return parseRssItems(xml, {
    provider: "bing-news",
    sourceFallback: "Bing News",
    resolveUrl: unwrapBingRedirect,
    ...(limit !== undefined ? { limit } : {}),
  });
}

function unwrapBingRedirect(link: string): string {
  try {
    const parsed = new URL(link);
    if (!parsed.hostname.endsWith("bing.com")) return link;
    const target = parsed.searchParams.get("url");
    return target && /^https?:\/\//.test(target) ? target : link;
  } catch {
    return link;
  }
}

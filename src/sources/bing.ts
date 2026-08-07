import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { safeHttpUrl } from "../text.js";
import { parseRssItems } from "../xml.js";
import { bingNewsRssUrl } from "./bing.urls.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { bingNewsRssUrl } from "./bing.urls.js";

export async function fetchBingNews(
  query: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const xml = await fetchText(
    bingNewsRssUrl(query),
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
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
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (host !== "bing.com" && !host.endsWith(".bing.com")) return link;
    return safeHttpUrl(parsed.searchParams.get("url") ?? "") ?? link;
  } catch {
    return link;
  }
}

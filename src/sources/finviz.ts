import { parsePublishedAt } from "../dates.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { cleanText, stableId, toAbsoluteUrl } from "../text.js";
import { finvizQuoteUrl } from "./finviz.urls.js";
import type { NewsItem, NewsKind, SourceFetchOptions } from "../types.js";

export { finvizQuoteUrl } from "./finviz.urls.js";

const FINVIZ_BASE_URL = "https://finviz.com";

export async function fetchFinvizNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const html = await fetchText(
    finvizQuoteUrl(ticker),
    options,
    options.userAgent ?? BROWSERISH_USER_AGENT,
  );
  return parseFinvizNews(html, ticker, limit);
}

export function parseFinvizNews(html: string, ticker: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];
  const table =
    html.match(/<table\b[^>]*id=["']news-table["'][^>]*>[\s\S]*?<\/table>/i)?.[0] ?? html;
  const items: NewsItem[] = [];
  let currentDate = "";

  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1] ?? "";
    const linkMatch = row.match(
      /<a\b(?=[^>]*class=["'][^"']*tab-link-news[^"']*["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>([\s\S]*?)<\/a>/i,
    );
    if (!linkMatch?.[1] || !linkMatch[2]) continue;

    const timeCell = row.match(/<td\b[^>]*align=["']right["'][^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? "";
    const timestamp = normalizeFinvizTimestamp(cleanText(timeCell), currentDate);
    currentDate = timestamp.currentDate;

    const title = cleanText(linkMatch[2]);
    const url = toAbsoluteUrl(linkMatch[1], FINVIZ_BASE_URL);
    const source = parseFinvizSource(row);

    if (!title || !url) continue;

    items.push({
      id: stableId(["finviz", url, title]),
      provider: "finviz",
      kind: classifyFinvizItem(source, title, url),
      title,
      url,
      canonicalUrl: url,
      source,
      ticker: ticker.toUpperCase(),
      ...(timestamp.iso ? { publishedAt: timestamp.iso } : {}),
      ...(timestamp.text ? { publishedAtText: timestamp.text } : {}),
    });

    if (normalizedLimit !== undefined && items.length >= normalizedLimit) break;
  }

  return items;
}

function normalizeFinvizTimestamp(
  value: string,
  currentDate: string,
): { text?: string; iso?: string; currentDate: string } {
  const fullMatch = value.match(/^([A-Z][a-z]{2}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}[AP]M)$/);
  if (fullMatch?.[1] && fullMatch[2]) {
    const text = `${fullMatch[1]} ${fullMatch[2]}`;
    const iso = parsePublishedAt(text)?.instant;
    return { text, ...(iso ? { iso } : {}), currentDate: fullMatch[1] };
  }

  if (/^\d{1,2}:\d{2}[AP]M$/.test(value) && currentDate) {
    const text = `${currentDate} ${value}`;
    const iso = parsePublishedAt(text)?.instant;
    return { text, ...(iso ? { iso } : {}), currentDate };
  }

  return { ...(value ? { text: value } : {}), currentDate };
}

function parseFinvizSource(row: string): string {
  const span = row.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "";
  const source = cleanText(span)
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  return source || "Finviz";
}

function classifyFinvizItem(source: string, title: string, url: string): NewsKind {
  const combined = `${source} ${title} ${url}`.toLowerCase();
  if (
    combined.includes("business wire") ||
    combined.includes("pr newswire") ||
    combined.includes("globenewswire")
  )
    return "press-release";
  if (
    combined.includes("zacks") ||
    combined.includes("stockstory") ||
    combined.includes("insider monkey")
  )
    return "analysis";
  return "article";
}

import { fetchText } from "../http";
import { normalizeLimit } from "../options";
import { cleanText, stableId, toAbsoluteUrl } from "../text";
import type { NewsItem, NewsKind, SourceFetchOptions } from "../types";

const FINVIZ_BASE_URL = "https://finviz.com";

const MONTH_INDEX_BY_ABBR: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

const EASTERN_OFFSET_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  timeZoneName: "shortOffset",
});

export function finvizQuoteUrl(ticker: string): string {
  const url = new URL("/quote.ashx", FINVIZ_BASE_URL);
  url.searchParams.set("t", ticker.toUpperCase());
  url.searchParams.set("p", "d");
  return url.toString();
}

export async function fetchFinvizNews(
  ticker: string,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const html = await fetchText(finvizQuoteUrl(ticker), {
    ...options,
    userAgent: options.userAgent ?? "Mozilla/5.0 xnews/0.1.0",
  });
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
    const iso = finvizTimestampToIso(text);
    return { text, ...(iso ? { iso } : {}), currentDate: fullMatch[1] };
  }

  if (/^\d{1,2}:\d{2}[AP]M$/.test(value) && currentDate) {
    const text = `${currentDate} ${value}`;
    const iso = finvizTimestampToIso(text);
    return { text, ...(iso ? { iso } : {}), currentDate };
  }

  return { ...(value ? { text: value } : {}), currentDate };
}

function finvizTimestampToIso(value: string): string | undefined {
  const match = value.match(/^([A-Z][a-z]{2})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})([AP]M)$/);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6])
    return undefined;

  const month = MONTH_INDEX_BY_ABBR[match[1]];
  if (month === undefined) return undefined;

  const day = Number.parseInt(match[2], 10);
  const year = 2000 + Number.parseInt(match[3], 10);
  const hour12 = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);
  const hour = match[6] === "PM" ? (hour12 % 12) + 12 : hour12 % 12;
  const utcGuess = new Date(Date.UTC(year, month, day, hour, minute));
  return new Date(utcGuess.getTime() - easternOffsetMinutes(utcGuess) * 60_000).toISOString();
}

function easternOffsetMinutes(utcDate: Date): number {
  const timeZoneName =
    EASTERN_OFFSET_FORMATTER.formatToParts(utcDate).find((part) => part.type === "timeZoneName")
      ?.value ?? "GMT-5";
  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match?.[1] || !match[2]) return -300;

  const hours = Number.parseInt(match[2], 10);
  const minutes = match[3] ? Number.parseInt(match[3], 10) : 0;
  return (match[1] === "-" ? -1 : 1) * (hours * 60 + minutes);
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

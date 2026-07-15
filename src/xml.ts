import { cleanText, decodeEntities, stableId, stripCdata } from "./text";
import { normalizeLimit } from "./options";
import type { NewsItem, NewsKind, NewsProvider } from "./types";

export interface RssParseOptions {
  provider: NewsProvider;
  kind?: NewsKind;
  sourceFallback: string;
  ticker?: string;
  limit?: number;
  /** Rewrite an item URL from its decoded link and guid, e.g. to unwrap redirect links. */
  resolveUrl?: (link: string, guid: string) => string;
}

export interface AtomParseOptions {
  provider: NewsProvider;
  kind?: NewsKind;
  sourceFallback: string;
  ticker?: string;
  limit?: number;
  /** Extra tags to read a per-entry source name from before falling back. */
  sourceTags?: readonly string[];
}

export function parseRssItems(xml: string, options: RssParseOptions): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const items: NewsItem[] = [];
  for (const block of matchBlocks(xml, "item")) {
    const title = cleanText(readTag(block, "title"));
    const link = cleanText(readTag(block, "link"));
    if (!title || !link) continue;

    const pubDate = cleanText(readTag(block, "pubDate"));
    const guid = cleanText(readTag(block, "guid"));
    const description = cleanText(readTag(block, "description"));
    const source = cleanText(readTag(block, "source")) || options.sourceFallback;
    const publishedAt = toIsoDate(pubDate);
    const decodedLink = decodeEntities(link);
    const url = options.resolveUrl?.(decodedLink, guid) ?? decodedLink;

    items.push({
      id: stableId([options.provider, guid || link, title]),
      provider: options.provider,
      kind: options.kind ?? inferNewsKind(source, title, url),
      title,
      url,
      source,
      ...(options.provider !== "google-news" ? { canonicalUrl: url } : {}),
      ...(options.ticker ? { ticker: options.ticker.toUpperCase() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(pubDate ? { publishedAtText: pubDate } : {}),
      ...(description ? { summary: description } : {}),
    });

    if (limit !== undefined && items.length >= limit) break;
  }
  return items;
}

export function parseAtomEntries(xml: string, options: AtomParseOptions): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  const items: NewsItem[] = [];
  for (const block of matchBlocks(xml, "entry")) {
    const title = cleanText(readTag(block, "title"));
    const link = readAtomLink(block);
    if (!title || !link) continue;

    const updated = cleanText(readTag(block, "updated")) || cleanText(readTag(block, "published"));
    const summary = cleanText(readTag(block, "summary"));
    const accessionNumber =
      cleanText(readTag(block, "accession-number")) ||
      (cleanText(readTag(block, "id")).match(/accession-number=([\d-]+)/)?.[1] ?? "");
    const formType = cleanText(readTag(block, "filing-type")) || readCategoryTerm(block);
    const publishedAt = toIsoDate(updated);
    const decodedLink = decodeEntities(link);
    const source = readFirstTag(block, options.sourceTags ?? []) || options.sourceFallback;

    items.push({
      id: stableId([options.provider, accessionNumber || link, title]),
      provider: options.provider,
      kind: options.kind ?? "filing",
      title,
      url: decodedLink,
      canonicalUrl: decodedLink,
      source,
      ...(options.ticker ? { ticker: options.ticker.toUpperCase() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(updated ? { publishedAtText: updated } : {}),
      ...(summary ? { summary } : {}),
      ...(formType ? { formType } : {}),
      ...(accessionNumber ? { accessionNumber } : {}),
    });

    if (limit !== undefined && items.length >= limit) break;
  }
  return items;
}

function readFirstTag(block: string, tags: readonly string[]): string {
  for (const tag of tags) {
    const value = cleanText(readTag(block, tag));
    if (value) return value;
  }
  return "";
}

function* matchBlocks(xml: string, tag: string): Generator<string> {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
    "gi",
  );
  for (const match of xml.matchAll(pattern)) {
    const block = match[1];
    if (block !== undefined) yield block;
  }
}

function readTag(block: string, tag: string): string {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
    "i",
  );
  return stripCdata(block.match(pattern)?.[1] ?? "");
}

function readAtomLink(block: string): string {
  const alternate = block.match(
    /<link\b(?=[^>]*rel=["']alternate["'])(?=[^>]*href=["']([^"']+)["'])[^>]*>/i,
  )?.[1];
  const any = block.match(/<link\b(?=[^>]*href=["']([^"']+)["'])[^>]*>/i)?.[1];
  return alternate ?? any ?? cleanText(readTag(block, "link"));
}

function readCategoryTerm(block: string): string {
  return cleanText(block.match(/<category\b(?=[^>]*term=["']([^"']+)["'])[^>]*>/i)?.[1] ?? "");
}

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function inferNewsKind(source: string, title: string, link: string): NewsKind {
  const combined = `${source} ${title} ${link}`.toLowerCase();
  if (
    combined.includes("business wire") ||
    combined.includes("pr newswire") ||
    combined.includes("globenewswire")
  ) {
    return "press-release";
  }
  if (combined.includes("sec.gov") || combined.includes("edgar")) return "filing";
  if (
    combined.includes("zacks") ||
    combined.includes("stockstory") ||
    combined.includes("insider monkey")
  ) {
    return "analysis";
  }
  return "article";
}

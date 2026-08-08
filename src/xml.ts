import { parsePublishedAt } from "./dates.js";
import { cleanText, decodeEntities, safeHttpUrl, stableId, stripCdata } from "./text.js";
import { normalizeLimit } from "./options.js";
import type { NewsItem, NewsKind, NewsProvider } from "./types.js";
const MAX_XML_NESTING_DEPTH = 256;

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
  assertXmlEnvelope(xml, ["rss", "rdf"], `${options.provider}: invalid RSS feed response`);
  let candidateCount = 0;
  const items: NewsItem[] = [];
  for (const block of matchXmlBlocks(xml, "item")) {
    candidateCount += 1;
    const title = cleanText(readXmlTag(block, "title"));
    const link = readFirstNonEmptyTag(block, "link");
    if (!title || !link) continue;

    const pubDate = cleanText(readXmlTag(block, "pubDate")) || cleanText(readXmlTag(block, "date"));
    const guid = cleanText(readXmlTag(block, "guid"));
    const description = cleanText(readXmlTag(block, "description"));
    const source = cleanText(readXmlTag(block, "source")) || options.sourceFallback;
    const publishedAt = toIsoDate(pubDate);
    const decodedLink = decodeEntities(link);
    const url = safeHttpUrl(options.resolveUrl?.(decodedLink, guid) ?? decodedLink);
    if (url === undefined) continue;
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
  if (candidateCount > 0 && items.length === 0) {
    throw new Error(`${options.provider}: RSS response contained no valid records`);
  }
  return items;
}

export function parseAtomEntries(xml: string, options: AtomParseOptions): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];
  assertXmlEnvelope(xml, ["feed"], `${options.provider}: invalid Atom feed response`);
  let candidateCount = 0;
  const items: NewsItem[] = [];
  for (const block of matchXmlBlocks(xml, "entry")) {
    candidateCount += 1;
    const title = cleanText(readXmlTag(block, "title"));
    const link = readAtomLink(block);
    if (!title || !link) continue;

    const published =
      cleanText(readXmlTag(block, "published")) || cleanText(readXmlTag(block, "updated"));
    const summary = cleanText(readXmlTag(block, "summary"));
    const accessionNumber =
      cleanText(readXmlTag(block, "accession-number")) ||
      (cleanText(readXmlTag(block, "id")).match(/accession-number=([\d-]+)/)?.[1] ?? "");
    const formType = cleanText(readXmlTag(block, "filing-type")) || readCategoryTerm(block);
    const publishedAt = toIsoDate(published);
    const url = safeHttpUrl(decodeEntities(link));
    if (url === undefined) continue;
    const source = readFirstTag(block, options.sourceTags ?? []) || options.sourceFallback;
    items.push({
      id: stableId([options.provider, accessionNumber || link, title]),
      provider: options.provider,
      kind: options.kind ?? "filing",
      title,
      url,
      canonicalUrl: url,
      source,
      ...(options.ticker ? { ticker: options.ticker.toUpperCase() } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      ...(published ? { publishedAtText: published } : {}),
      ...(summary ? { summary } : {}),
      ...(formType ? { formType } : {}),
      ...(accessionNumber ? { accessionNumber } : {}),
    });

    if (limit !== undefined && items.length >= limit) break;
  }
  if (candidateCount > 0 && items.length === 0) {
    throw new Error(`${options.provider}: Atom response contained no valid records`);
  }
  return items;
}

function readFirstNonEmptyTag(block: string, tag: string): string {
  for (const value of readXmlTags(block, tag)) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return "";
}

function readFirstTag(block: string, tags: readonly string[]): string {
  for (const tag of tags) {
    const value = cleanText(readXmlTag(block, tag));
    if (value) return value;
  }
  return "";
}

interface XmlTag {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly localName: string;
  readonly closing: boolean;
  readonly selfClosing: boolean;
}

interface XmlMarkup {
  readonly end: number;
  readonly kind: "tag" | "trivia" | "cdata";
  readonly tag?: XmlTag;
}

export function assertXmlEnvelope(
  xml: string,
  expectedRootLocalNames: readonly string[],
  message: string,
): void {
  const stack: string[] = [];
  let rootLocalName = "";
  let rootCount = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start === -1) {
      if (stack.length === 0 && xml.slice(cursor).trim()) throw new Error(message);
      cursor = xml.length;
      break;
    }
    if (stack.length === 0 && xml.slice(cursor, start).trim()) throw new Error(message);

    const markup = readXmlMarkup(xml, start);
    if (markup === undefined || (markup.kind === "cdata" && stack.length === 0)) {
      throw new Error(message);
    }
    cursor = markup.end;
    const tag = markup.tag;
    if (tag === undefined) continue;

    if (tag.closing) {
      if (tag.selfClosing || stack[stack.length - 1] !== tag.name) throw new Error(message);
      stack.pop();
      continue;
    }

    if (stack.length === 0) {
      rootCount += 1;
      rootLocalName = tag.localName;
    }
    if (!tag.selfClosing) {
      if (stack.length >= MAX_XML_NESTING_DEPTH) throw new Error(message);
      stack.push(tag.name);
    }
  }

  if (
    stack.length !== 0 ||
    rootCount !== 1 ||
    !expectedRootLocalNames.some(
      (expectedRoot) => expectedRoot.toLowerCase() === rootLocalName.toLowerCase(),
    )
  ) {
    throw new Error(message);
  }
}

export function* matchXmlBlocks(xml: string, localName: string): Generator<string> {
  const expectedLocalName = localName.toLowerCase();
  let depth = 0;
  let contentStart = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf("<", cursor);
    if (start === -1) return;
    const markup = readXmlMarkup(xml, start);
    if (markup === undefined) return;
    cursor = markup.end;
    const tag = markup.tag;
    if (tag === undefined || tag.localName.toLowerCase() !== expectedLocalName) continue;

    if (!tag.closing) {
      if (tag.selfClosing) {
        if (depth === 0) yield "";
        continue;
      }
      if (depth === 0) contentStart = tag.end;
      depth += 1;
      continue;
    }

    if (depth === 0) continue;
    depth -= 1;
    if (depth === 0) yield xml.slice(contentStart, tag.start);
  }
}

function readXmlMarkup(xml: string, start: number): XmlMarkup | undefined {
  if (xml.startsWith("<!--", start)) {
    const close = xml.indexOf("-->", start + 4);
    return close === -1 ? undefined : { end: close + 3, kind: "trivia" };
  }
  if (xml.startsWith("<![CDATA[", start)) {
    const close = xml.indexOf("]]>", start + 9);
    return close === -1 ? undefined : { end: close + 3, kind: "cdata" };
  }
  if (xml.startsWith("<?", start)) {
    const close = xml.indexOf("?>", start + 2);
    return close === -1 ? undefined : { end: close + 2, kind: "trivia" };
  }

  const end = findXmlMarkupEnd(xml, start);
  if (end === undefined) return undefined;
  if (xml.startsWith("<!", start)) return { end, kind: "trivia" };

  const markup = xml.slice(start, end);
  const closingMatch = markup.match(/^<\/([A-Za-z_][\w.:-]*)\s*>$/);
  const openingMatch = markup.match(/^<([A-Za-z_][\w.:-]*)(?=[\s/>])/);
  const name = closingMatch?.[1] ?? openingMatch?.[1];
  if (name === undefined) return undefined;
  const colon = name.lastIndexOf(":");
  const tag: XmlTag = {
    start,
    end,
    name,
    localName: name.slice(colon + 1),
    closing: closingMatch !== null,
    selfClosing: openingMatch !== null && /\/\s*>$/.test(markup),
  };
  return { end, kind: "tag", tag };
}

function findXmlMarkupEnd(xml: string, start: number): number | undefined {
  let quote = "";
  let bracketDepth = 0;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml.charAt(index);
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[") {
      bracketDepth += 1;
    } else if (character === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (character === ">" && bracketDepth === 0) {
      return index + 1;
    }
  }
  return undefined;
}

export function readXmlTag(xml: string, localName: string): string {
  for (const block of matchXmlBlocks(xml, localName)) return stripCdata(block);
  return "";
}

export function readXmlTags(xml: string, localName: string): string[] {
  const values: string[] = [];
  for (const block of matchXmlBlocks(xml, localName)) values.push(stripCdata(block));
  return values;
}

export function readXmlAttribute(
  xml: string,
  elementLocalName: string,
  attributeLocalName: string,
): string {
  const attribute = new RegExp(
    `(?:^|\\s)(?:[\\w.-]+:)?${escapeRegExp(attributeLocalName)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
    "i",
  );
  for (const element of matchXmlOpeningTags(xml, elementLocalName)) {
    const value = element.match(attribute)?.[2];
    if (value !== undefined) return value;
  }
  return "";
}

function* matchXmlOpeningTags(xml: string, localName: string): Generator<string> {
  const name = `(?:[\\w.-]+:)?${escapeRegExp(localName)}`;
  const pattern = new RegExp(`<${name}(?=[\\s/>])[^>]*>`, "gi");
  for (const match of xml.matchAll(pattern)) {
    const element = match[0];
    if (element !== undefined) yield element;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readAtomLink(block: string): string {
  let first = "";
  for (const element of matchXmlOpeningTags(block, "link")) {
    const href = readXmlAttribute(element, "link", "href");
    if (!href) continue;
    first ||= href;
    if (readXmlAttribute(element, "link", "rel").toLowerCase() === "alternate") return href;
  }
  return first || cleanText(readXmlTag(block, "link"));
}

function readCategoryTerm(block: string): string {
  return cleanText(readXmlAttribute(block, "category", "term"));
}

function toIsoDate(value: string): string | undefined {
  return parsePublishedAt(value)?.instant;
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

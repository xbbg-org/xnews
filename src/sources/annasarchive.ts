/**
 * Anna's Archive catalog adapter for the works lane.
 *
 * Anna's Archive mirror hostnames rotate, so requests use a supplied
 * `baseUrl`. Search pages are server-rendered HTML rather than a published
 * API, so the parser keys record boundaries and fields on semantic signals:
 * MD5 cover links, plain-text MD5 title links, icon markers, and middot
 * metadata. Tailwind layout classes are deliberately ignored.
 *
 * Numeric display values are explicitly coerced. A failed coercion leaves the
 * normalized field absent and appends a warning; a response with no usable
 * record shape throws instead of masquerading as an empty catalog. Records
 * use `availability: "unknown"` when the catalog states no availability
 * metadata.
 */

import { XnewsFetchError } from "../errors.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { withMirrorFailover } from "../mirrors.js";
import { normalizeLimit } from "../options.js";
import { cleanText, decodeEntities, elementPattern, parseByteSize } from "../text.js";
import { extractIsbns, isbnIdentity, normalizeDoi, normalizeIsbn } from "../works.js";
import {
  annasArchiveMirrorBase,
  annasArchiveRecordUrl,
  annasArchiveSearchUrl,
  ANNAS_ARCHIVE_DEFAULT_PER_PAGE,
  type AnnasArchiveMirrorOptions,
  type AnnasArchiveSearchUrlOptions,
} from "./annasarchive.urls.js";
import type {
  SourceFetchOptions,
  WorkRecord,
  WorksPage,
  WorksQuery,
  WorksSource,
} from "../types.js";

export {
  annasArchiveMirrorBase,
  annasArchiveRecordUrl,
  annasArchiveSearchUrl,
  ANNAS_ARCHIVE_DEFAULT_PER_PAGE,
  ANNAS_ARCHIVE_MD5_PATH,
  ANNAS_ARCHIVE_SEARCH_PATH,
} from "./annasarchive.urls.js";
export type {
  AnnasArchiveMirrorOptions,
  AnnasArchiveSearchUrlOptions,
} from "./annasarchive.urls.js";

/** The provider name built-in Anna's Archive records carry. */
export const ANNAS_ARCHIVE_PROVIDER = "annas-archive";

export interface AnnasArchiveParseOptions extends AnnasArchiveMirrorOptions {
  /** 1-based page number the HTML came from; defaults to 1. */
  readonly page?: number;
  /** Recorded in `requestUrls` for observability. */
  readonly requestUrl?: string;
}

export interface AnnasArchiveSearchOptions
  extends SourceFetchOptions, AnnasArchiveSearchUrlOptions {
  /** Result pages to walk; defaults to 1. */
  readonly maxPages?: number;
}

/** Fetches and parses one server-rendered search page. */
export async function fetchAnnasArchiveRecords(
  query: string,
  options: AnnasArchiveSearchOptions,
): Promise<WorksPage> {
  const url = annasArchiveSearchUrl(query, options);
  const html = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  return parseAnnasArchiveRecords(html, {
    baseUrl: options.baseUrl,
    page: options.page ?? 1,
    requestUrl: url,
  });
}

/**
 * Walks result pages until the requested limit, the configured page cap, or a
 * page that says there are no more results. Warnings and request URLs retain
 * every page's provenance.
 */
export async function searchAnnasArchiveRecords(
  query: string,
  options: AnnasArchiveSearchOptions,
): Promise<WorksPage> {
  const limit = normalizeLimit(options.limit);
  const firstPage = options.page ?? 1;
  if (limit === 0) {
    return { items: [], page: firstPage, hasMore: false, warnings: [], requestUrls: [] };
  }
  const maxPages = normalizeMaxPages(options.maxPages);
  const items: WorkRecord[] = [];
  const warnings: string[] = [];
  const requestUrls: string[] = [];
  let hasMore = false;
  let totalCount: number | undefined;

  for (let offset = 0; offset < maxPages; offset += 1) {
    const page = await fetchAnnasArchiveRecords(query, { ...options, page: firstPage + offset });
    items.push(...page.items);
    warnings.push(...page.warnings);
    requestUrls.push(...page.requestUrls);
    totalCount ??= page.totalCount;
    hasMore = page.hasMore;
    if (!page.hasMore) break;
    if (limit !== undefined && items.length >= limit) break;
  }

  const limited = limit === undefined ? items : items.slice(0, limit);
  return {
    items: limited,
    page: firstPage,
    hasMore: hasMore || (limit !== undefined && items.length > limited.length),
    ...(totalCount === undefined ? {} : { totalCount }),
    warnings: [...new Set(warnings)],
    requestUrls,
  };
}

/**
 * Parses Anna's Archive search HTML into works-lane records. Pure: fixture
 * text in, normalized records out, with no network access.
 *
 * Cover anchors start record blocks. Within each block, the matching
 * plain-text MD5 anchor is the title; author and publisher anchors are found
 * by their semantic icon markers. A response with neither cover blocks nor a
 * recognizable empty-result marker is treated as a layout/configuration
 * failure, not as zero matches.
 */
export function parseAnnasArchiveRecords(
  html: string,
  options: AnnasArchiveParseOptions,
): WorksPage {
  const source = stripScriptsAndStyles(html);
  const page = options.page ?? 1;
  const requestUrls = options.requestUrl === undefined ? [] : [options.requestUrl];
  const warnings: string[] = [];
  const boundaries = findCoverBoundaries(source);
  const summary = parseResultSummary(source);
  if (summary.malformed) {
    throw new XnewsFetchError(
      "config",
      "Anna's Archive response contained an unrecognized result-count summary; the mirror layout may have changed",
      { url: options.requestUrl ?? annasArchiveMirrorBase(options.baseUrl) },
    );
  }

  if (boundaries.length === 0) {
    if (isExplicitEmptyResult(source)) {
      return {
        items: [],
        page,
        hasMore: false,
        ...(summary.totalCount === undefined ? {} : { totalCount: summary.totalCount }),
        warnings,
        requestUrls,
      };
    }
    throw new XnewsFetchError(
      "config",
      "Anna's Archive response contained no recognizable MD5 result blocks; the mirror layout may have changed or the request was blocked",
      { url: options.requestUrl ?? annasArchiveMirrorBase(options.baseUrl) },
    );
  }

  if (summary.resultCount !== undefined && boundaries.length !== summary.resultCount) {
    throw new XnewsFetchError(
      "config",
      `Anna's Archive result summary reported ${summary.resultCount} records but ${boundaries.length} cover boundaries were found; the mirror layout may have changed`,
      { url: options.requestUrl ?? annasArchiveMirrorBase(options.baseUrl) },
    );
  }

  const items: WorkRecord[] = [];
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index]!;
    const end = boundaries[index + 1]?.index ?? source.length;
    const record = parseRecordBlock(source.slice(boundary.index, end), boundary.md5, options);
    if (record === undefined) {
      warnings.push(
        `annas-archive: skipped md5 ${boundary.md5} because its plain-text title link was missing`,
      );
    } else {
      items.push(record);
      warnings.push(...record.warnings);
    }
  }

  if (items.length === 0) {
    throw new XnewsFetchError(
      "config",
      "Anna's Archive response yielded no usable records from its MD5 result blocks; the mirror layout may have changed",
      { url: options.requestUrl ?? annasArchiveMirrorBase(options.baseUrl) },
    );
  }

  return {
    items,
    page,
    hasMore:
      summary.hasMore ??
      (items.length >= ANNAS_ARCHIVE_DEFAULT_PER_PAGE && boundaries.length >= items.length),
    ...(summary.totalCount === undefined ? {} : { totalCount: summary.totalCount }),
    warnings: [...new Set(warnings)],
    requestUrls,
  };
}

export interface AnnasArchiveSourceOptions extends Omit<AnnasArchiveSearchOptions, "baseUrl"> {
  /**
   * Mirror origins, tried in order until one answers. At least one is
   * required.
   */
  readonly mirrors: readonly string[];
}

/**
 * Binds a caller-supplied mirror pool to the works lane. Mirrors are tried in
 * order and only a throw advances to the next, so a legitimate empty answer
 * ends the search. Failed mirrors are named in page warnings, and every
 * record is attributed to the mirror that actually answered.
 */
export function annasArchiveSource(options: AnnasArchiveSourceOptions): WorksSource {
  return {
    provider: ANNAS_ARCHIVE_PROVIDER,
    requestUrls(query) {
      const term = resolveQuery(query);
      return options.mirrors.map((baseUrl) =>
        annasArchiveSearchUrl(term, { ...options, ...query, baseUrl }),
      );
    },
    async search(query) {
      const term = resolveQuery(query);
      if (options.mirrors.length === 0) {
        throw new XnewsFetchError("config", "Anna's Archive requires at least one mirror origin", {
          url: "",
        });
      }
      const outcome = await withMirrorFailover(options.mirrors, (baseUrl) =>
        searchAnnasArchiveRecords(term, { ...options, ...query, baseUrl }),
      );
      const page = outcome.value;
      return {
        items: page.items,
        page: page.page,
        hasMore: page.hasMore,
        ...(page.totalCount === undefined ? {} : { totalCount: page.totalCount }),
        warnings: [
          ...page.warnings,
          ...outcome.attempts.map(
            (attempt) =>
              `annas-archive: mirror ${attempt.baseUrl} failed (${attempt.code}); tried the next in the pool`,
          ),
        ],
        requestUrls: page.requestUrls,
      } satisfies WorksPage;
    },
  };
}

interface CoverBoundary {
  readonly md5: string;
  readonly index: number;
}

interface ParsedAnchor {
  readonly body: string;
  readonly md5?: string;
  readonly markerText: string;
}

interface ParsedMetadata {
  readonly language?: string;
  readonly format?: string;
  readonly sizeBytes?: number;
  readonly year?: number;
}

interface ParsedPublisher {
  readonly publisher?: string;
  readonly year?: number;
}

interface ResultSummary {
  readonly resultCount?: number;
  readonly totalCount?: number;
  readonly hasMore?: boolean;
  readonly malformed: boolean;
}

const MIDDOT = /(?:&middot;|&#183;|&#x0*b7;|·)/i;
const MIDDOT_GLOBAL = /(?:&middot;|&#183;|&#x0*b7;|·)/gi;
const AUTHOR_MARKER = "icon-[mdi--user-edit]";
const COMPANY_MARKER = "icon-[mdi--company]";
const LOWERCASE_FILE_FORMAT =
  /^(?:7z|azw3?|cb[rz]|djvu|docx?|epub|fb2|html?|mobi|odt|pdf|rar|rtf|txt|zip)$/i;
const SUMMARY_LIKE = /\b(?:Results?\s+[\d,]+|Showing\s+[\d,]+)\b/i;

function findCoverBoundaries(source: string): CoverBoundary[] {
  const boundaries: CoverBoundary[] = [];
  for (const match of source.matchAll(elementPattern("a"))) {
    const md5 = md5FromAttributes(match[1] ?? "");
    if (md5 === undefined || !/<img\b/i.test(match[2] ?? "")) continue;
    boundaries.push({ md5, index: match.index });
  }
  return boundaries;
}

function parseRecordBlock(
  block: string,
  md5: string,
  options: AnnasArchiveMirrorOptions,
): WorkRecord | undefined {
  const anchors = parseAnchors(block);
  const titleAnchor = anchors.find(
    (anchor) =>
      anchor.md5 === md5 && anchor.body.trim() !== "" && !/<[^>]+>/.test(anchor.body.trim()),
  );
  if (titleAnchor === undefined) return undefined;

  const warnings: string[] = [];
  const title = cleanAnnasText(titleAnchor.body);
  if (title === "") return undefined;
  const authors = [
    ...new Set(
      anchors
        .filter((anchor) => anchor.markerText.includes(AUTHOR_MARKER))
        .map((anchor) => cleanAnnasText(anchor.body))
        .filter((author) => author !== ""),
    ),
  ];
  const companyAnchor = anchors.find((anchor) => anchor.markerText.includes(COMPANY_MARKER));
  const publisher = parsePublisher(companyAnchor?.body);
  const metadataText = findMetadataText(block);
  const metadata = parseMetadata(metadataText, warnings);

  let publishedYear = publisher.year ?? metadata.year;
  if (
    publisher.year !== undefined &&
    metadata.year !== undefined &&
    publisher.year !== metadata.year
  ) {
    warnings.push(
      `annas-archive: publisher year ${publisher.year} disagrees with metadata year ${metadata.year}`,
    );
    publishedYear = publisher.year;
  }

  const isbns = [
    ...directDivTexts(block),
    ...(metadataText === undefined ? [] : [metadataText]),
  ].flatMap((text) => extractIsbns(text));

  const url = annasArchiveRecordUrl(md5, options);
  return {
    provider: ANNAS_ARCHIVE_PROVIDER,
    sourceId: md5,
    title,
    authors,
    ...(publisher.publisher === undefined ? {} : { publisher: publisher.publisher }),
    ...(publishedYear === undefined ? {} : { publishedYear }),
    ...(metadata.language === undefined ? {} : { language: metadata.language }),
    ...(metadata.format === undefined ? {} : { format: metadata.format }),
    ...(metadata.sizeBytes === undefined ? {} : { sizeBytes: metadata.sizeBytes }),
    identity: {
      ...isbnIdentity(isbns),
      md5,
      origin: "record",
      confidence: 1,
    },
    availability: "unknown",
    url,
    warnings,
    provenance: [{ provider: ANNAS_ARCHIVE_PROVIDER, url }],
  };
}

function parseAnchors(block: string): ParsedAnchor[] {
  const anchors: ParsedAnchor[] = [];
  for (const match of block.matchAll(elementPattern("a"))) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const md5 = md5FromAttributes(attributes);
    anchors.push({
      body,
      ...(md5 === undefined ? {} : { md5 }),
      markerText: `${attributes} ${body}`,
    });
  }
  return anchors;
}

function md5FromAttributes(attributes: string): string | undefined {
  const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
  const md5 = href === undefined ? undefined : /\/md5\/([a-f\d]{32})(?:[/?#]|$)/i.exec(href)?.[1];
  return md5?.toLowerCase();
}

/**
 * Splits the publisher anchor's text, which reads `Publisher, 1969` when a
 * year is stated and is free-form otherwise. A trailing segment that is not a
 * year is part of the publisher, not a failed year: `Dune Chronicles 2,
 * Galaxy Serialized Edition` names no year and warning on it would flag most
 * of every result page.
 */
function parsePublisher(value: string | undefined): ParsedPublisher {
  const text = value === undefined ? "" : cleanAnnasText(value);
  if (text === "") return {};
  const split = /^(.*),\s*(\d{4})$/.exec(text);
  const publisher = split === null ? text : (split[1]?.trim() ?? "");
  const year = split === null ? undefined : Number(split[2]);
  return {
    ...(publisher === "" ? {} : { publisher }),
    ...(year === undefined || !Number.isInteger(year) || year <= 0 ? {} : { year }),
  };
}

/**
 * Finds the middot-separated metadata line. The div holding it also holds
 * inline anchors, so the content pattern admits any tag except a nested
 * `div` — matching only tag-free content finds nothing on a live page.
 */
function findMetadataText(block: string): string | undefined {
  for (const match of block.matchAll(INNERMOST_DIV)) {
    const raw = match[1] ?? "";
    if (MIDDOT.test(raw)) return cleanAnnasText(raw);
  }
  return undefined;
}

function parseMetadata(value: string | undefined, warnings: string[]): ParsedMetadata {
  if (value === undefined) return {};
  let language: string | undefined;
  let format: string | undefined;
  let sizeBytes: number | undefined;
  let year: number | undefined;

  for (const segmentValue of value.split(MIDDOT_GLOBAL)) {
    const segment = cleanAnnasText(segmentValue);
    if (segment === "") continue;

    const languageMatch =
      /^(?:language\s*:\s*)?.+?\s*(?:\[([a-z]{2,3}(?:-[a-z\d]+)?)\]|\(([a-z]{2,3}(?:-[a-z\d]+)?)\))$/i.exec(
        segment,
      );
    const languageCode = languageMatch?.[1] ?? languageMatch?.[2];
    if (languageCode !== undefined) {
      language ??= languageCode.toLowerCase();
      continue;
    }
    if (/^\d+(?:[.,]\d+)?\s*(?:KiB|MiB|GiB|KB|MB|GB)$/i.test(segment)) {
      const parsed = parseByteSize(segment);
      if (parsed === undefined) {
        warnings.push(`annas-archive: could not coerce file size ${JSON.stringify(segment)}`);
      } else {
        sizeBytes ??= parsed;
      }
      continue;
    }
    const yearMatch = /^(?:(?:published|publication(?:\s+year)?|year)\s*:?\s*)?(\d{4})$/i.exec(
      segment,
    );
    if (yearMatch?.[1] !== undefined) {
      const parsed = Number(yearMatch[1]);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        warnings.push(
          `annas-archive: could not coerce publication year ${JSON.stringify(segment)}`,
        );
      } else {
        year ??= parsed;
      }
      continue;
    }
    if (/^[A-Z][A-Z\d]{1,7}$/.test(segment) || LOWERCASE_FILE_FORMAT.test(segment)) {
      format ??= segment.toLowerCase();
    }
  }

  if (
    language === undefined &&
    format === undefined &&
    sizeBytes === undefined &&
    year === undefined
  ) {
    warnings.push(
      "annas-archive: metadata line yielded no recognized language, format, size, or publication year",
    );
  }

  return {
    ...(language === undefined ? {} : { language }),
    ...(format === undefined ? {} : { format }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(year === undefined ? {} : { year }),
  };
}

/** Content of a div that contains no nested div; inline tags are allowed. */
const INNERMOST_DIV = /<div\b[^>]*>((?:[^<]|<(?!\/?div\b))*)<\/div>/gi;

function directDivTexts(block: string): string[] {
  const texts: string[] = [];
  for (const match of block.matchAll(INNERMOST_DIV)) {
    const text = cleanAnnasText(match[1] ?? "");
    if (text !== "") texts.push(text);
  }
  return texts;
}

function parseResultSummary(source: string): ResultSummary {
  const text = cleanAnnasText(source);
  const match = /\bResults\s+([\d,]+)\s*-\s*([\d,]+)\s*\(\s*([\d,]+)(\+)?\s+total\s*\)/i.exec(text);
  if (match === null) return { malformed: SUMMARY_LIKE.test(text) };

  const firstResult = Number((match[1] ?? "").replaceAll(",", ""));
  const lastResult = Number((match[2] ?? "").replaceAll(",", ""));
  const totalCount = Number((match[3] ?? "").replaceAll(",", ""));
  const isFloor = match[4] === "+";
  if (
    !Number.isSafeInteger(firstResult) ||
    !Number.isSafeInteger(lastResult) ||
    !Number.isSafeInteger(totalCount) ||
    firstResult <= 0 ||
    lastResult < firstResult ||
    totalCount < 0 ||
    (!isFloor && lastResult > totalCount)
  ) {
    return { malformed: true };
  }

  return {
    resultCount: lastResult - firstResult + 1,
    ...(isFloor ? {} : { totalCount }),
    hasMore: isFloor || lastResult < totalCount,
    malformed: false,
  };
}

function isExplicitEmptyResult(source: string): boolean {
  for (const match of source.matchAll(elementPattern("h[1-6]"))) {
    if (/^No results found[.!]?$/i.test(cleanAnnasText(match[2] ?? ""))) return true;
  }
  return false;
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

function cleanAnnasText(value: string): string {
  return cleanText(decodeEntities(value.replaceAll(MIDDOT_GLOBAL, "·")));
}

function resolveQuery(query: WorksQuery): string {
  if (query.isbn !== undefined && query.isbn.trim() !== "") {
    return normalizeIsbn(query.isbn) ?? query.isbn.trim();
  }
  if (query.doi !== undefined && query.doi.trim() !== "") {
    return normalizeDoi(query.doi) ?? query.doi.trim();
  }
  if (query.title !== undefined && query.title.trim() !== "") return query.title.trim();
  if (query.author !== undefined && query.author.trim() !== "") return query.author.trim();
  const term = query.query?.trim() ?? "";
  if (term === "") {
    throw new XnewsFetchError(
      "config",
      "Anna's Archive needs a non-empty query; set query, title, author, isbn, or doi",
      { url: "" },
    );
  }
  return term;
}

function normalizeMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) return 1;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new RangeError("maxPages must be a positive integer");
  }
  return maxPages;
}

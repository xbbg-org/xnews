/**
 * Library Genesis catalog adapter for the works lane.
 *
 * Library Genesis mirror hostnames rotate, so requests use a supplied
 * `baseUrl`.
 *
 * The result table is not a published API, so this parser is built to survive
 * fork drift rather than to assume one layout. Columns are mapped from the
 * table's own header row with a synonym table, falling back to the classic
 * positional layout only when no header is recognizable — and saying so in
 * `warnings`. Numeric cells arrive as display strings (`"2021"`, `"410[12]"`,
 * `"1005 Kb"`), so every coercion is explicit and a failure leaves the field
 * unset and appends a warning naming the raw value. A layout change therefore
 * surfaces as warnings or a hard parse error, never as silently empty rows.
 *
 * Records use `availability: "unknown"` when the catalog states no
 * availability metadata.
 */

import { parsePublishedAt } from "../dates.js";
import { XnewsFetchError } from "../errors.js";
import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { withMirrorFailover } from "../mirrors.js";
import { normalizeLimit } from "../options.js";
import {
  cleanText,
  decodeEntities,
  elementPattern,
  openTagPattern,
  parseByteSize,
} from "../text.js";
import { extractIsbns, isbnIdentity } from "../works.js";
import {
  libgenAbsoluteUrl,
  libgenDetailUrl,
  libgenMirrorBase,
  libgenSearchUrl,
  LIBGEN_DEFAULT_PER_PAGE,
  LIBGEN_MIN_QUERY_LENGTH,
  type LibgenMirrorOptions,
  type LibgenSearchField,
  type LibgenSearchUrlOptions,
  type LibgenTopic,
} from "./libgen.urls.js";
import type {
  SourceFetchOptions,
  WorkRecord,
  WorksPage,
  WorksQuery,
  WorksSource,
} from "../types.js";

// Re-exported so `parseByteSize` keeps its long-standing public home here
// while the implementation stays shared with the other catalog adapters.
export { parseByteSize } from "../text.js";
export {
  libgenAbsoluteUrl,
  libgenDetailUrl,
  libgenMirrorBase,
  libgenSearchUrl,
  LIBGEN_DEFAULT_PER_PAGE,
  LIBGEN_FICTION_PATH,
  LIBGEN_FILE_PATH,
  LIBGEN_INDEX_PATH,
  LIBGEN_MAX_PER_PAGE,
  LIBGEN_MIN_QUERY_LENGTH,
  LIBGEN_SCIMAG_PATH,
  LIBGEN_SEARCH_PATH,
} from "./libgen.urls.js";
export type {
  LibgenLayout,
  LibgenMirrorOptions,
  LibgenSearchField,
  LibgenSearchUrlOptions,
  LibgenSortBy,
  LibgenSortOrder,
  LibgenTopic,
} from "./libgen.urls.js";

/** The provider name built-in Library Genesis records carry. */
export const LIBGEN_PROVIDER = "libgen";

/**
 * One row of a Library Genesis result table, coerced. `raw` keeps the display
 * strings the mirror served so a caller can audit any coercion this adapter
 * declined to make.
 */
export interface LibgenBook {
  /** Catalog id when the table states one, else the content hash. */
  readonly id: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly publisher?: string;
  readonly year?: number;
  readonly pages?: number;
  readonly language?: string;
  readonly sizeBytes?: number;
  /** Lowercased file extension, e.g. `"epub"`. */
  readonly extension?: string;
  /** Lowercased 32-character content hash, when the row exposes one. */
  readonly md5?: string;
  /** Normalized, checksum-valid ISBNs found in the row. */
  readonly isbns: readonly string[];
  readonly edition?: string;
  readonly series?: string;
  /** ISO instant from an upload-info column, when present. */
  readonly addedAt?: string;
  readonly modifiedAt?: string;
  /** Absolute detail-page URL, resolved against the caller's mirror. */
  readonly detailUrl?: string;
  /** Absolute HTTP(S) mirror links from the row, in table order. */
  readonly mirrorUrls: readonly string[];
  readonly raw: LibgenRawRow;
  /** Per-field notes for values this adapter could not coerce. */
  readonly warnings: readonly string[];
}

/** Display strings exactly as the mirror served them. */
export interface LibgenRawRow {
  readonly id?: string;
  readonly author?: string;
  readonly title?: string;
  readonly publisher?: string;
  readonly year?: string;
  readonly pages?: string;
  readonly language?: string;
  readonly size?: string;
  readonly extension?: string;
  readonly added?: string;
  readonly modified?: string;
}

export interface LibgenPage {
  readonly items: readonly LibgenBook[];
  readonly page: number;
  /** Whether the table was full, implying at least one further page. */
  readonly hasMore: boolean;
  readonly warnings: readonly string[];
  readonly requestUrls: readonly string[];
}

/**
 * Post-parse filters applied to coerced fields. `year` accepts a number or a
 * string; with `exactMatch: false` string filters match case-insensitive
 * substrings, which is how a partial year like `"200"` selects a decade.
 */
export interface LibgenFilters {
  readonly year?: number | string;
  readonly language?: string;
  readonly extension?: string;
  readonly publisher?: string;
  readonly author?: string;
  readonly title?: string;
}

export interface LibgenSearchOptions extends SourceFetchOptions, LibgenSearchUrlOptions {
  readonly filters?: LibgenFilters;
  /** Case-sensitive whole-value filtering; defaults to `true`. */
  readonly exactMatch?: boolean;
  /** Result pages to walk; defaults to 1. */
  readonly maxPages?: number;
}

/** Fetches and parses one result page. */
export async function fetchLibgenBooks(
  query: string,
  options: LibgenSearchOptions,
): Promise<LibgenPage> {
  const url = libgenSearchUrl(query, options);
  const html = await fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  const page = parseLibgenBooks(html, {
    ...options,
    page: options.page ?? 1,
    requestUrl: url,
  });
  return applyFilters(page, options);
}

/**
 * Walks result pages until `limit` records are collected, a page comes back
 * short (the last page), or `maxPages` is reached. Warnings and request URLs
 * accumulate across pages so one bad page is attributable.
 */
export async function searchLibgenBooks(
  query: string,
  options: LibgenSearchOptions,
): Promise<LibgenPage> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) {
    return { items: [], page: options.page ?? 1, hasMore: false, warnings: [], requestUrls: [] };
  }
  const maxPages = normalizeMaxPages(options.maxPages);
  const firstPage = options.page ?? 1;

  const items: LibgenBook[] = [];
  const warnings: string[] = [];
  const requestUrls: string[] = [];
  let hasMore = false;

  for (let offset = 0; offset < maxPages; offset += 1) {
    const page = await fetchLibgenBooks(query, { ...options, page: firstPage + offset });
    items.push(...page.items);
    warnings.push(...page.warnings);
    requestUrls.push(...page.requestUrls);
    hasMore = page.hasMore;
    if (!page.hasMore) break;
    if (limit !== undefined && items.length >= limit) break;
  }

  const limited = limit === undefined ? items : items.slice(0, limit);
  return {
    items: limited,
    page: firstPage,
    hasMore: hasMore || (limit !== undefined && items.length > limited.length),
    warnings: [...new Set(warnings)],
    requestUrls,
  };
}

export interface LibgenParseOptions extends LibgenMirrorOptions {
  /** 1-based page number the HTML came from; defaults to 1. */
  readonly page?: number;
  /** Recorded in `requestUrls` for provenance. */
  readonly requestUrl?: string;
  /** Rows per page, used to infer `hasMore`; defaults to 25. */
  readonly perPage?: number;
}

/**
 * Parses a result table into coerced rows. Pure: fixture HTML in, rows out.
 *
 * Throws a `config`-coded `XnewsFetchError` when the document contains no
 * recognizable result table at all, because that means the layout moved and a
 * silent empty array would read as "no matches".
 */
export function parseLibgenBooks(html: string, options: LibgenParseOptions): LibgenPage {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? LIBGEN_DEFAULT_PER_PAGE;
  const requestUrls = options.requestUrl === undefined ? [] : [options.requestUrl];
  const warnings: string[] = [];

  const explicitEmpty = hasExactHtmlState(html, EXPLICIT_EMPTY_STATES);
  if (explicitEmpty) {
    return { items: [], page, hasMore: false, warnings, requestUrls };
  }
  const table = selectResultTable(html);
  if (table === undefined) {
    // Anything without a result table or an exact no-results state is not a
    // valid result page.
    throw new XnewsFetchError(
      "config",
      "Library Genesis response contained no recognizable result table; the mirror layout may have changed or the request was blocked",
      { url: options.requestUrl ?? libgenMirrorBase(options.baseUrl) },
    );
  }

  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? "");
  const columns = mapColumns(
    rows,
    warnings,
    options.requestUrl ?? libgenMirrorBase(options.baseUrl),
  );
  const items: LibgenBook[] = [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(
      (match) => match[1] ?? "",
    );
    // Header rows, spacer rows, and pager rows.
    if (cells.length < 3) continue;
    if (isHeaderRow(cells)) continue;
    const book = parseRow(cells, columns, options);
    if (book !== undefined) items.push(book);
  }

  for (const book of items) warnings.push(...book.warnings);
  if (items.length === 0) {
    throw new XnewsFetchError(
      "config",
      "Library Genesis response yielded no usable records from its result table; the mirror layout may have changed or the request was blocked",
      { url: options.requestUrl ?? libgenMirrorBase(options.baseUrl) },
    );
  }
  return {
    items,
    page,
    hasMore: items.length >= perPage,
    warnings: [...new Set(warnings)],
    requestUrls,
  };
}

/** Maps one row onto the works lane's normalized record. */
export function libgenBookToWorkRecord(book: LibgenBook, options: LibgenMirrorOptions): WorkRecord {
  const identity = {
    ...isbnIdentity(book.isbns),
    ...(book.md5 === undefined ? {} : { md5: book.md5 }),
    origin: "record" as const,
    confidence: 1,
  };
  const url = book.detailUrl ?? libgenDetailUrl(book.id, options);
  return {
    provider: LIBGEN_PROVIDER,
    sourceId: book.id,
    title: book.title,
    authors: book.authors,
    ...(book.publisher === undefined ? {} : { publisher: book.publisher }),
    ...(book.year === undefined ? {} : { publishedYear: book.year }),
    ...(book.edition === undefined ? {} : { edition: book.edition }),
    ...(book.series === undefined ? {} : { series: book.series }),
    ...(book.language === undefined ? {} : { language: book.language }),
    ...(book.extension === undefined ? {} : { format: book.extension }),
    ...(book.pages === undefined ? {} : { pageCount: book.pages }),
    ...(book.sizeBytes === undefined ? {} : { sizeBytes: book.sizeBytes }),
    identity,
    // The catalog states no availability metadata.
    availability: "unknown",
    url,
    ...(book.addedAt === undefined ? {} : { addedAt: book.addedAt }),
    ...(book.modifiedAt === undefined ? {} : { modifiedAt: book.modifiedAt }),
    warnings: book.warnings,
    provenance: [{ provider: LIBGEN_PROVIDER, url }],
  };
}

export interface LibgenSourceOptions extends Omit<LibgenSearchOptions, "baseUrl"> {
  /**
   * Mirror origins, tried in order until one answers. At least one is
   * required; load a deployment-local list with `loadMirrorList` and
   * `mirrorBaseUrls`.
   */
  readonly mirrors: readonly string[];
  /**
   * Topics to search; defaults to `["libgen", "fiction"]` so a plain book
   * lookup covers both partitions of a typical mirror.
   */
  readonly topics?: readonly LibgenTopic[];
}

/**
 * Binds a caller-supplied mirror pool to the works lane. Pass the result to
 * `searchWorks` for the shared non-throwing envelope, or to
 * `resolveWorkIdentity` as the record side of an identity match.
 *
 * Mirrors are tried in order and only a *throw* advances to the next one, so
 * a mirror that legitimately matched nothing ends the search instead of
 * being papered over by the next mirror's hits. Every mirror that failed
 * first is named in the page's warnings.
 *
 * Throws nothing here: an empty pool or an unusable origin surfaces as a
 * `config` error from `search`, which `searchWorks` reports as
 * `status: "disabled"`.
 */
export function libgenSource(options: LibgenSourceOptions): WorksSource {
  const topics = options.topics ?? (["libgen", "fiction"] as const);
  return {
    provider: LIBGEN_PROVIDER,
    requestUrls(query) {
      const resolved = resolveQuery(query, options);
      return options.mirrors.map((baseUrl) =>
        libgenSearchUrl(resolved.term, { ...options, ...resolved.urlOptions, topics, baseUrl }),
      );
    },
    async search(query) {
      const resolved = resolveQuery(query, options);
      if (options.mirrors.length === 0) {
        throw new XnewsFetchError("config", "Library Genesis requires at least one mirror origin", {
          url: "",
        });
      }
      const outcome = await withMirrorFailover(options.mirrors, (baseUrl) =>
        searchLibgenBooks(resolved.term, {
          ...options,
          ...query,
          ...resolved.urlOptions,
          topics,
          baseUrl,
        }),
      );
      const page = outcome.value;
      const mirrorOptions = { ...options, baseUrl: outcome.baseUrl };
      return {
        items: page.items.map((book) => libgenBookToWorkRecord(book, mirrorOptions)),
        page: page.page,
        hasMore: page.hasMore,
        warnings: [
          ...page.warnings,
          ...resolved.warnings,
          ...outcome.attempts.map(
            (attempt) =>
              `libgen: mirror ${attempt.baseUrl} failed (${attempt.code}); tried the next in the pool`,
          ),
        ],
        requestUrls: page.requestUrls,
      } satisfies WorksPage;
    },
  };
}

/**
 * Resolves a row's download links by fetching one of its mirror pages.
 * Keys are the labels the mirror page uses (e.g. `"GET"`, `"Cloudflare"`,
 * `"IPFS.io"`).
 */
export async function resolveLibgenDownloads(
  book: LibgenBook,
  options: LibgenMirrorOptions & SourceFetchOptions,
): Promise<Record<string, string>> {
  const mirrorUrl = book.mirrorUrls[0];
  if (mirrorUrl === undefined) {
    throw new XnewsFetchError("config", `Library Genesis row ${book.id} exposed no mirror links`, {
      url: libgenMirrorBase(options.baseUrl),
    });
  }
  const html = await fetchText(mirrorUrl, options, options.userAgent ?? BROWSERISH_USER_AGENT);
  const links = parseLibgenDownloads(html, { ...options, baseUrl: mirrorUrl });
  if (Object.keys(links).length > 0 || hasExactHtmlState(html, EXPLICIT_NO_LINKS_STATES)) {
    return links;
  }
  throw new XnewsFetchError(
    "config",
    "Library Genesis mirror page contained no recognized file links; the mirror layout may have changed or the request was blocked",
    { url: mirrorUrl },
  );
}

/** Whole anchor: group 1 is the attribute span, group 2 the link text. */
const ANCHOR = elementPattern("a");

/** Opening anchor tag only, for cells whose `</a>` may be misnested. */
const OPEN_ANCHOR = openTagPattern("a");

const HREF = /href=["']([^"']+)["']/i;

/**
 * Parses labelled download links out of a mirror page. Pure.
 *
 * A link qualifies on its target, not on its text. Mirror pages carry a
 * `Mirrors` heading and `Mirror list` sort links whose labels match any
 * sensible label whitelist while pointing at `/index.php` search URLs; keying
 * on the label alone hands the caller a search page labelled as a download.
 */
export function parseLibgenDownloads(
  html: string,
  options: LibgenMirrorOptions,
): Record<string, string> {
  const links: Record<string, string> = {};
  for (const match of html.matchAll(ANCHOR)) {
    const href = HREF.exec(match[1] ?? "")?.[1];
    const label = cleanText(match[2] ?? "");
    if (href === undefined || label === "") continue;
    const decoded = decodeEntities(href);
    if (!FILE_LINK.test(decoded)) continue;
    const absolute = libgenAbsoluteUrl(decoded, options);
    if (absolute === undefined) continue;
    links[label] ??= absolute;
  }
  return links;
}

/**
 * Targets that actually serve a file: a content hash, one of the mirror
 * endpoints, or a direct file extension on an off-mirror host.
 */
const FILE_LINK =
  /md5=|\/(?:ads|get|file|download|main|fiction|scimag)\b|\.(?:epub|pdf|mobi|azw3?|djvu|fb2|cbr|cbz|txt|rtf|zip)(?:$|\?)/i;

interface ColumnMap {
  readonly id?: number;
  readonly author?: number;
  readonly title?: number;
  readonly publisher?: number;
  readonly year?: number;
  readonly pages?: number;
  readonly language?: number;
  readonly size?: number;
  readonly extension?: number;
  readonly added?: number;
  readonly modified?: number;
  readonly mirrors: readonly number[];
}

/** Header text to column, lowercased and punctuation-stripped. */
const COLUMN_SYNONYMS: Record<string, keyof Omit<ColumnMap, "mirrors">> = {
  id: "id",
  author: "author",
  authors: "author",
  "author s": "author",
  title: "title",
  "title series": "title",
  "series title": "title",
  publisher: "publisher",
  year: "year",
  pages: "pages",
  pp: "pages",
  language: "language",
  lang: "language",
  size: "size",
  filesize: "size",
  "file size": "size",
  ext: "extension",
  extension: "extension",
  type: "extension",
  format: "extension",
  added: "added",
  "date added": "added",
  "time added": "added",
  uploaded: "added",
  modified: "modified",
  "last modified": "modified",
  edited: "modified",
};

const MIRROR_HEADERS = /^(mirror|mirrors|download|dl|links?|get)$/;

/** Column order of the classic nine-column table, used only without a header. */
const POSITIONAL_COLUMNS: ColumnMap = {
  id: 0,
  author: 1,
  title: 2,
  publisher: 3,
  year: 4,
  pages: 5,
  language: 6,
  size: 7,
  extension: 8,
  mirrors: [9, 10, 11, 12, 13],
};

/**
 * Which column a header cell means when it names several.
 *
 * Forks pack multiple sort links into one cell: libgen.li's first cell reads
 * `ID / Time add. / Title / Series` and holds the title, series, ISBNs, and
 * edition link, so it is the title column despite naming three other things.
 * Ordering is by how strongly a word identifies the cell's payload, which is
 * why `id` — present in almost every composite cell — ranks last.
 */
const COMPOSITE_PRIORITY: readonly (keyof Omit<ColumnMap, "mirrors">)[] = [
  "title",
  "author",
  "publisher",
  "year",
  "language",
  "pages",
  "size",
  "extension",
  "modified",
  "added",
  "id",
];

/** One whole-word pattern per column, built once from the synonym table. */
const COLUMN_WORD_PATTERNS: readonly (readonly [keyof Omit<ColumnMap, "mirrors">, RegExp])[] =
  COMPOSITE_PRIORITY.map((column) => {
    const synonyms = Object.entries(COLUMN_SYNONYMS)
      .filter(([, mapped]) => mapped === column)
      .map(([synonym]) => synonym.replaceAll(" ", "\\s+"));
    return [column, new RegExp(`\\b(?:${synonyms.join("|")})\\b`)] as const;
  });

/**
 * Reads one normalized header cell. An exact synonym wins outright; failing
 * that the cell is treated as composite and the highest-priority column word
 * it contains wins.
 */
function headerColumn(cell: string): keyof Omit<ColumnMap, "mirrors"> | undefined {
  const exact = COLUMN_SYNONYMS[cell];
  if (exact !== undefined) return exact;
  for (const [column, pattern] of COLUMN_WORD_PATTERNS) {
    if (pattern.test(cell)) return column;
  }
  return undefined;
}

function mapColumns(rows: readonly string[], warnings: string[], url: string): ColumnMap {
  let firstRowSeen = false;
  let presentHeader: readonly string[] | undefined;

  for (const row of rows) {
    const labels = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) =>
      cleanText(match[1] ?? ""),
    );
    const cells = labels.map(normalizeHeader);
    const hasHeaderCells = /<th\b/i.test(row);
    if (cells.length < 3) {
      if (hasHeaderCells && presentHeader === undefined) presentHeader = labels;
      continue;
    }

    const isFirstRow = !firstRowSeen;
    firstRowSeen = true;
    const hasLabelOnlyFirstRow =
      isFirstRow && labels.every((label) => label !== "" && !/^\d/.test(label));
    const mapped: Record<string, number> = {};
    const mirrors: number[] = [];
    let hits = 0;
    for (const [index, cell] of cells.entries()) {
      if (MIRROR_HEADERS.test(cell)) {
        mirrors.push(index);
        hits += 1;
        continue;
      }
      const column = headerColumn(cell);
      if (column !== undefined) {
        mapped[column] ??= index;
        hits += 1;
      }
    }
    // A real header names most of its columns; a data row that happens to
    // contain the word "title" will not.
    if (hits >= 4 && mapped["title"] !== undefined) {
      return { ...(mapped as Omit<ColumnMap, "mirrors">), mirrors };
    }
    if ((hasHeaderCells || hasLabelOnlyFirstRow) && presentHeader === undefined) {
      presentHeader = labels;
    }
  }

  if (presentHeader !== undefined) {
    const unmapped = presentHeader.filter((label) => {
      const normalized = normalizeHeader(label);
      return (
        normalized !== "" &&
        headerColumn(normalized) === undefined &&
        !MIRROR_HEADERS.test(normalized)
      );
    });
    const names =
      unmapped.length === 0
        ? "none (fewer than four recognized columns, including Title)"
        : unmapped.map((label) => JSON.stringify(label)).join(", ");
    throw new XnewsFetchError(
      "config",
      `Library Genesis result-table header could not be mapped confidently; unmapped columns: ${names}`,
      { url },
    );
  }

  warnings.push(
    "libgen: no recognizable header row; fell back to the classic positional column layout",
  );
  return POSITIONAL_COLUMNS;
}

function isHeaderRow(cells: readonly string[]): boolean {
  let named = 0;
  for (const cell of cells) {
    const normalized = normalizeHeader(cell);
    if (headerColumn(normalized) !== undefined || MIRROR_HEADERS.test(normalized)) named += 1;
  }
  return named >= 3;
}

function parseRow(
  cells: readonly string[],
  columns: ColumnMap,
  options: LibgenMirrorOptions,
): LibgenBook | undefined {
  const warnings: string[] = [];
  const titleCell = cellAt(cells, columns.title);
  const titleParts = parseTitleCell(titleCell ?? "");
  const md5 = findMd5(cells);
  const rawId = cleanText(cellAt(cells, columns.id) ?? "");
  const id = /^\d+$/.test(rawId) ? rawId : (md5 ?? detailId(titleCell ?? "") ?? "");
  if (titleParts.title === "" || id === "") return undefined;

  const rawYear = cleanText(cellAt(cells, columns.year) ?? "");
  const rawPages = cleanText(cellAt(cells, columns.pages) ?? "");
  const rawSize = cleanText(cellAt(cells, columns.size) ?? "");
  const rawExtension = cleanText(cellAt(cells, columns.extension) ?? "");
  const rawAuthor = cleanText(cellAt(cells, columns.author) ?? "");
  const rawPublisher = cleanText(cellAt(cells, columns.publisher) ?? "");
  const rawLanguage = cleanText(cellAt(cells, columns.language) ?? "");
  const rawAdded = cleanText(cellAt(cells, columns.added) ?? "");
  const rawModified = cleanText(cellAt(cells, columns.modified) ?? "");

  const year = parseCatalogYear(rawYear);
  if (rawYear !== "" && year === undefined) {
    warnings.push(`libgen ${id}: unparseable year ${JSON.stringify(rawYear)}`);
  }
  const pages = parsePageCount(rawPages);
  // Mirrors write `0`, and `0 / 604` for "none stated / present in file", to
  // mean "not stated". Any other nonempty value that cannot be coerced is
  // worth a warning so a changed cell format cannot fail silently.
  const isMissingPageCount = /^0(?:\s*\/\s*\d+)?$/.test(rawPages);
  if (rawPages !== "" && pages === undefined && !isMissingPageCount) {
    warnings.push(`libgen ${id}: unparseable page count ${JSON.stringify(rawPages)}`);
  }
  const sizeBytes = parseByteSize(rawSize);
  if (rawSize !== "" && sizeBytes === undefined) {
    warnings.push(`libgen ${id}: unparseable size ${JSON.stringify(rawSize)}`);
  }
  const addedAt = parseCatalogInstant(rawAdded);
  const modifiedAt = parseCatalogInstant(rawModified);
  if (rawAdded !== "" && addedAt === undefined) {
    warnings.push(`libgen ${id}: unparseable added date ${JSON.stringify(rawAdded)}`);
  }
  if (rawModified !== "" && modifiedAt === undefined) {
    warnings.push(`libgen ${id}: unparseable modified date ${JSON.stringify(rawModified)}`);
  }

  const detailUrl = detailLink(titleCell ?? "", options);
  return {
    id,
    title: titleParts.title,
    authors: parseAuthors(rawAuthor),
    ...(rawPublisher === "" ? {} : { publisher: rawPublisher }),
    ...(year === undefined ? {} : { year }),
    ...(pages === undefined ? {} : { pages }),
    ...(rawLanguage === "" ? {} : { language: rawLanguage }),
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    ...(rawExtension === "" ? {} : { extension: rawExtension.toLowerCase() }),
    ...(md5 === undefined ? {} : { md5 }),
    isbns: titleParts.isbns,
    ...(titleParts.edition === undefined ? {} : { edition: titleParts.edition }),
    ...(titleParts.series === undefined ? {} : { series: titleParts.series }),
    ...(addedAt === undefined ? {} : { addedAt }),
    ...(modifiedAt === undefined ? {} : { modifiedAt }),
    ...(detailUrl === undefined ? {} : { detailUrl }),
    mirrorUrls: mirrorLinks(cells, columns, options),
    raw: {
      ...(rawId === "" ? {} : { id: rawId }),
      ...(rawAuthor === "" ? {} : { author: rawAuthor }),
      ...(titleCell === undefined ? {} : { title: cleanText(titleCell) }),
      ...(rawPublisher === "" ? {} : { publisher: rawPublisher }),
      ...(rawYear === "" ? {} : { year: rawYear }),
      ...(rawPages === "" ? {} : { pages: rawPages }),
      ...(rawLanguage === "" ? {} : { language: rawLanguage }),
      ...(rawSize === "" ? {} : { size: rawSize }),
      ...(rawExtension === "" ? {} : { extension: rawExtension }),
      ...(rawAdded === "" ? {} : { added: rawAdded }),
      ...(rawModified === "" ? {} : { modified: rawModified }),
    },
    warnings,
  };
}

interface TitleCell {
  readonly title: string;
  readonly isbns: readonly string[];
  readonly edition?: string;
  readonly series?: string;
}

const EDITION = /\[?\b(\d{1,2})(?:st|nd|rd|th)?\s*ed(?:ition|\.)?\b\]?/i;

/**
 * Splits a title cell into title, ISBNs, edition, and series.
 *
 * The cell mixes all four: one anchor carries the title, a sibling anchor may
 * link the series (its href selects the series column), and loose text carries
 * an edition marker and a comma-separated ISBN list. The Python wrappers
 * discard the ISBNs, which is exactly the join key the works lane needs, so
 * they are extracted here and checksum-validated — a nine-digit catalog id or
 * a page range reads as an ISBN-10 otherwise.
 */
export function parseTitleCell(cell: string): TitleCell {
  let title = "";
  let series: string | undefined;
  for (const match of cell.matchAll(ANCHOR)) {
    const text = cleanText(match[2] ?? "");
    if (text === "") continue;
    if (/column=series|topics?\[\]=s\b/i.test(match[1] ?? "")) series ??= text;
    else title ||= text;
  }

  const fullText = cleanText(cell);
  if (title === "") title = fullText;

  const isbns = extractIsbns(fullText);

  const edition = EDITION.exec(fullText)?.[1];
  const bareTitle = title
    .replace(EDITION, "")
    .replace(/[\s,;]+$/, "")
    .trim();
  return {
    title: bareTitle === "" ? title : bareTitle,
    isbns,
    ...(edition === undefined ? {} : { edition }),
    ...(series === undefined ? {} : { series }),
  };
}

/** `"410"` or `"410[12]"` (pages with a secondary count) to a page count. */
export function parsePageCount(value: string): number | undefined {
  const match = /^(\d+)/.exec(value.trim());
  if (match === null) return undefined;
  const pages = Number(match[1]);
  return Number.isInteger(pages) && pages > 0 ? pages : undefined;
}

function parseCatalogYear(value: string): number | undefined {
  const match = /\b(1[4-9]\d{2}|20\d{2}|21\d{2})\b/.exec(value.trim());
  if (match === null) return undefined;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : undefined;
}

/**
 * Normalizes a mirror timestamp through the package's one date derivation.
 * Mirrors serve `YYYY-MM-DD HH:MM:SS` without a zone, which that derivation
 * reads as UTC rather than letting the host's zone shift the date. An
 * `engine`-tagged result is refused, because a mirror that stamped something
 * the engine had to guess at has not stated a catalog date.
 */
function parseCatalogInstant(value: string): string | undefined {
  if (value === "") return undefined;
  const parsed = parsePublishedAt(value);
  return parsed !== null && parsed.format !== "engine" ? parsed.instant : undefined;
}

function parseAuthors(value: string): readonly string[] {
  if (value === "") return [];
  return [
    ...new Set(
      value
        .split(/[;\n]|,(?=\s*[A-Z][^,]*\s)/)
        .map((part) => part.trim())
        .filter((part) => part !== "" && part !== "-"),
    ),
  ];
}

function cellAt(cells: readonly string[], index: number | undefined): string | undefined {
  return index === undefined ? undefined : cells[index];
}

function findMd5(cells: readonly string[]): string | undefined {
  for (const cell of cells) {
    const fromLink = /md5=([a-fA-F0-9]{32})/.exec(cell);
    if (fromLink?.[1] !== undefined) return fromLink[1].toLowerCase();
  }
  for (const cell of cells) {
    const bare = /^\s*([a-fA-F0-9]{32})\s*$/.exec(cleanText(cell));
    if (bare?.[1] !== undefined) return bare[1].toLowerCase();
  }
  return undefined;
}

function detailId(titleCell: string): string | undefined {
  const match = /[?&]id=(\d+)/.exec(titleCell);
  return match?.[1];
}

function detailLink(titleCell: string, options: LibgenMirrorOptions): string | undefined {
  const attributes = OPEN_ANCHOR.exec(titleCell)?.[1];
  const href = attributes === undefined ? undefined : HREF.exec(attributes)?.[1];
  return href === undefined ? undefined : libgenAbsoluteUrl(decodeEntities(href), options);
}

function mirrorLinks(
  cells: readonly string[],
  columns: ColumnMap,
  options: LibgenMirrorOptions,
): readonly string[] {
  const urls: string[] = [];
  const indexes = columns.mirrors.length > 0 ? columns.mirrors : cells.map((_, index) => index);
  for (const index of indexes) {
    const cell = cells[index];
    if (cell === undefined) continue;
    for (const match of cell.matchAll(/href=["']([^"']+)["']/gi)) {
      const href = match[1];
      if (href === undefined) continue;
      // Only file links, never the pager or the column-sort links.
      if (!/md5=|\/(?:ads|get|file)\b/i.test(href)) continue;
      const absolute = libgenAbsoluteUrl(decodeEntities(href), options);
      if (absolute !== undefined && !urls.includes(absolute)) urls.push(absolute);
    }
  }
  return urls;
}

function selectResultTable(html: string): string | undefined {
  const source = stripScripts(html);
  let best: string | undefined;
  let bestScore = 0;
  for (const match of source.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const table = match[1] ?? "";
    // Nested tables show up inside layout tables; score on evidence of rows
    // that actually describe files. A mirror that returns a single hit emits
    // one row and no header, so rows alone cannot be the gate — an md5 link
    // is what makes a row a file row.
    const rows = (table.match(/<tr\b/gi) ?? []).length;
    const fileLinks = (table.match(/md5=/gi) ?? []).length;
    const headers = (table.match(/<th\b/gi) ?? []).length;
    const score = fileLinks * 4 + headers * 2 + rows;
    if ((rows >= 2 || fileLinks > 0) && score > bestScore) {
      bestScore = score;
      best = table;
    }
  }
  return best;
}

const EXPLICIT_EMPTY_STATES: Readonly<Record<string, true>> = {
  "nothing found": true,
  "no files found": true,
  "no files were found": true,
};
const EXPLICIT_NO_LINKS_STATES: Readonly<Record<string, true>> = {
  "no links": true,
  "no links found": true,
  "no download links": true,
  "no download links found": true,
  "no download links available": true,
  "no downloads available": true,
};

function hasExactHtmlState(html: string, states: Readonly<Record<string, true>>): boolean {
  const fragments = stripScripts(html)
    .replaceAll(/<\/[a-z][^>]*>/gi, "\n")
    .split("\n");
  for (const fragment of fragments) {
    const state = cleanText(fragment).toLowerCase().replace(/[.!]$/, "");
    if (states[state] === true) return true;
  }
  return false;
}

function stripScripts(html: string): string {
  return html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

function normalizeHeader(cell: string): string {
  return cleanText(cell)
    .toLowerCase()
    .replaceAll(/[^a-z ]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function applyFilters(page: LibgenPage, options: LibgenSearchOptions): LibgenPage {
  const filters = options.filters;
  if (filters === undefined) return page;
  const exact = options.exactMatch !== false;
  const items = page.items.filter((book) => matchesFilters(book, filters, exact));
  return { ...page, items };
}

function matchesFilters(book: LibgenBook, filters: LibgenFilters, exact: boolean): boolean {
  if (filters.year !== undefined) {
    const actual = book.year === undefined ? (book.raw.year ?? "") : String(book.year);
    if (!textMatches(actual, String(filters.year), exact)) return false;
  }
  if (
    filters.language !== undefined &&
    !textMatches(book.language ?? "", filters.language, exact)
  ) {
    return false;
  }
  if (
    filters.extension !== undefined &&
    !textMatches(book.extension ?? "", filters.extension, exact)
  ) {
    return false;
  }
  if (
    filters.publisher !== undefined &&
    !textMatches(book.publisher ?? "", filters.publisher, exact)
  ) {
    return false;
  }
  if (filters.title !== undefined && !textMatches(book.title, filters.title, exact)) return false;
  if (filters.author !== undefined) {
    const joined = book.authors.join(", ");
    if (!textMatches(joined, filters.author, exact)) return false;
  }
  return true;
}

function textMatches(actual: string, expected: string, exact: boolean): boolean {
  return exact ? actual === expected : actual.toLowerCase().includes(expected.toLowerCase());
}

interface ResolvedQuery {
  readonly term: string;
  readonly urlOptions: { readonly searchField: LibgenSearchField };
  readonly warnings: readonly string[];
}

function resolveQuery(query: WorksQuery, options: LibgenSourceOptions): ResolvedQuery {
  const warnings: string[] = [];
  if (query.isbn !== undefined && query.isbn.trim() !== "") {
    return { term: query.isbn.trim(), urlOptions: { searchField: "isbn" }, warnings };
  }
  if (query.doi !== undefined && query.doi.trim() !== "") {
    const topics = options.topics ?? [];
    if (!topics.includes("articles")) {
      warnings.push(
        'libgen: DOI lookup needs the "articles" topic; searching the configured topics by free text instead',
      );
    }
    return { term: query.doi.trim(), urlOptions: { searchField: "default" }, warnings };
  }
  if (query.title !== undefined && query.title.trim() !== "") {
    return { term: query.title.trim(), urlOptions: { searchField: "title" }, warnings };
  }
  if (query.author !== undefined && query.author.trim() !== "") {
    return { term: query.author.trim(), urlOptions: { searchField: "author" }, warnings };
  }
  const term = query.query?.trim() ?? "";
  if (term.length < LIBGEN_MIN_QUERY_LENGTH) {
    throw new XnewsFetchError(
      "config",
      `Library Genesis needs a query of at least ${LIBGEN_MIN_QUERY_LENGTH} characters; set query, title, author, or isbn`,
      { url: "" },
    );
  }
  return { term, urlOptions: { searchField: "default" }, warnings };
}

function normalizeMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) return 1;
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new RangeError("maxPages must be a positive integer");
  }
  return maxPages;
}

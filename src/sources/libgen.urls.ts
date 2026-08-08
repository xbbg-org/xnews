/**
 * URL builders for a caller-supplied Library Genesis mirror.
 *
 * Mirror hostnames rotate, so every builder requires a `baseUrl`.
 *
 * Two request layouts are supported because the forks diverged:
 *
 * - `"classic"` — `search.php?req=&column=&page=&res=`, with separate
 *   `/fiction/` and `/scimag/` endpoints. Used by the older lineage.
 * - `"index"` — `index.php?req=&columns[]=&objects[]=&topics[]=&res=`, which
 *   searches several topics in one request.
 *
 * Neither layout is a stable published API. `extraParams` exists so a caller
 * whose mirror expects a differently spelled parameter can correct it without
 * waiting for a release, and the row parser in `./libgen.ts` maps columns from
 * the result table's own header rather than fixed positions for the same
 * reason.
 */

import { XnewsFetchError } from "../errors.js";

/** Result-table request shape a mirror expects. */
export type LibgenLayout = "classic" | "index";

/** Catalog partition to search. Not every mirror carries every topic. */
export type LibgenTopic =
  | "libgen"
  | "comics"
  | "fiction"
  | "articles"
  | "magazines"
  | "fiction-rus"
  | "standards";

/** Metadata column(s) a query is matched against. */
export type LibgenSearchField =
  | "default"
  | "title"
  | "author"
  | "series"
  | "year"
  | "publisher"
  | "isbn"
  | "md5";

export type LibgenSortBy =
  | "default"
  | "title"
  | "author"
  | "publisher"
  | "year"
  | "pages"
  | "size"
  | "extension"
  | "added";

export type LibgenSortOrder = "asc" | "desc";

export const LIBGEN_SEARCH_PATH = "/search.php";
export const LIBGEN_INDEX_PATH = "/index.php";
export const LIBGEN_FICTION_PATH = "/fiction/";
export const LIBGEN_SCIMAG_PATH = "/scimag/";
export const LIBGEN_FILE_PATH = "/file.php";

/** Mirrors cap page size; 100 is the largest all known forks accept. */
export const LIBGEN_MAX_PER_PAGE = 100;
export const LIBGEN_DEFAULT_PER_PAGE = 25;

/** Shortest query the mirrors accept without erroring. */
export const LIBGEN_MIN_QUERY_LENGTH = 3;

/** `topics[]` codes for the `"index"` layout. */
const TOPIC_CODES: Record<LibgenTopic, string> = {
  libgen: "l",
  comics: "c",
  fiction: "f",
  articles: "a",
  magazines: "m",
  "fiction-rus": "r",
  standards: "s",
};

/** `columns[]` codes for the `"index"` layout. */
const INDEX_COLUMN_CODES: Record<LibgenSearchField, readonly string[]> = {
  // The mirror's own default set: title, author, series, year, publisher, ISBN.
  default: ["t", "a", "s", "y", "p", "i"],
  title: ["t"],
  author: ["a"],
  series: ["s"],
  year: ["y"],
  publisher: ["p"],
  isbn: ["i"],
  md5: ["m"],
};

/** `column=` values for the `"classic"` layout. */
const CLASSIC_COLUMNS: Record<LibgenSearchField, string> = {
  default: "def",
  title: "title",
  author: "author",
  series: "series",
  year: "year",
  publisher: "publisher",
  isbn: "identifier",
  md5: "md5",
};

const CLASSIC_SORTS: Record<LibgenSortBy, string> = {
  default: "def",
  title: "title",
  author: "author",
  publisher: "publisher",
  year: "year",
  pages: "pages",
  size: "filesize",
  extension: "extension",
  added: "timeadded",
};

export interface LibgenMirrorOptions {
  /**
   * Absolute origin of the mirror to query, e.g. `https://example.org` or
   * `https://example.org/libgen`. Required: there is no default.
   */
  readonly baseUrl: string;
  /** Request layout the mirror expects; defaults to `"index"`. */
  readonly layout?: LibgenLayout;
}

export interface LibgenSearchUrlOptions extends LibgenMirrorOptions {
  /** Catalog partitions to search; defaults to `["libgen"]`. */
  readonly topics?: readonly LibgenTopic[];
  /** Columns the query matches; defaults to `"default"`. */
  readonly searchField?: LibgenSearchField;
  /** 1-based result page; defaults to 1. */
  readonly page?: number;
  /** Rows per page, capped at `LIBGEN_MAX_PER_PAGE`; defaults to 25. */
  readonly perPage?: number;
  readonly sortBy?: LibgenSortBy;
  readonly sortOrder?: LibgenSortOrder;
  /** Adds the upload/modification timestamp columns to the result table. */
  readonly includeUploadInfo?: boolean;
  /**
   * Extra or corrected query parameters, applied last so they win. Use this
   * when a mirror spells a parameter differently than the layouts above.
   */
  readonly extraParams?: Readonly<Record<string, string>>;
}

/**
 * Builds a result-table URL for one query. Throws a `config`-coded
 * `XnewsFetchError` when `baseUrl` is missing or unusable, or when the query
 * is shorter than `LIBGEN_MIN_QUERY_LENGTH`, so a misconfigured caller fails
 * before any request instead of dialing a mirror with a query it will reject.
 */
export function libgenSearchUrl(query: string, options: LibgenSearchUrlOptions): string {
  const trimmed = query.trim();
  if (trimmed.length < LIBGEN_MIN_QUERY_LENGTH) {
    throw new XnewsFetchError(
      "config",
      `Library Genesis queries must be at least ${LIBGEN_MIN_QUERY_LENGTH} characters; received ${JSON.stringify(query)}`,
      { url: options.baseUrl ?? "" },
    );
  }

  const layout = options.layout ?? "index";
  const topics =
    options.topics === undefined || options.topics.length === 0
      ? (["libgen"] as const)
      : options.topics;
  const searchField = options.searchField ?? "default";
  const page = normalizePage(options.page, options.baseUrl);
  const perPage = normalizePerPage(options.perPage, options.baseUrl);

  const url =
    layout === "classic"
      ? classicSearchUrl(trimmed, topics, searchField, options)
      : indexSearchUrl(trimmed, topics, searchField, options);

  if (page > 1) url.searchParams.set("page", String(page));
  url.searchParams.set("res", String(perPage));
  for (const [key, value] of Object.entries(options.extraParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Builds the record's detail page URL from its numeric catalog id. Mirrors
 * that serve details from a different path need `extraParams`-style overrides
 * at the call site; pass the row's own detail link to `libgenAbsoluteUrl`
 * instead when the result table supplied one.
 */
export function libgenDetailUrl(id: string, options: LibgenMirrorOptions): string {
  const url = mirrorUrl(options.baseUrl, LIBGEN_FILE_PATH);
  url.searchParams.set("id", id);
  return url.toString();
}

/**
 * Resolves a possibly relative link from a result table against the mirror.
 * Returns `undefined` for links that are not HTTP(S) — mirrors sometimes emit
 * `magnet:` or onion links, which xnews neither follows nor rewrites.
 */
export function libgenAbsoluteUrl(link: string, options: LibgenMirrorOptions): string | undefined {
  try {
    const url = new URL(link, mirrorBase(options.baseUrl));
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Normalized mirror origin, for provenance and relative-link resolution. */
export function libgenMirrorBase(baseUrl: string): string {
  return mirrorBase(baseUrl).toString();
}

function classicSearchUrl(
  query: string,
  topics: readonly LibgenTopic[],
  searchField: LibgenSearchField,
  options: LibgenSearchUrlOptions,
): URL {
  // The classic lineage takes exactly one topic and serves fiction and
  // articles from dedicated endpoints. Silently choosing one partition would
  // turn valid hits in every other configured partition into plausible misses.
  if (topics.length > 1) {
    throw new XnewsFetchError(
      "config",
      `Library Genesis classic layout accepts exactly one topic; received ${topics.length}: ${topics.join(", ")}`,
      { url: options.baseUrl },
    );
  }
  const topic = topics[0] ?? "libgen";
  const path =
    topic === "fiction" || topic === "fiction-rus"
      ? LIBGEN_FICTION_PATH
      : topic === "articles"
        ? LIBGEN_SCIMAG_PATH
        : LIBGEN_SEARCH_PATH;
  const url = mirrorUrl(options.baseUrl, path);

  if (path === LIBGEN_SEARCH_PATH) {
    url.searchParams.set("req", query);
    url.searchParams.set("column", CLASSIC_COLUMNS[searchField]);
    if (options.sortBy !== undefined && options.sortBy !== "default") {
      url.searchParams.set("sort", CLASSIC_SORTS[options.sortBy]);
      url.searchParams.set("sortmode", (options.sortOrder ?? "desc").toUpperCase());
    }
    if (options.includeUploadInfo === true) url.searchParams.set("view", "detailed");
    return url;
  }

  // `/fiction/` and `/scimag/` take a bare `q`.
  url.searchParams.set("q", query);
  return url;
}

function indexSearchUrl(
  query: string,
  topics: readonly LibgenTopic[],
  searchField: LibgenSearchField,
  options: LibgenSearchUrlOptions,
): URL {
  const url = mirrorUrl(options.baseUrl, LIBGEN_INDEX_PATH);
  url.searchParams.set("req", query);
  for (const column of INDEX_COLUMN_CODES[searchField]) {
    url.searchParams.append("columns[]", column);
  }
  for (const topic of topics) {
    url.searchParams.append("topics[]", TOPIC_CODES[topic]);
    // This fork keys result objects on the same codes as topics.
    url.searchParams.append("objects[]", TOPIC_CODES[topic]);
  }
  // Without this the fork restricts results to files it currently hosts.
  url.searchParams.set("filesuns", "all");
  if (options.sortBy !== undefined && options.sortBy !== "default") {
    url.searchParams.set("order", CLASSIC_SORTS[options.sortBy]);
    url.searchParams.set("ordermode", options.sortOrder ?? "desc");
  }
  if (options.includeUploadInfo === true) url.searchParams.set("showch", "on");
  return url;
}

function mirrorUrl(baseUrl: string, path: string): URL {
  const base = mirrorBase(baseUrl);
  // `path` is a package constant, always absolute, so this replaces any
  // trailing segment of the caller's base while keeping a path prefix.
  return new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base);
}

function mirrorBase(baseUrl: string): URL {
  const trimmed = baseUrl?.trim() ?? "";
  if (trimmed === "") {
    throw new XnewsFetchError("config", "Library Genesis requires a mirror baseUrl", { url: "" });
  }
  let url: URL;
  try {
    url = new URL(trimmed.endsWith("/") ? trimmed : `${trimmed}/`);
  } catch {
    throw new XnewsFetchError("config", `Invalid Library Genesis baseUrl: ${trimmed}`, {
      url: trimmed,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new XnewsFetchError(
      "config",
      `Library Genesis baseUrl must be http(s): received ${url.protocol}`,
      { url: trimmed },
    );
  }
  if (url.username || url.password) {
    throw new XnewsFetchError("config", "Library Genesis baseUrl must not contain credentials", {
      url: trimmed,
    });
  }
  url.search = "";
  url.hash = "";
  return url;
}

function normalizePage(page: number | undefined, baseUrl: string): number {
  if (page === undefined) return 1;
  if (!Number.isInteger(page) || page < 1) {
    throw new XnewsFetchError("config", `page must be a positive integer; received ${page}`, {
      url: baseUrl ?? "",
    });
  }
  return page;
}

function normalizePerPage(perPage: number | undefined, baseUrl: string): number {
  if (perPage === undefined) return LIBGEN_DEFAULT_PER_PAGE;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > LIBGEN_MAX_PER_PAGE) {
    throw new XnewsFetchError(
      "config",
      `perPage must be an integer between 1 and ${LIBGEN_MAX_PER_PAGE}; received ${perPage}`,
      { url: baseUrl ?? "" },
    );
  }
  return perPage;
}

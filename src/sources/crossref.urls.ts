import { normalizeLimit } from "../options.js";
import type { SourceFetchOptions } from "../types.js";

/** Documented Works route of the free Crossref REST API. */
export const CROSSREF_WORKS_URL = "https://api.crossref.org/works";
/** Current documented `rows` ceiling per request. */
export const CROSSREF_MAX_ROWS = 1_000;
/** Current documented `offset` ceiling; deeper paging requires cursors. */
export const CROSSREF_MAX_OFFSET = 10_000;
/** The documented first cursor for deep paging. */
export const CROSSREF_INITIAL_CURSOR = "*";

export type CrossrefFilterValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];

/**
 * Options represented in a Crossref Works query URL.
 *
 * `filters` serializes to the documented `filter` parameter; an array value
 * repeats its facet name (`license.url:a,license.url:b`), which Crossref
 * treats as OR within the facet. Common facets: `type`, `from-pub-date`,
 * `until-pub-date`, `from-created-date`, `until-created-date`,
 * `container-title`, `issn`, `prefix`, `member`, `has-abstract`,
 * `has-full-text`, `category-name`.
 *
 * Providing `mailto` joins Crossref's polite pool, which is more reliable
 * than the anonymous pool and is what Crossref asks of production traffic.
 */
export interface CrossrefWorksUrlOptions {
  readonly filters?: Readonly<Record<string, CrossrefFilterValue>>;
  readonly sort?: string;
  readonly order?: "asc" | "desc";
  readonly select?: readonly string[];
  readonly rows?: number;
  readonly offset?: number;
  readonly cursor?: string;
  readonly mailto?: string;
  readonly limit?: number;
}

/** Transport and query options for {@link fetchCrossrefWorks}. */
export interface CrossrefWorksOptions extends SourceFetchOptions, CrossrefWorksUrlOptions {}

/** Builds a Crossref Works query URL. A blank query lists filter-only results. */
export function crossrefWorksUrl(query: string, options: CrossrefWorksUrlOptions = {}): string {
  if (options.cursor !== undefined && options.offset !== undefined) {
    throw new TypeError("Crossref rejects offset and cursor in the same request");
  }

  const url = new URL(CROSSREF_WORKS_URL);
  const search = query.trim();
  if (search) url.searchParams.set("query", search);

  const filter = serializeFilters(options.filters);
  if (filter) url.searchParams.set("filter", filter);

  const sort = options.sort?.trim();
  if (sort) url.searchParams.set("sort", sort);
  if (options.order !== undefined) url.searchParams.set("order", options.order);

  const select = options.select
    ?.map((field) => field.trim())
    .filter(Boolean)
    .join(",");
  if (select) url.searchParams.set("select", select);

  const rows = normalizeRows(options.rows, options.limit);
  if (rows !== undefined) url.searchParams.set("rows", String(rows));

  if (options.offset !== undefined) {
    if (
      !Number.isInteger(options.offset) ||
      options.offset < 0 ||
      options.offset > CROSSREF_MAX_OFFSET
    ) {
      throw new RangeError(`offset must be an integer between 0 and ${CROSSREF_MAX_OFFSET}`);
    }
    url.searchParams.set("offset", String(options.offset));
  }

  const cursor = options.cursor?.trim();
  if (cursor) url.searchParams.set("cursor", cursor);

  const mailto = options.mailto?.trim();
  if (mailto) url.searchParams.set("mailto", mailto);
  return url.toString();
}

function normalizeRows(rows: number | undefined, limit: number | undefined): number | undefined {
  if (rows !== undefined && (!Number.isInteger(rows) || rows < 1)) {
    throw new RangeError("rows must be a positive integer");
  }
  const normalizedLimit = normalizeLimit(limit);
  const requested =
    rows ?? (normalizedLimit !== undefined && normalizedLimit > 0 ? normalizedLimit : undefined);
  return requested === undefined ? undefined : Math.min(requested, CROSSREF_MAX_ROWS);
}

function serializeFilters(
  filters: Readonly<Record<string, CrossrefFilterValue>> | undefined,
): string | undefined {
  if (!filters) return undefined;
  const serialized: string[] = [];
  for (const [rawField, rawValue] of Object.entries(filters)) {
    const field = rawField.trim();
    if (!field) continue;
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const entry of values) {
      const value = String(entry).trim();
      if (value) serialized.push(`${field}:${value}`);
    }
  }
  return serialized.length > 0 ? serialized.join(",") : undefined;
}

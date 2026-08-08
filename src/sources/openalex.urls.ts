import { XnewsFetchError } from "../errors.js";
import type { SourceFetchOptions } from "../types.js";

/** Current Works list maximum: https://developers.openalex.org/api-reference/works/list-works */
export const OPENALEX_MAX_PER_PAGE = 100;
/** Current Works list default when `per_page` is omitted. */
export const OPENALEX_DEFAULT_PER_PAGE = 25;
/** The documented first cursor for deep paging beyond the 10,000-result basic-paging limit. */
export const OPENALEX_INITIAL_CURSOR = "*";
/** Current per-key ceiling; callers should also honor the response rate-limit headers. */
export const OPENALEX_MAX_REQUESTS_PER_SECOND = 100;

const OPENALEX_WORKS_ENDPOINT = "https://api.openalex.org/works";

export type OpenAlexFilterValue =
  | string
  | number
  | boolean
  | readonly (string | number | boolean)[];

/**
 * OpenAlex currently requires an API key, caps `per_page` at 100, and uses
 * cursor paging (`*` for the first page) for result sets beyond 10,000 works.
 * API pricing and quotas are controlled by OpenAlex and may vary by operation.
 */
export interface OpenAlexWorksOptions extends SourceFetchOptions {
  readonly apiKey: string;
  readonly filters?: Readonly<Record<string, OpenAlexFilterValue>>;
  readonly sort?: string;
  readonly cursor?: string;
  readonly perPage?: number;
}

export function openAlexWorksUrl(query: string, options: OpenAlexWorksOptions): string {
  const apiKey = requireApiKey(options.apiKey);
  const url = new URL(OPENALEX_WORKS_ENDPOINT);
  url.searchParams.set("api_key", apiKey);

  const search = query.trim();
  if (search) url.searchParams.set("search", search);

  const filter = serializeFilters(options.filters);
  if (filter) url.searchParams.set("filter", filter);

  const sort = options.sort?.trim();
  if (sort) url.searchParams.set("sort", sort);

  const cursor = options.cursor?.trim() || OPENALEX_INITIAL_CURSOR;
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("per_page", String(normalizePerPage(options.perPage, options.limit)));
  return url.toString();
}

function requireApiKey(value: string): string {
  const apiKey = value.trim();
  if (apiKey) return apiKey;
  throw new XnewsFetchError("config", "OpenAlex requires a non-blank apiKey", {
    url: OPENALEX_WORKS_ENDPOINT,
  });
}

function normalizePerPage(perPage: number | undefined, limit: number | undefined): number {
  if (perPage !== undefined && (!Number.isInteger(perPage) || perPage < 1)) {
    throw new RangeError("perPage must be a positive integer");
  }
  const requested =
    perPage ?? (limit !== undefined && limit > 0 ? limit : OPENALEX_DEFAULT_PER_PAGE);
  return Math.min(requested, OPENALEX_MAX_PER_PAGE);
}

function serializeFilters(
  filters: Readonly<Record<string, OpenAlexFilterValue>> | undefined,
): string | undefined {
  if (!filters) return undefined;
  const serialized: string[] = [];
  for (const [rawField, rawValue] of Object.entries(filters)) {
    const field = rawField.trim();
    if (!field) continue;
    const value = Array.isArray(rawValue)
      ? rawValue
          .map(String)
          .map((entry) => entry.trim())
          .filter(Boolean)
          .join("|")
      : String(rawValue).trim();
    if (value) serialized.push(`${field}:${value}`);
  }
  return serialized.length > 0 ? serialized.join(",") : undefined;
}

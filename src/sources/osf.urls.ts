import type { SourceFetchOptions } from "../types.js";

/** OSF JSON:API collection for public preprints across community providers. */
export const OSF_PREPRINTS_URL = "https://api.osf.io/v2/preprints/";

const DEFAULT_OSF_PREPRINTS_SORT = "-date_published";
const MAX_OSF_PREPRINTS_PAGE_SIZE = 100;

export interface OsfPreprintsUrlOptions {
  /** OSF preprint-provider ids, such as `socarxiv` and `psyarxiv`. */
  readonly providers?: readonly string[];
  readonly pageSize?: number;
  /** OSF JSON:API sort expression. Defaults to `-date_published`. */
  readonly sort?: string;
  readonly publishedSince?: string;
  readonly publishedUntil?: string;
}

export interface OsfPreprintsOptions extends SourceFetchOptions, OsfPreprintsUrlOptions {}

export function osfPreprintsUrl(options: OsfPreprintsUrlOptions = {}): string {
  if (
    options.pageSize !== undefined &&
    (!Number.isInteger(options.pageSize) ||
      options.pageSize < 1 ||
      options.pageSize > MAX_OSF_PREPRINTS_PAGE_SIZE)
  ) {
    throw new RangeError("pageSize must be an integer from 1 through 100");
  }

  const url = new URL(OSF_PREPRINTS_URL);
  const providers = (options.providers ?? []).map((provider) => provider.trim()).filter(Boolean);
  if (providers.length > 0) {
    url.searchParams.set("filter[provider]", providers.join(","));
  }
  if (options.pageSize !== undefined) {
    url.searchParams.set("page[size]", String(options.pageSize));
  }

  url.searchParams.set("sort", options.sort?.trim() || DEFAULT_OSF_PREPRINTS_SORT);

  const publishedSince = options.publishedSince?.trim();
  if (publishedSince) {
    url.searchParams.set("filter[date_published][gte]", publishedSince);
  }
  const publishedUntil = options.publishedUntil?.trim();
  if (publishedUntil) {
    url.searchParams.set("filter[date_published][lte]", publishedUntil);
  }
  return url.toString();
}

const NBER_LISTING_ENDPOINT =
  "https://www.nber.org/api/v1/working_page_listing/contentType/working_paper/_/_/search";

export const NBER_RSS_URL = "https://back.nber.org/rss/new.xml";

export interface NberListingUrlOptions {
  readonly q?: string;
  readonly page?: number;
  readonly perPage?: number;
  /** `public_date` is the known-good listing sort and the default. */
  readonly sortBy?: string;
}

export function nberListingUrl(options: NberListingUrlOptions = {}): string {
  const page = positiveInteger(options.page, 1, "page");
  const perPage = positiveInteger(options.perPage, 50, "perPage");
  const sortBy = options.sortBy?.trim() || "public_date";

  const url = new URL(NBER_LISTING_ENDPOINT);
  url.searchParams.set("page", String(page));
  url.searchParams.set("perPage", String(perPage));
  url.searchParams.set("sortBy", sortBy);

  const query = options.q?.trim();
  if (query) url.searchParams.set("q", query);
  return url.toString();
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

import { fetchText } from "../http";
import { normalizeLimit } from "../options";
import { parseAtomEntries } from "../xml";
import { subjectMatcher } from "./match";
import type { NewsItem, SourceFetchOptions } from "../types";

interface SecCurrentFetchOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
  /** Local all-token filter applied to entry titles and summaries. */
  filterQuery?: string;
}

/**
 * SEC EDGAR "Latest Filings" (current events) Atom feed: the market-wide
 * stream of filings as they arrive. `company` is EDGAR's server-side
 * company-name prefix search over the current window; omit it for the
 * unfiltered stream.
 */
export function secCurrentAtomUrl(company?: string, formType?: string, count = 40): string {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  if (company) url.searchParams.set("company", company);
  if (formType) url.searchParams.set("type", formType);
  url.searchParams.set("count", String(Math.min(count, 100)));
  url.searchParams.set("output", "atom");
  return url.toString();
}

export async function fetchSecCurrentFilings(
  company: string | undefined,
  options: SecCurrentFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const forms = options.forms?.length ? options.forms : [undefined];
  const count = limit ?? 40;
  const responses = await Promise.all(
    forms.map(async (form) => fetchText(secCurrentAtomUrl(company, form, count), options)),
  );
  return responses.flatMap((xml) =>
    parseSecCurrentFilings(xml, {
      ...(options.ticker ? { ticker: options.ticker } : {}),
      ...(options.filterQuery ? { filterQuery: options.filterQuery } : {}),
      ...(limit !== undefined ? { limit } : {}),
    }),
  );
}

export function parseSecCurrentFilings(
  xml: string,
  options: { ticker?: string; filterQuery?: string; limit?: number } = {},
): NewsItem[] {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  let items = parseAtomEntries(xml, {
    provider: "sec-current",
    sourceFallback: "SEC EDGAR",
    ...(options.ticker ? { ticker: options.ticker } : {}),
  });
  if (options.filterQuery) items = items.filter(subjectMatcher({ query: options.filterQuery }));
  return limit !== undefined ? items.slice(0, limit) : items;
}

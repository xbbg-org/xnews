import { fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { parseAtomEntries } from "../xml.js";
import { subjectMatcher } from "./match.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";
import { secCurrentAtomUrl } from "./seccurrent.urls.js";
export { secCurrentAtomUrl } from "./seccurrent.urls.js";

interface SecCurrentFetchOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
  /** Local all-token filter applied to entry titles and summaries. */
  filterQuery?: string;
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

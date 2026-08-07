import { fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { parseAtomEntries } from "../xml.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";
import { secCompanyAtomUrl } from "./sec.urls.js";
export { secCompanyAtomUrl } from "./sec.urls.js";

interface SecFetchOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
}

export async function fetchSecFilings(
  identifier: string,
  options: SecFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const forms = options.forms?.length ? options.forms : [undefined];
  const count = limit ?? 40;
  const responses = await Promise.all(
    forms.map(async (form) => fetchText(secCompanyAtomUrl(identifier, form, count), options)),
  );
  return responses.flatMap((xml) => parseSecFilings(xml, options.ticker ?? identifier, limit));
}

export function parseSecFilings(xml: string, identifier: string, limit?: number): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  const ticker = /^[A-Z]{1,5}$/.test(identifier) ? identifier : "";
  return parseAtomEntries(xml, {
    provider: "sec-edgar",
    sourceFallback: "SEC EDGAR",
    ...(ticker ? { ticker } : {}),
    ...(normalizedLimit !== undefined ? { limit: normalizedLimit } : {}),
  });
}

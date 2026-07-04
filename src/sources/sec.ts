import { fetchText } from "../http";
import { normalizeLimit } from "../options";
import { parseAtomEntries } from "../xml";
import type { NewsItem, SourceFetchOptions } from "../types";

interface SecFetchOptions extends SourceFetchOptions {
  forms?: readonly string[];
  ticker?: string;
}

export function secCompanyAtomUrl(identifier: string, formType?: string, count = 40): string {
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcompany");
  url.searchParams.set("CIK", identifier.toUpperCase());
  if (formType) url.searchParams.set("type", formType);
  url.searchParams.set("count", String(count));
  url.searchParams.set("output", "atom");
  return url.toString();
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

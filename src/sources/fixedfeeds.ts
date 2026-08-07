import { BROWSERISH_USER_AGENT, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { parseRssItems } from "../xml.js";
import { FIXED_FEEDS, type FixedFeedProvider } from "./fixedfeeds.urls.js";
import { subjectMatcher, type SubjectMatchTerms } from "./match.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export { FIXED_FEEDS, FIXED_FEED_PROVIDERS, isFixedFeedProvider } from "./fixedfeeds.urls.js";
export type { FixedFeedDefinition, FixedFeedProvider } from "./fixedfeeds.urls.js";

export async function fetchFixedFeedNews(
  provider: FixedFeedProvider,
  subject: SubjectMatchTerms,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const responses = await Promise.all(
    FIXED_FEEDS[provider].urls.map((url) =>
      fetchText(url, options, options.userAgent ?? BROWSERISH_USER_AGENT),
    ),
  );
  const items = responses.flatMap((xml) => parseFixedFeedNews(provider, xml, subject));
  return limit !== undefined ? items.slice(0, limit) : items;
}

export function parseFixedFeedNews(
  provider: FixedFeedProvider,
  xml: string,
  subject: SubjectMatchTerms,
  limit?: number,
): NewsItem[] {
  const normalizedLimit = normalizeLimit(limit);
  if (normalizedLimit === 0) return [];

  const definition = FIXED_FEEDS[provider];
  const items = parseRssItems(xml, {
    provider,
    sourceFallback: definition.label,
    ...(definition.kind ? { kind: definition.kind } : {}),
    ...(subject.ticker ? { ticker: subject.ticker } : {}),
  }).filter(subjectMatcher(subject));
  return normalizedLimit !== undefined ? items.slice(0, normalizedLimit) : items;
}

import { BROWSERISH_USER_AGENT, DEFAULT_USER_AGENT, fetchText } from "../http.js";
import { normalizeLimit } from "../options.js";
import { parseAtomEntries, parseRssItems } from "../xml.js";
import { FIXED_FEEDS, type FixedFeedProvider } from "./fixedfeeds.urls.js";
import { subjectMatcher, type SubjectMatchTerms } from "./match.js";
import type { NewsItem, SourceFetchOptions } from "../types.js";

export {
  CENTRAL_BANK_NEWS_PROVIDERS,
  CENTRAL_BANK_RESEARCH_PROVIDERS,
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  isFixedFeedProvider,
} from "./fixedfeeds.urls.js";
export type { FixedFeedDefinition, FixedFeedProvider } from "./fixedfeeds.urls.js";

export interface FixedFeedFetchFailure {
  readonly url: string;
  readonly error: unknown;
}

export interface FixedFeedNewsResult {
  readonly items: readonly NewsItem[];
  readonly successfulUrls: readonly string[];
  readonly failures: readonly FixedFeedFetchFailure[];
}

export async function fetchFixedFeedNewsResult(
  provider: FixedFeedProvider,
  subject: SubjectMatchTerms,
  options: SourceFetchOptions = {},
): Promise<FixedFeedNewsResult> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return { items: [], successfulUrls: [], failures: [] };

  const definition = FIXED_FEEDS[provider];
  const userAgent =
    options.userAgent ??
    (definition.userAgentPolicy === "default" ? DEFAULT_USER_AGENT : BROWSERISH_USER_AGENT);

  const results = await Promise.all(
    definition.urls.map(async (url) => {
      try {
        const xml = await fetchText(url, options, userAgent);
        return { url, items: parseFixedFeedNews(provider, xml, subject) } as const;
      } catch (error) {
        return { url, error } as const;
      }
    }),
  );
  const items = results.flatMap((result) => ("items" in result ? result.items : []));
  return {
    items: limit !== undefined ? items.slice(0, limit) : items,
    successfulUrls: results.flatMap((result) => ("items" in result ? [result.url] : [])),
    failures: results.flatMap((result) =>
      "error" in result ? [{ url: result.url, error: result.error }] : [],
    ),
  };
}

export async function fetchFixedFeedNews(
  provider: FixedFeedProvider,
  subject: SubjectMatchTerms,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const result = await fetchFixedFeedNewsResult(provider, subject, options);
  if (result.successfulUrls.length === 0 && result.failures.length > 0) {
    throw result.failures[0]?.error;
  }
  return [...result.items];
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
  const baseUrl = definition.baseUrl;
  const parseOptions = {
    provider,
    sourceFallback: definition.label,
    ...(definition.kind ? { kind: definition.kind } : {}),
    ...(subject.ticker ? { ticker: subject.ticker } : {}),
  };
  const items = (
    definition.format === "atom"
      ? parseAtomEntries(xml, parseOptions)
      : parseRssItems(xml, {
          ...parseOptions,
          ...(baseUrl
            ? {
                resolveUrl: (link: string) => {
                  try {
                    return new URL(link, baseUrl).href;
                  } catch {
                    return link;
                  }
                },
              }
            : {}),
        })
  ).filter(subjectMatcher(subject));
  return normalizedLimit !== undefined ? items.slice(0, normalizedLimit) : items;
}

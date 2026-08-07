/**
 * Structurally network-free view of xnews: URL builders, the fixed-feed
 * registry, provider operating policies, and the publication-date parser.
 *
 * The import graph of this module never reaches `src/http.ts` or any module
 * that fetches, so `import "@xbbg/xnews/catalog"` cannot execute network code
 * even in principle. Consumers with their own governed transport (SSRF
 * pinning, robots, rate limits) use this entrypoint for xnews's endpoint
 * knowledge while keeping retrieval entirely on their side.
 * `test/architecture.test.ts` enforces the graph property.
 */

import type { NewsProvider } from "./types.js";

export { PUBLISHED_AT_PARSER_VERSION, parsePublishedAt } from "./dates.js";
export type { ParsedPublishedAt, PublishedAtFormat } from "./dates.js";
export { NEWS_ITEM_ID_SCHEME_VERSION } from "./text.js";
export type { NewsKind, NewsProvider, NewsProviderCapability, ProviderErrorCode } from "./types.js";

export { bingNewsRssUrl } from "./sources/bing.urls.js";
export { courtListenerSearchUrl } from "./sources/courtlistener.urls.js";
export { federalRegisterSearchUrl } from "./sources/federalregister.urls.js";
export { finvizQuoteUrl } from "./sources/finviz.urls.js";
export {
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  isFixedFeedProvider,
} from "./sources/fixedfeeds.urls.js";
export type { FixedFeedDefinition, FixedFeedProvider } from "./sources/fixedfeeds.urls.js";
export { gdeltDocUrl } from "./sources/gdelt.urls.js";
export { googleNewsRssUrl } from "./sources/google.urls.js";
export { hackerNewsSearchUrl } from "./sources/hackernews.urls.js";
export { msrbEmmaCdUrl, msrbEmmaPeriods } from "./sources/msrbemma.urls.js";
export type { MsrbEmmaPeriod } from "./sources/msrbemma.urls.js";
export { nasdaqRssUrl } from "./sources/nasdaq.urls.js";
export { secCompanyAtomUrl } from "./sources/sec.urls.js";
export { secCurrentAtomUrl } from "./sources/seccurrent.urls.js";
export { secFullTextSearchUrl } from "./sources/secfulltext.urls.js";
export { seekingAlphaRssUrl } from "./sources/seekingalpha.urls.js";
export { tickerTickFeedUrl } from "./sources/tickertick.urls.js";
export { yahooFinanceRssUrl } from "./sources/yahoo.urls.js";
export { yahooSearchUrl } from "./sources/yahoosearch.urls.js";
export { youtubeChannelFeedUrl } from "./sources/youtube.urls.js";
export { youtubeWatchUrl } from "./sources/youtubetranscript.urls.js";

/**
 * Operational facts a consumer needs before pointing a scheduler at a
 * provider. Only documented, verifiable requirements are recorded here;
 * absence of an entry means "no special requirement is known", not "no
 * limit exists".
 */
export interface ProviderPolicy {
  /** Documented provider-wide request rate ceiling. */
  readonly maxRequestsPerSecond?: number;
  /** Provider rejects or throttles clients without a declared User-Agent. */
  readonly requiresDeclaredUserAgent?: boolean;
  /** URL of terms the caller must accept before the provider serves data. */
  readonly requiresTermsAcceptance?: string;
  readonly notes?: string;
}

const SEC_POLICY: ProviderPolicy = {
  maxRequestsPerSecond: 10,
  requiresDeclaredUserAgent: true,
  notes:
    "SEC fair-access policy: declare a User-Agent with contact information (set secUserAgent) and stay at or under 10 requests per second across all sec.gov endpoints combined.",
};

export const PROVIDER_POLICIES: Partial<Record<NewsProvider, ProviderPolicy>> = {
  "sec-edgar": SEC_POLICY,
  "sec-fulltext": SEC_POLICY,
  "sec-current": SEC_POLICY,
  "sec-press": SEC_POLICY,
  "msrb-emma": {
    requiresTermsAcceptance: "https://emma.msrb.org",
    notes:
      "EMMA gates data behind Terms-of-Use acceptance; after accepting, set msrbAcceptTermsOfUse: true to send the acceptance cookie.",
  },
};

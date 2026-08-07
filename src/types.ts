export type NewsProvider =
  | "yahoo-finance"
  | "google-news"
  | "sec-edgar"
  | "finviz"
  | "bing-news"
  | "gdelt"
  | "tickertick"
  | "hacker-news"
  | "yahoo-search"
  | "sec-fulltext"
  | "sec-current"
  | "federal-register"
  | "courtlistener"
  | "msrb-emma"
  | "nasdaq"
  | "seeking-alpha"
  | "marketwatch"
  | "wsj"
  | "cnbc"
  | "pr-newswire"
  | "globenewswire"
  | "federal-reserve"
  | "sec-press"
  | "coindesk"
  | "cointelegraph"
  | "benzinga"
  | "investing-com"
  | "upi"
  | "oilprice"
  | "nyt"
  | "bbc"
  | "npr"
  | "guardian"
  | "ft"
  | "economist"
  | "fortune"
  | "forbes"
  | "washington-post"
  | "youtube";

export type NewsProviderCapability = "company" | "topic" | "filing";

export type ProviderStatus = "ok" | "empty" | "unsupported" | "partial" | "error" | "disabled";

/**
 * Machine-readable classification for transport failures. `config` marks a
 * policy precondition that failed before any network I/O (missing SEC
 * User-Agent, EMMA terms not accepted, no fetch implementation); `unknown`
 * marks errors that did not originate in this library's transport.
 */
export type ProviderErrorCode =
  | "config"
  | "network"
  | "http_status"
  | "timeout"
  | "aborted"
  | "unknown";

export type MarketEventKind =
  | "filing"
  | "earnings"
  | "management"
  | "capital-markets"
  | "debt"
  | "preferred"
  | "dividend"
  | "rating"
  | "regulatory"
  | "legal"
  | "mna"
  | "fund-flows"
  | "analysis"
  | "press-release"
  | "market"
  | "unknown";

export type NewsKind = "article" | "filing" | "press-release" | "analysis" | "video" | "unknown";

export interface CompanyNewsSubjectInput {
  readonly kind: "company";
  readonly ticker?: string;
  readonly companyName?: string;
  readonly cik?: string;
}

export interface TopicNewsSubjectInput {
  readonly kind: "topic";
  readonly query: string;
}

export type NewsSubjectInput = CompanyNewsSubjectInput | TopicNewsSubjectInput;

export interface NewsSubject {
  readonly kind: "company" | "topic";
  readonly key: string;
  readonly displayName: string;
  readonly ticker?: string;
  readonly companyName?: string;
  readonly cik?: string;
  readonly query?: string;
}

export interface NewsItem {
  id: string;
  provider: NewsProvider;
  kind: NewsKind;
  title: string;
  url: string;
  source: string;
  ticker?: string;
  publishedAt?: string;
  publishedAtText?: string;
  summary?: string;
  formType?: string;
  accessionNumber?: string;
  relatedTickers?: readonly string[];
  readonly canonicalUrl?: string;
  readonly cik?: string;
  readonly fileNumber?: string;
  readonly companyName?: string;
  readonly filingDate?: string;
  readonly reportDate?: string;
  readonly eventKind?: MarketEventKind;
  readonly tags?: readonly string[];
  readonly seenInProviders?: readonly NewsProvider[];
  readonly provenance?: readonly NewsItemProvenance[];
}

export interface NewsItemProvenance {
  readonly provider: NewsProvider;
  readonly source: string;
  readonly url: string;
}

export type SourceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SourceFetchOptions {
  readonly fetch?: SourceFetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /**
   * Redirect semantics enforced by xnews. `"follow"` (default) revalidates
   * policy on at most ten hops; the injected fetch receives `"manual"`.
   */
  readonly redirect?: RequestRedirect;
  readonly userAgent?: string;
  readonly secUserAgent?: string;
  /**
   * MSRB EMMA gates data behind a Terms-of-Use acceptance cookie. Accepting
   * those terms (https://emma.msrb.org) is the caller's act: without this
   * flag, EMMA requests fail closed with a `config` error instead of the
   * library accepting on the caller's behalf.
   */
  readonly msrbAcceptTermsOfUse?: boolean;
  readonly limit?: number;
  readonly since?: string | Date;
  readonly until?: string | Date;
}

export interface NewsFeedOptions extends SourceFetchOptions {
  readonly sources?: readonly NewsProvider[];
  readonly strict?: boolean;
  readonly secForms?: readonly string[];
}

export interface CompanyNewsQuery extends NewsFeedOptions {
  readonly ticker: string;
  readonly companyName?: string;
  readonly cik?: string;
}

export interface TopicNewsQuery extends NewsFeedOptions {
  readonly query: string;
}

export interface WatchNewsOptions extends CompanyNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

export interface WatchTopicNewsOptions extends TopicNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

export interface ProviderError {
  readonly message: string;
  /** Machine-readable classification; `unknown` for non-transport failures. */
  readonly code?: ProviderErrorCode;
  readonly status?: number;
  readonly url?: string;
}

export interface ProviderResult {
  readonly provider: NewsProvider;
  readonly status: ProviderStatus;
  readonly capabilities: readonly NewsProviderCapability[];
  readonly itemCount: number;
  readonly items: readonly NewsItem[];
  /**
   * Items dropped by a `since`/`until` window because they carry no parseable
   * publication date. Library-generated results always include this count;
   * the field remains optional so 0.1.x consumer-defined result fixtures stay
   * assignable to this public interface.
   */
  readonly undatedExcluded?: number;
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly durationMs: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}

export interface NewsFeedResult {
  readonly subject: NewsSubject;
  readonly items: readonly NewsItem[];
  readonly providers: readonly ProviderResult[];
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly partial: boolean;
}

export interface NewsFeedQuery extends NewsFeedOptions {
  readonly subject: NewsSubjectInput;
}

export interface WatchlistNewsQuery extends NewsFeedOptions {
  readonly subjects: readonly NewsSubjectInput[];
}

export interface WatchlistSubjectResult {
  readonly subject: NewsSubject;
  readonly result: NewsFeedResult;
}

export interface WatchlistNewsFeedResult {
  readonly subjects: readonly WatchlistSubjectResult[];
  readonly items: readonly NewsItem[];
  readonly providers: readonly ProviderResult[];
  readonly warnings: readonly string[];
  readonly fetchedAt: string;
  readonly partial: boolean;
}

export interface WatchlistNewsOptions extends WatchlistNewsQuery {
  readonly intervalMs?: number;
  readonly seenIds?: Iterable<string>;
}

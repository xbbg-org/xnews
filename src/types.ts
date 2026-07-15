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
  | "federal-register"
  | "courtlistener"
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
  | "washington-post";

export type NewsProviderCapability = "company" | "topic" | "filing";

export type ProviderStatus = "ok" | "empty" | "unsupported" | "partial" | "error" | "disabled";

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

export type NewsKind = "article" | "filing" | "press-release" | "analysis" | "unknown";

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
  readonly userAgent?: string;
  readonly secUserAgent?: string;
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
  readonly status?: number;
  readonly url?: string;
}

export interface ProviderResult {
  readonly provider: NewsProvider;
  readonly status: ProviderStatus;
  readonly capabilities: readonly NewsProviderCapability[];
  readonly itemCount: number;
  readonly items: readonly NewsItem[];
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

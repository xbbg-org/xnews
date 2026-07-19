import { classifyMarketEvent } from "./classify";
import { normalizeDateWindow, normalizeLimit, type DateWindow } from "./options";
import { fetchBingNews, bingNewsRssUrl } from "./sources/bing";
import { fetchCourtListenerNews, courtListenerSearchUrl } from "./sources/courtlistener";
import { fetchFederalRegisterNews, federalRegisterSearchUrl } from "./sources/federalregister";
import { fetchFinvizNews, finvizQuoteUrl } from "./sources/finviz";
import { FIXED_FEEDS, fetchFixedFeedNews, isFixedFeedProvider } from "./sources/fixedfeeds";
import { fetchGdeltNews, gdeltDocUrl } from "./sources/gdelt";
import { fetchGoogleNews, googleNewsRssUrl } from "./sources/google";
import { fetchHackerNewsStories, hackerNewsSearchUrl } from "./sources/hackernews";
import type { SubjectMatchTerms } from "./sources/match";
import { fetchMsrbEmmaDisclosures, msrbEmmaCdUrl, msrbEmmaPeriods } from "./sources/msrbemma";
import { fetchNasdaqNews, nasdaqRssUrl } from "./sources/nasdaq";
import { fetchSecFilings, secCompanyAtomUrl } from "./sources/sec";
import { fetchSecCurrentFilings, secCurrentAtomUrl } from "./sources/seccurrent";
import { fetchSecFullTextFilings, secFullTextSearchUrl } from "./sources/secfulltext";
import { fetchSeekingAlphaNews, seekingAlphaRssUrl } from "./sources/seekingalpha";
import { fetchTickerTickNews, tickerTickFeedUrl } from "./sources/tickertick";
import { fetchYahooFinanceNews, yahooFinanceRssUrl } from "./sources/yahoo";
import { fetchYahooSearchNews, yahooSearchUrl } from "./sources/yahoosearch";
import type {
  CompanyNewsQuery,
  CompanyNewsSubjectInput,
  NewsFeedOptions,
  NewsFeedQuery,
  NewsFeedResult,
  NewsItem,
  NewsItemProvenance,
  NewsProvider,
  NewsProviderCapability,
  NewsSubject,
  NewsSubjectInput,
  ProviderError,
  ProviderResult,
  TopicNewsQuery,
  WatchlistNewsFeedResult,
  WatchlistNewsOptions,
  WatchlistNewsQuery,
  WatchNewsOptions,
  WatchTopicNewsOptions,
} from "./types";

const DEFAULT_COMPANY_SOURCES: readonly NewsProvider[] = [
  "sec-edgar",
  "yahoo-finance",
  "google-news",
  "finviz",
];
const DEFAULT_TOPIC_SOURCES: readonly NewsProvider[] = ["google-news"];
const PARTIAL_STATUSES = new Set(["error", "unsupported", "partial", "disabled"]);

const QUERY_PROVIDER_CAPABILITIES: Partial<
  Record<NewsProvider, readonly NewsProviderCapability[]>
> = {
  "yahoo-finance": ["company"],
  "google-news": ["company", "topic"],
  "sec-edgar": ["company", "filing"],
  finviz: ["company"],
  "bing-news": ["company", "topic"],
  gdelt: ["company", "topic"],
  tickertick: ["company"],
  "hacker-news": ["company", "topic"],
  "yahoo-search": ["company", "topic"],
  "sec-fulltext": ["company", "topic", "filing"],
  "sec-current": ["company", "topic", "filing"],
  "federal-register": ["company", "topic"],
  courtlistener: ["company", "topic"],
  "msrb-emma": ["company", "topic", "filing"],
  nasdaq: ["company"],
  "seeking-alpha": ["company"],
  youtube: [],
};

type CompanySubjectRequirement = "ticker" | "ticker-or-cik" | "name-or-ticker" | "name";

const COMPANY_SUBJECT_REQUIREMENTS: Partial<Record<NewsProvider, CompanySubjectRequirement>> = {
  "yahoo-finance": "ticker",
  finviz: "ticker",
  tickertick: "ticker",
  nasdaq: "ticker",
  "seeking-alpha": "ticker",
  "sec-edgar": "ticker-or-cik",
  "sec-current": "name",
  "federal-register": "name",
  courtlistener: "name",
  "msrb-emma": "name",
};

export async function buildCompanyNewsFeed(query: CompanyNewsQuery): Promise<NewsItem[]> {
  const result = await buildCompanyNewsFeedResult(query);
  if (result.warnings.length > 0 && query.strict) {
    throw new Error(`News feed incomplete: ${result.warnings.join("; ")}`);
  }

  return [...result.items];
}

export async function buildCompanyNewsFeedResult(query: CompanyNewsQuery): Promise<NewsFeedResult> {
  const subject: CompanyNewsSubjectInput = {
    kind: "company",
    ticker: query.ticker,
    ...(query.companyName !== undefined ? { companyName: query.companyName } : {}),
    ...(query.cik !== undefined ? { cik: query.cik } : {}),
  };
  return buildNewsFeedResult({ ...query, subject });
}

export async function buildTopicNewsFeed(query: TopicNewsQuery): Promise<NewsItem[]> {
  const result = await buildTopicNewsFeedResult(query);
  if (result.warnings.length > 0 && query.strict) {
    throw new Error(`Topic news feed incomplete: ${result.warnings.join("; ")}`);
  }

  return [...result.items];
}

export async function buildTopicNewsFeedResult(query: TopicNewsQuery): Promise<NewsFeedResult> {
  return buildNewsFeedResult({ ...query, subject: { kind: "topic", query: query.query } });
}

export async function buildNewsFeed(query: NewsFeedQuery): Promise<NewsItem[]> {
  const result = await buildNewsFeedResult(query);
  if (result.warnings.length > 0 && query.strict) {
    throw new Error(`News feed incomplete: ${result.warnings.join("; ")}`);
  }

  return [...result.items];
}

export async function buildNewsFeedResult(query: NewsFeedQuery): Promise<NewsFeedResult> {
  const limit = normalizeLimit(query.limit);
  const subject = normalizeSubject(query.subject);
  const fetchedAt = new Date().toISOString();
  const dateWindow = normalizeDateWindow(query);
  if (limit === 0) {
    return { subject, items: [], providers: [], warnings: [], fetchedAt, partial: false };
  }

  const providers = await Promise.all(
    sourcesForSubject(subject, query.sources).map(async (provider) =>
      fetchProviderResult(provider, subject, query, dateWindow),
    ),
  );
  const merged = mergeNewsItems(providers.map((provider) => provider.items));
  const warnings = providers.flatMap((provider) => provider.warnings);

  return {
    subject,
    items: limit !== undefined ? merged.slice(0, limit) : merged,
    providers,
    warnings,
    fetchedAt,
    partial: providers.some((provider) => PARTIAL_STATUSES.has(provider.status)),
  };
}

export async function buildWatchlistNewsFeed(query: WatchlistNewsQuery): Promise<NewsItem[]> {
  const result = await buildWatchlistNewsFeedResult(query);
  if (result.warnings.length > 0 && query.strict) {
    throw new Error(`Watchlist news feed incomplete: ${result.warnings.join("; ")}`);
  }

  return [...result.items];
}

export async function buildWatchlistNewsFeedResult(
  query: WatchlistNewsQuery,
): Promise<WatchlistNewsFeedResult> {
  const limit = normalizeLimit(query.limit);
  const options = newsFeedOptionsWithoutLimit(query);
  const subjectResults = await Promise.all(
    query.subjects.map(async (subject) =>
      buildNewsFeedResult({ ...options, subject, strict: false }),
    ),
  );
  const items = mergeNewsItems(subjectResults.map((result) => result.items));
  const providers = subjectResults.flatMap((result) => result.providers);
  const warnings = subjectResults.flatMap((result) => result.warnings);

  return {
    subjects: subjectResults.map((result) => ({ subject: result.subject, result })),
    items: limit !== undefined ? items.slice(0, limit) : items,
    providers,
    warnings,
    fetchedAt: new Date().toISOString(),
    partial: subjectResults.some((result) => result.partial),
  };
}

export function mergeNewsItems(itemGroups: readonly (readonly NewsItem[])[]): NewsItem[] {
  const byKey = new Map<string, NewsItem>();

  for (const item of itemGroups.flat()) {
    const key = canonicalItemKey(item);
    const existing = byKey.get(key);
    byKey.set(
      key,
      existing ? mergeDuplicateItems(existing, item) : mergeDuplicateItems(item, item),
    );
  }

  return [...byKey.values()].toSorted(compareNewsItems);
}

export async function* createNewsWatcher(options: WatchNewsOptions): AsyncGenerator<NewsItem[]> {
  yield* watchItems(() => buildCompanyNewsFeed(options), options);
}

export async function* createTopicNewsWatcher(
  options: WatchTopicNewsOptions,
): AsyncGenerator<NewsItem[]> {
  yield* watchItems(() => buildTopicNewsFeed(options), options);
}

export async function* createWatchlistNewsWatcher(
  options: WatchlistNewsOptions,
): AsyncGenerator<NewsItem[]> {
  yield* watchItems(() => buildWatchlistNewsFeed(options), options);
}

export function providerCapabilities(provider: NewsProvider): readonly NewsProviderCapability[] {
  if (isFixedFeedProvider(provider)) return ["company", "topic"];
  return QUERY_PROVIDER_CAPABILITIES[provider] ?? ["company"];
}

async function* watchItems(
  loadItems: () => Promise<NewsItem[]>,
  options: { intervalMs?: number; seenIds?: Iterable<string>; signal?: AbortSignal },
): AsyncGenerator<NewsItem[]> {
  const seen = new Set(options.seenIds);
  const intervalMs = options.intervalMs ?? 60_000;

  while (!options.signal?.aborted) {
    const items = await loadItems();
    const fresh: NewsItem[] = [];

    for (const item of items.toReversed()) {
      const key = canonicalItemKey(item);
      if (seen.has(key) || seen.has(item.id)) continue;
      seen.add(key);
      seen.add(item.id);
      fresh.push(item);
    }

    if (fresh.length > 0) yield fresh.toReversed();
    if (options.signal?.aborted) break;
    await sleep(intervalMs, options.signal);
  }
}

async function fetchProviderResult(
  provider: NewsProvider,
  subject: NewsSubject,
  query: NewsFeedOptions,
  dateWindow: DateWindow,
): Promise<ProviderResult> {
  const startedAt = Date.now();
  const capabilities = providerCapabilities(provider);
  const unsupported = unsupportedReason(provider, subject);
  if (unsupported) {
    return providerResult({
      provider,
      capabilities,
      status: "unsupported",
      items: [],
      warnings: [unsupported],
      startedAt,
      requestUrls: [],
    });
  }

  const requestUrls = providerRequestUrls(provider, subject, query);
  try {
    const sourceItems = await fetchSource(provider, subject, query, dateWindow);
    const items = filterItemsByDateWindow(sourceItems, dateWindow).map((item) =>
      annotateNewsItem(item, subject),
    );
    return providerResult({
      provider,
      capabilities,
      status: items.length > 0 ? "ok" : "empty",
      items,
      warnings: [],
      startedAt,
      requestUrls,
    });
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    return providerResult({
      provider,
      capabilities,
      status: "error",
      items: [],
      warnings: [`${provider}: ${providerError.message}`],
      startedAt,
      requestUrls,
      error: providerError,
    });
  }
}

function providerResult(options: {
  readonly provider: NewsProvider;
  readonly capabilities: readonly NewsProviderCapability[];
  readonly status: ProviderResult["status"];
  readonly items: readonly NewsItem[];
  readonly warnings: readonly string[];
  readonly startedAt: number;
  readonly requestUrls: readonly string[];
  readonly error?: ProviderError;
}): ProviderResult {
  return {
    provider: options.provider,
    status: options.status,
    capabilities: options.capabilities,
    itemCount: options.items.length,
    items: options.items,
    warnings: options.warnings,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAt,
    requestUrls: options.requestUrls,
    ...(options.error ? { error: options.error } : {}),
  };
}

function providerErrorFromUnknown(error: unknown): ProviderError {
  return { message: error instanceof Error ? error.message : String(error) };
}

async function fetchSource(
  provider: NewsProvider,
  subject: NewsSubject,
  query: NewsFeedOptions,
  dateWindow: DateWindow,
): Promise<NewsItem[]> {
  const options = hasDateWindowBounds(dateWindow) ? newsFeedOptionsWithoutLimit(query) : query;

  if (provider === "yahoo-finance")
    return fetchYahooFinanceNews(requiredTicker(provider, subject), options);
  if (provider === "google-news") {
    const googleOptions =
      subject.kind === "company" && subject.ticker
        ? { ...options, ticker: subject.ticker }
        : options;
    return fetchGoogleNews(googleQueryFromSubject(subject), googleOptions);
  }
  if (provider === "sec-edgar") {
    const identifier = subject.cik ?? requiredTicker(provider, subject);
    const secOptions = {
      ...options,
      ...(query.secForms?.length ? { forms: query.secForms } : {}),
      ...(subject.ticker ? { ticker: subject.ticker } : {}),
    };
    return fetchSecFilings(identifier, secOptions);
  }
  if (provider === "bing-news") return fetchBingNews(googleQueryFromSubject(subject), options);
  if (provider === "gdelt") return fetchGdeltNews(gdeltQueryFromSubject(subject), options);
  if (provider === "tickertick")
    return fetchTickerTickNews(requiredTicker(provider, subject), options);
  if (provider === "hacker-news")
    return fetchHackerNewsStories(plainQueryFromSubject(subject), options);
  if (provider === "yahoo-search")
    return fetchYahooSearchNews(yahooSearchQueryFromSubject(subject), options);
  if (provider === "sec-fulltext") {
    const fullTextOptions = {
      ...options,
      ...(query.secForms?.length ? { forms: query.secForms } : {}),
      ...(subject.ticker ? { ticker: subject.ticker } : {}),
    };
    return fetchSecFullTextFilings(plainQueryFromSubject(subject), fullTextOptions);
  }
  if (provider === "sec-current") {
    const company =
      subject.kind === "company" ? requiredCompanyNameOrTopic(provider, subject) : undefined;
    const currentOptions = {
      ...options,
      ...(query.secForms?.length ? { forms: query.secForms } : {}),
      ...(subject.ticker ? { ticker: subject.ticker } : {}),
      ...(subject.kind === "topic" ? { filterQuery: subject.query ?? subject.displayName } : {}),
    };
    return fetchSecCurrentFilings(company, currentOptions);
  }
  if (provider === "federal-register")
    return fetchFederalRegisterNews(requiredCompanyNameOrTopic(provider, subject), options);
  if (provider === "courtlistener")
    return fetchCourtListenerNews(requiredCompanyNameOrTopic(provider, subject), options);
  if (provider === "msrb-emma")
    return fetchMsrbEmmaDisclosures(subjectMatchTerms(subject), options);
  if (provider === "nasdaq") return fetchNasdaqNews(requiredTicker(provider, subject), options);
  if (provider === "seeking-alpha")
    return fetchSeekingAlphaNews(requiredTicker(provider, subject), options);
  if (isFixedFeedProvider(provider))
    return fetchFixedFeedNews(provider, subjectMatchTerms(subject), options);
  return fetchFinvizNews(requiredTicker(provider, subject), options);
}

function providerRequestUrls(
  provider: NewsProvider,
  subject: NewsSubject,
  query: NewsFeedOptions,
): readonly string[] {
  if (unsupportedReason(provider, subject)) return [];
  const options = hasDateWindowBounds(normalizeDateWindow(query))
    ? newsFeedOptionsWithoutLimit(query)
    : query;
  if (provider === "yahoo-finance") return [yahooFinanceRssUrl(requiredTicker(provider, subject))];
  if (provider === "google-news") return [googleNewsRssUrl(googleQueryFromSubject(subject))];
  if (provider === "sec-edgar") {
    const identifier = subject.cik ?? requiredTicker(provider, subject);
    return query.secForms?.length
      ? query.secForms.map((form) => secCompanyAtomUrl(identifier, form))
      : [secCompanyAtomUrl(identifier)];
  }
  if (provider === "bing-news") return [bingNewsRssUrl(googleQueryFromSubject(subject))];
  if (provider === "gdelt") return [gdeltDocUrl(gdeltQueryFromSubject(subject), options)];
  if (provider === "tickertick")
    return [tickerTickFeedUrl(requiredTicker(provider, subject), options.limit)];
  if (provider === "hacker-news")
    return [hackerNewsSearchUrl(plainQueryFromSubject(subject), options.limit)];
  if (provider === "yahoo-search")
    return [yahooSearchUrl(yahooSearchQueryFromSubject(subject), options.limit)];
  if (provider === "sec-fulltext") {
    return [
      secFullTextSearchUrl(plainQueryFromSubject(subject), {
        ...options,
        ...(query.secForms?.length ? { forms: query.secForms } : {}),
        ...(subject.ticker ? { ticker: subject.ticker } : {}),
      }),
    ];
  }
  if (provider === "sec-current") {
    const company =
      subject.kind === "company" ? requiredCompanyNameOrTopic(provider, subject) : undefined;
    const count = options.limit ?? 40;
    return query.secForms?.length
      ? query.secForms.map((form) => secCurrentAtomUrl(company, form, count))
      : [secCurrentAtomUrl(company, undefined, count)];
  }
  if (provider === "federal-register")
    return [federalRegisterSearchUrl(requiredCompanyNameOrTopic(provider, subject), options)];
  if (provider === "courtlistener")
    return [courtListenerSearchUrl(requiredCompanyNameOrTopic(provider, subject), options)];
  if (provider === "msrb-emma")
    return msrbEmmaPeriods(options).map((period) => msrbEmmaCdUrl(period));
  if (provider === "nasdaq") return [nasdaqRssUrl(requiredTicker(provider, subject))];
  if (provider === "seeking-alpha") return [seekingAlphaRssUrl(requiredTicker(provider, subject))];
  if (isFixedFeedProvider(provider)) return FIXED_FEEDS[provider].urls;
  return [finvizQuoteUrl(requiredTicker(provider, subject))];
}

function filterItemsByDateWindow(items: readonly NewsItem[], window: DateWindow): NewsItem[] {
  if (!hasDateWindowBounds(window)) return [...items];
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    const publishedAtMs = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedAtMs)) return false;
    if (window.sinceMs !== undefined && publishedAtMs < window.sinceMs) return false;
    return window.untilMs === undefined || publishedAtMs <= window.untilMs;
  });
}

function annotateNewsItem(item: NewsItem, subject: NewsSubject): NewsItem {
  const classification = classifyMarketEvent(item);
  const tags = uniqueSorted([...(item.tags ?? []), ...classification.tags]);
  return {
    ...item,
    ...(subject.kind === "company" && !item.ticker && subject.ticker
      ? { ticker: subject.ticker }
      : {}),
    ...(subject.kind === "company" && subject.companyName
      ? { companyName: subject.companyName }
      : {}),
    ...(subject.kind === "company" && subject.cik ? { cik: subject.cik } : {}),
    ...(item.canonicalUrl
      ? { canonicalUrl: item.canonicalUrl }
      : item.provider !== "google-news"
        ? { canonicalUrl: item.url }
        : {}),
    ...(classification.eventKind ? { eventKind: classification.eventKind } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function normalizeSubject(input: NewsSubjectInput): NewsSubject {
  if (input.kind === "topic") {
    const query = collapseWhitespace(input.query);
    if (!query) throw new RangeError("topic subject requires query");
    return { kind: "topic", key: query, displayName: query, query };
  }

  const ticker = input.ticker?.trim().toUpperCase() || undefined;
  const cik = input.cik?.trim() || undefined;
  const companyName = input.companyName
    ? collapseWhitespace(input.companyName) || undefined
    : undefined;
  if (!ticker && !companyName && !cik) {
    throw new RangeError("company subject requires ticker, companyName, or cik");
  }

  return {
    kind: "company",
    key: ticker ?? cik ?? companyName ?? "",
    displayName: companyName ?? ticker ?? cik ?? "",
    ...(ticker ? { ticker } : {}),
    ...(companyName ? { companyName } : {}),
    ...(cik ? { cik } : {}),
  };
}

function sourcesForSubject(
  subject: NewsSubject,
  sources: readonly NewsProvider[] | undefined,
): readonly NewsProvider[] {
  if (sources?.length) return sources;
  return subject.kind === "topic" ? DEFAULT_TOPIC_SOURCES : DEFAULT_COMPANY_SOURCES;
}

function unsupportedReason(provider: NewsProvider, subject: NewsSubject): string | undefined {
  if (provider === "youtube") {
    return "youtube: channel-feed provider without subject search; use fetchYoutubeSubscriptions or fetchYoutubeChannelVideos";
  }
  if (subject.kind === "topic") {
    return providerCapabilities(provider).includes("topic")
      ? undefined
      : `${provider}: topic subjects are unsupported`;
  }

  const requirement = COMPANY_SUBJECT_REQUIREMENTS[provider] ?? "name-or-ticker";
  if (requirement === "ticker" && !subject.ticker) {
    return `${provider}: company ticker is required`;
  }
  if (requirement === "ticker-or-cik" && !subject.cik && !subject.ticker) {
    return `${provider}: company ticker or CIK is required`;
  }
  if (requirement === "name-or-ticker" && !subject.companyName && !subject.ticker) {
    return `${provider}: companyName or ticker is required`;
  }
  if (requirement === "name" && !subject.companyName) {
    return `${provider}: companyName is required`;
  }
  return undefined;
}

function googleQueryFromSubject(subject: NewsSubject): string {
  if (subject.kind === "topic") return subject.query ?? subject.displayName;
  if (subject.companyName && subject.ticker) return `"${subject.companyName}" ${subject.ticker}`;
  return subject.companyName ?? subject.ticker ?? subject.displayName;
}

function gdeltQueryFromSubject(subject: NewsSubject): string {
  if (subject.kind === "topic") return subject.query ?? subject.displayName;
  if (subject.companyName) return `"${subject.companyName.replace(/"/g, "")}"`;
  return subject.ticker ?? subject.displayName;
}

function plainQueryFromSubject(subject: NewsSubject): string {
  if (subject.kind === "topic") return subject.query ?? subject.displayName;
  return subject.companyName ?? subject.ticker ?? subject.displayName;
}

function yahooSearchQueryFromSubject(subject: NewsSubject): string {
  if (subject.kind === "topic") return subject.query ?? subject.displayName;
  return subject.ticker ?? subject.companyName ?? subject.displayName;
}

function requiredCompanyNameOrTopic(provider: NewsProvider, subject: NewsSubject): string {
  if (subject.kind === "topic") return subject.query ?? subject.displayName;
  if (!subject.companyName) throw new Error(`${provider}: companyName is required`);
  return subject.companyName;
}

function subjectMatchTerms(subject: NewsSubject): SubjectMatchTerms {
  if (subject.kind === "topic") {
    return { query: subject.query ?? subject.displayName };
  }
  return {
    ...(subject.ticker ? { ticker: subject.ticker } : {}),
    ...(subject.companyName ? { companyName: subject.companyName } : {}),
  };
}

function requiredTicker(provider: NewsProvider, subject: NewsSubject): string {
  if (!subject.ticker) throw new Error(`${provider}: company ticker is required`);
  return subject.ticker;
}

function newsFeedOptionsWithoutLimit(query: NewsFeedOptions): NewsFeedOptions {
  const { limit, ...options } = query;
  void limit;
  return options;
}

function hasDateWindowBounds(window: DateWindow): boolean {
  return window.sinceMs !== undefined || window.untilMs !== undefined;
}

function canonicalItemKey(item: NewsItem): string {
  const canonicalUrl = item.canonicalUrl ? normalizeUrl(item.canonicalUrl) : "";
  if (canonicalUrl) return `url:${canonicalUrl}`;
  const itemUrl = normalizeUrl(item.url);
  if (itemUrl) return `url:${itemUrl}`;
  if (item.accessionNumber) return `sec-edgar:${item.accessionNumber}`;

  const titleKey = collapseWhitespace(item.title).toLowerCase();
  const sourceKey = collapseWhitespace(item.source).toLowerCase();
  const dateKey = item.publishedAt ?? item.publishedAtText ?? "";
  if (titleKey && sourceKey) return `title:${titleKey}|${dateKey}|${sourceKey}`;
  return `id:${item.id}`;
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const param of [
      ".tsrc",
      "guccounter",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ]) {
      parsed.searchParams.delete(param);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function mergeDuplicateItems(existing: NewsItem, incoming: NewsItem): NewsItem {
  const displayBase = scoreItem(incoming) > scoreItem(existing) ? incoming : existing;
  const seenInProviders = uniqueSorted([
    ...(existing.seenInProviders ?? [existing.provider]),
    ...(incoming.seenInProviders ?? [incoming.provider]),
  ]);
  const provenance = uniqueProvenance([
    ...(existing.provenance ?? [defaultProvenance(existing)]),
    ...(incoming.provenance ?? [defaultProvenance(incoming)]),
  ]);
  const relatedTickers = uniqueSorted([
    ...(existing.relatedTickers ?? []),
    ...(incoming.relatedTickers ?? []),
  ]);
  const tags = uniqueSorted([...(existing.tags ?? []), ...(incoming.tags ?? [])]);

  return {
    ...displayBase,
    seenInProviders,
    provenance,
    ...(relatedTickers.length > 0 ? { relatedTickers } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

function defaultProvenance(item: NewsItem): NewsItemProvenance {
  return { provider: item.provider, source: item.source, url: item.url };
}

function uniqueProvenance(items: readonly NewsItemProvenance[]): NewsItemProvenance[] {
  const byKey = new Map<string, NewsItemProvenance>();
  for (const item of items) {
    byKey.set(`${item.provider}|${item.source}|${item.url}`, item);
  }
  return [...byKey.values()].toSorted(
    (left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.source.localeCompare(right.source) ||
      left.url.localeCompare(right.url),
  );
}

function uniqueSorted<T extends string>(items: readonly T[]): T[] {
  return [...new Set(items)].toSorted();
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compareNewsItems(left: NewsItem, right: NewsItem): number {
  const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;
  const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
  if (rightTime !== leftTime) return rightTime - leftTime;
  return right.id.localeCompare(left.id);
}

function scoreItem(item: NewsItem): number {
  let score = item.publishedAt ? 4 : 0;
  if (item.provider === "sec-edgar") score += 3;
  if (item.url.includes("sec.gov") || item.url.includes("businesswire.com")) score += 2;
  if (item.summary) score += 1;
  if (item.canonicalUrl) score += 1;
  if (item.eventKind) score += 1;
  if (item.tags?.length) score += 1;
  return score;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timeout = setTimeout(resolve, ms);
  const onAbort = (): void => {
    clearTimeout(timeout);
    reject(signal?.reason instanceof Error ? signal.reason : new Error("News watcher aborted"));
  };

  signal?.addEventListener("abort", onAbort, { once: true });
  return promise.finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  });
}

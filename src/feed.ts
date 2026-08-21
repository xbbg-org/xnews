import { sleep } from "./async.js";
import { classifyMarketEvent } from "./classify.js";
import { redactUrl, XnewsFetchError } from "./errors.js";
import { providerErrorFromUnknown } from "./http.js";
import { normalizeDateWindow, normalizeLimit, type DateWindow } from "./options.js";
import { arxivSearchUrl, fetchArxivPapers } from "./sources/arxiv.js";
import { fetchBingNews, bingNewsRssUrl } from "./sources/bing.js";
import { bioRxivDetailsUrl, fetchBioRxivPapers } from "./sources/biorxiv.js";
import {
  BIS_RESEARCH_HUB_RSS_URL,
  BIS_WORKING_PAPERS_URL,
  fetchBisResearchHubRecent,
  fetchBisWorkingPapers,
} from "./sources/bis.js";
import { crossrefWorksUrl, fetchCrossrefWorks } from "./sources/crossref.js";
import { fetchCourtListenerNews, courtListenerSearchUrl } from "./sources/courtlistener.js";
import { europePmcSearchUrl, fetchEuropePmcPapers } from "./sources/europepmc.js";
import { fetchFederalRegisterNews, federalRegisterSearchUrl } from "./sources/federalregister.js";
import { fetchFinvizNews, finvizQuoteUrl } from "./sources/finviz.js";
import {
  FIXED_FEEDS,
  fetchFixedFeedNews,
  fetchFixedFeedNewsResult,
  isFixedFeedProvider,
  type FixedFeedFetchFailure,
} from "./sources/fixedfeeds.js";
import { fetchGdeltNews, gdeltDocUrl } from "./sources/gdelt.js";
import { fetchGoogleNews, googleNewsRssUrl } from "./sources/google.js";
import { fetchHackerNewsStories, hackerNewsSearchUrl } from "./sources/hackernews.js";
import { fetchHfDailyPapers, hfDailyPapersUrl } from "./sources/hfpapers.js";
import {
  earningsTranscriptsFilterUrl,
  fetchEarningsCallTranscriptNews,
} from "./sources/hftranscripts.js";
import type { SubjectMatchTerms } from "./sources/match.js";
import { fetchMsrbEmmaDisclosures, msrbEmmaCdUrl, msrbEmmaPeriods } from "./sources/msrbemma.js";
import { fetchNasdaqNews, nasdaqRssUrl } from "./sources/nasdaq.js";
import { fetchNberWorkingPapers, nberListingUrl } from "./sources/nber.js";
import { fetchSecFilings, secCompanyAtomUrl } from "./sources/sec.js";
import { fetchOfacActions, OFAC_RECENT_ACTIONS_URL } from "./sources/ofac.js";
import { fetchOpenAlexWorks, openAlexWorksUrl } from "./sources/openalex.js";
import { fetchOsfPreprints, osfPreprintsUrl } from "./sources/osf.js";
import { fetchSecCurrentFilings, secCurrentAtomUrl } from "./sources/seccurrent.js";
import { fetchSecFullTextFilings, secFullTextSearchUrl } from "./sources/secfulltext.js";
import { fetchSeekingAlphaNews, seekingAlphaRssUrl } from "./sources/seekingalpha.js";
import { fetchSsrnPapers, ssrnPapersUrl } from "./sources/ssrn.js";
import { fetchTickerTickNews, tickerTickFeedUrl } from "./sources/tickertick.js";
import { fetchWorldBankDocuments, worldBankDocumentsUrl } from "./sources/worldbank.js";
import { fetchWhoOutbreaks, WHO_DISEASE_OUTBREAK_NEWS_URL } from "./sources/whooutbreaks.js";
import { fetchYahooFinanceNews, yahooFinanceRssUrl } from "./sources/yahoo.js";
import { fetchYahooSearchNews, yahooSearchUrl } from "./sources/yahoosearch.js";
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
  ResearchPaper,
  TopicNewsQuery,
  WatchlistNewsFeedResult,
  WatchlistNewsOptions,
  WatchlistNewsQuery,
  WatchNewsOptions,
  WatchTopicNewsOptions,
} from "./types.js";

const DEFAULT_COMPANY_SOURCES: readonly NewsProvider[] = [
  "sec-edgar",
  "yahoo-finance",
  "google-news",
  "finviz",
];
const DEFAULT_TOPIC_SOURCES: readonly NewsProvider[] = ["google-news"];
/** Providers whose native query surface absorbs `since`/`until`, so a date window keeps their limit. */
const NATIVE_DATE_WINDOW_PROVIDERS: ReadonlySet<NewsProvider> = new Set([
  "arxiv",
  "openalex",
  "crossref",
  "europe-pmc",
  "world-bank",
]);
const PARTIAL_STATUSES = new Set(["error", "unsupported", "partial", "disabled"]);
const WATCH_SUCCESS_STATUSES: Partial<Record<ProviderResult["status"], true>> = {
  ok: true,
  empty: true,
  partial: true,
};

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
  "hf-transcripts": ["company"],
  arxiv: ["company", "topic"],
  openalex: ["company", "topic"],
  "bis-research": ["company", "topic"],
  "bis-research-hub": ["company", "topic"],
  nber: ["company", "topic"],
  ssrn: ["company", "topic"],
  crossref: ["company", "topic"],
  "world-bank": ["company", "topic"],
  biorxiv: ["company", "topic"],
  medrxiv: ["company", "topic"],
  "europe-pmc": ["company", "topic"],
  "hf-papers": ["company", "topic"],
  "osf-preprints": ["company", "topic"],
  ofac: ["company", "topic"],
  "who-outbreaks": ["company", "topic"],
  youtube: [],
  "cftc-cot": [],
  "ffiec-cdr": [],
  "dtcc-sdr": [],
};

type CompanySubjectRequirement = "ticker" | "ticker-or-cik" | "name-or-ticker" | "name";

const COMPANY_SUBJECT_REQUIREMENTS: Partial<Record<NewsProvider, CompanySubjectRequirement>> = {
  "yahoo-finance": "ticker",
  finviz: "ticker",
  tickertick: "ticker",
  nasdaq: "ticker",
  "seeking-alpha": "ticker",
  "hf-transcripts": "ticker",
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
  yield* watchItems(async () => {
    const result = await buildCompanyNewsFeedResult(options);
    return watcherResultItems(result, options.strict, "News feed");
  }, options);
}

export async function* createTopicNewsWatcher(
  options: WatchTopicNewsOptions,
): AsyncGenerator<NewsItem[]> {
  yield* watchItems(async () => {
    const result = await buildTopicNewsFeedResult(options);
    return watcherResultItems(result, options.strict, "Topic news feed");
  }, options);
}

export async function* createWatchlistNewsWatcher(
  options: WatchlistNewsOptions,
): AsyncGenerator<NewsItem[]> {
  yield* watchItems(async () => {
    const result = await buildWatchlistNewsFeedResult(options);
    return watcherResultItems(result, options.strict, "Watchlist news feed");
  }, options);
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
    await sleep(intervalMs, options.signal, "News watcher aborted");
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

  let requestUrls: readonly string[] = [];
  try {
    requestUrls = providerRequestUrls(provider, subject, query);
    if (isFixedFeedProvider(provider)) {
      const sourceResult = await fetchFixedFeedNewsResult(
        provider,
        subjectMatchTerms(subject),
        newsFeedOptionsWithoutLimit(query),
      );
      const windowed = filterItemsByDateWindow(sourceResult.items, dateWindow);
      const items = windowed.items.map((item) => annotateNewsItem(item, subject));
      const warnings = sourceResult.failures.map((failure) =>
        fixedFeedFailureWarning(provider, failure),
      );
      const firstFailure = sourceResult.failures[0];
      const error = firstFailure ? fixedFeedProviderError(firstFailure) : undefined;
      return providerResult({
        provider,
        capabilities,
        status:
          sourceResult.failures.length === 0
            ? items.length > 0
              ? "ok"
              : "empty"
            : sourceResult.successfulUrls.length > 0
              ? "partial"
              : "error",
        items,
        undatedExcluded: windowed.undatedExcluded,
        warnings,
        startedAt,
        requestUrls,
        ...(error ? { error } : {}),
      });
    }
    const sourceItems = await fetchSource(provider, subject, query, dateWindow);
    const windowed = filterItemsByDateWindow(sourceItems, dateWindow);
    const items = windowed.items.map((item) => annotateNewsItem(item, subject));
    return providerResult({
      provider,
      capabilities,
      status: items.length > 0 ? "ok" : "empty",
      items,
      undatedExcluded: windowed.undatedExcluded,
      warnings: [],
      startedAt,
      requestUrls,
    });
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    return providerResult({
      provider,
      capabilities,
      // A config precondition (SEC User-Agent, EMMA terms) is the caller's
      // decision, not a transport failure: the provider is disabled until the
      // caller supplies it.
      status: providerError.code === "config" ? "disabled" : "error",
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
  readonly undatedExcluded?: number;
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
    undatedExcluded: options.undatedExcluded ?? 0,
    warnings: options.warnings,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAt,
    requestUrls: options.requestUrls,
    ...(options.error ? { error: options.error } : {}),
  };
}

async function fetchSource(
  provider: NewsProvider,
  subject: NewsSubject,
  query: NewsFeedOptions,
  dateWindow: DateWindow,
): Promise<NewsItem[]> {
  const options =
    hasDateWindowBounds(dateWindow) && !NATIVE_DATE_WINDOW_PROVIDERS.has(provider)
      ? newsFeedOptionsWithoutLimit(query)
      : query;

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
  if (provider === "hf-transcripts")
    return fetchEarningsCallTranscriptNews(requiredTicker(provider, subject), options);
  if (provider === "arxiv") {
    return filterArxivCategories(
      await fetchArxivPapers(
        arxivQueryFromSubject(subject, query.arxivCategories, dateWindow),
        options,
      ),
      query.arxivCategories,
      options.limit,
    );
  }
  if (provider === "openalex") {
    return (
      await fetchOpenAlexWorks(plainQueryFromSubject(subject), {
        ...options,
        apiKey: query.openAlexApiKey ?? "",
        ...(hasDateWindowBounds(dateWindow) ? { filters: openAlexDateFilters(dateWindow) } : {}),
      })
    ).items;
  }
  if (provider === "bis-research") {
    return filterBisWorkingPapers(
      await fetchBisWorkingPapers(newsFeedOptionsWithoutLimit(options)),
      plainQueryFromSubject(subject),
      query.bisInstitutions,
      options.limit,
    );
  }
  if (provider === "bis-research-hub") {
    return fetchBisResearchHubRecent({
      ...options,
      query: plainQueryFromSubject(subject),
      ...(query.bisInstitutions !== undefined ? { institutions: query.bisInstitutions } : {}),
    });
  }
  if (provider === "nber") {
    return fetchNberWorkingPapers({ ...options, q: plainQueryFromSubject(subject) });
  }
  if (provider === "ssrn") {
    const networks = query.ssrnNetworks?.length ? query.ssrnNetworks : (["fen"] as const);
    const pages = await Promise.all(
      networks.map((network) => fetchSsrnPapers(network, newsFeedOptionsWithoutLimit(options))),
    );
    return filterResearchPapersByQuery(pages.flat(), plainQueryFromSubject(subject), options.limit);
  }
  if (provider === "crossref") {
    return (
      await fetchCrossrefWorks(plainQueryFromSubject(subject), {
        ...options,
        filters: { ...crossrefDateFilters(dateWindow), ...query.crossrefFilters },
      })
    ).items;
  }
  if (provider === "world-bank") {
    return fetchWorldBankDocuments(
      plainQueryFromSubject(subject),
      worldBankFeedOptions(options, query, dateWindow),
    );
  }
  if (provider === "biorxiv" || provider === "medrxiv") {
    return filterResearchPapersByQuery(
      await fetchBioRxivPapers({
        ...newsFeedOptionsWithoutLimit(options),
        server: provider,
        ...bioRxivWindow(dateWindow),
        ...(query.bioRxivCategories?.length ? { categories: query.bioRxivCategories } : {}),
      }),
      plainQueryFromSubject(subject),
      options.limit,
    );
  }
  if (provider === "europe-pmc") {
    return (
      await fetchEuropePmcPapers(europePmcFeedQuery(subject, dateWindow), {
        ...options,
        sort: "P_PDATE_D desc",
      })
    ).items;
  }
  if (provider === "hf-papers") {
    return filterResearchPapersByQuery(
      await fetchHfDailyPapers(newsFeedOptionsWithoutLimit(options)),
      plainQueryFromSubject(subject),
      options.limit,
    );
  }
  if (provider === "osf-preprints") {
    return filterResearchPapersByQuery(
      (
        await fetchOsfPreprints({
          ...newsFeedOptionsWithoutLimit(options),
          ...(query.osfProviders?.length ? { providers: query.osfProviders } : {}),
          ...osfDateFilters(dateWindow),
        })
      ).items,
      plainQueryFromSubject(subject),
      options.limit,
    );
  }
  if (isFixedFeedProvider(provider))
    return fetchFixedFeedNews(provider, subjectMatchTerms(subject), options);
  if (provider === "finviz") return fetchFinvizNews(requiredTicker(provider, subject), options);
  if (provider === "ofac") return fetchOfacActions(subjectMatchTerms(subject), options);
  if (provider === "who-outbreaks") {
    return fetchWhoOutbreaks(subjectMatchTerms(subject), options);
  }
  if (
    provider === "youtube" ||
    provider === "cftc-cot" ||
    provider === "ffiec-cdr" ||
    provider === "dtcc-sdr"
  ) {
    throw new Error(`${provider}: provider dispatch is unreachable after capability validation`);
  }
  return unreachableProvider(provider);
}

function providerRequestUrls(
  provider: NewsProvider,
  subject: NewsSubject,
  query: NewsFeedOptions,
): readonly string[] {
  if (unsupportedReason(provider, subject)) return [];
  const dateWindow = normalizeDateWindow(query);
  const options =
    hasDateWindowBounds(dateWindow) && !NATIVE_DATE_WINDOW_PROVIDERS.has(provider)
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
  if (provider === "hf-transcripts")
    return [earningsTranscriptsFilterUrl(requiredTicker(provider, subject), options)];
  if (provider === "arxiv") {
    return [
      arxivSearchUrl(arxivQueryFromSubject(subject, query.arxivCategories, dateWindow), options),
    ];
  }
  if (provider === "openalex") {
    const url = openAlexWorksUrl(plainQueryFromSubject(subject), {
      ...options,
      apiKey: query.openAlexApiKey?.trim() || "<redacted>",
      ...(hasDateWindowBounds(dateWindow) ? { filters: openAlexDateFilters(dateWindow) } : {}),
    });
    return [redactOpenAlexApiKey(url)];
  }
  if (provider === "nber") {
    return [
      nberListingUrl({
        q: plainQueryFromSubject(subject),
        ...(options.limit ? { perPage: options.limit } : {}),
      }),
    ];
  }
  if (provider === "ssrn") {
    const networks = query.ssrnNetworks?.length ? query.ssrnNetworks : (["fen"] as const);
    return networks.map((network) => ssrnPapersUrl(network));
  }
  if (provider === "crossref") {
    return [
      crossrefWorksUrl(plainQueryFromSubject(subject), {
        ...options,
        filters: { ...crossrefDateFilters(dateWindow), ...query.crossrefFilters },
      }),
    ];
  }
  if (provider === "world-bank") {
    return [
      worldBankDocumentsUrl(
        plainQueryFromSubject(subject),
        worldBankFeedOptions(options, query, dateWindow),
      ),
    ];
  }
  if (provider === "biorxiv" || provider === "medrxiv") {
    const window = bioRxivWindow(dateWindow);
    const to = window.to ?? isoDateFromMs(Date.now());
    const from = window.from ?? isoDateFromMs(Date.now() - 7 * 24 * 60 * 60 * 1_000);
    return [bioRxivDetailsUrl(provider, { from, to })];
  }
  if (provider === "europe-pmc") {
    return [
      europePmcSearchUrl(europePmcFeedQuery(subject, dateWindow), {
        ...(options.limit ? { pageSize: options.limit } : {}),
        sort: "P_PDATE_D desc",
      }),
    ];
  }
  if (provider === "hf-papers") return [hfDailyPapersUrl()];
  if (provider === "osf-preprints") {
    return [
      osfPreprintsUrl({
        ...(query.osfProviders?.length ? { providers: query.osfProviders } : {}),
        ...osfDateFilters(dateWindow),
      }),
    ];
  }
  if (
    provider === "youtube" ||
    provider === "cftc-cot" ||
    provider === "ffiec-cdr" ||
    provider === "dtcc-sdr"
  ) {
    throw new Error(`${provider}: provider dispatch is unreachable after capability validation`);
  }
  if (provider === "bis-research") return [BIS_WORKING_PAPERS_URL];
  if (provider === "bis-research-hub") return [BIS_RESEARCH_HUB_RSS_URL];
  if (isFixedFeedProvider(provider)) return FIXED_FEEDS[provider].urls;
  if (provider === "finviz") return [finvizQuoteUrl(requiredTicker(provider, subject))];
  if (provider === "ofac") return [OFAC_RECENT_ACTIONS_URL];
  if (provider === "who-outbreaks") return [WHO_DISEASE_OUTBREAK_NEWS_URL];
  return unreachableProvider(provider);
}

function filterItemsByDateWindow(
  items: readonly NewsItem[],
  window: DateWindow,
): { readonly items: NewsItem[]; readonly undatedExcluded: number } {
  if (!hasDateWindowBounds(window)) return { items: [...items], undatedExcluded: 0 };
  let undatedExcluded = 0;
  const kept = items.filter((item) => {
    if (!item.publishedAt) {
      undatedExcluded += 1;
      return false;
    }
    const publishedAtMs = Date.parse(item.publishedAt);
    if (!Number.isFinite(publishedAtMs)) {
      undatedExcluded += 1;
      return false;
    }
    if (window.sinceMs !== undefined && publishedAtMs < window.sinceMs) return false;
    return window.untilMs === undefined || publishedAtMs <= window.untilMs;
  });
  return { items: kept, undatedExcluded };
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
  if (provider === "cftc-cot") {
    return "cftc-cot: scheduled-release data provider without subject search; use fetchCotReport and cotReleaseToNewsItems";
  }
  if (provider === "ffiec-cdr") {
    return "ffiec-cdr: scheduled-release data provider without subject search; use fetchFfiecCallReport and ffiecReleaseToNewsItems";
  }
  if (provider === "dtcc-sdr") {
    return "dtcc-sdr: real-time data provider without subject search; use fetchDtccSliceCatalog, fetchDtccCumulativeEvents, and dtccReleaseToNewsItems";
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
function arxivQueryFromSubject(
  subject: NewsSubject,
  categories: string | readonly string[] | undefined,
  dateWindow: DateWindow,
): string {
  const escapedSubject = plainQueryFromSubject(subject)
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  const values = typeof categories === "string" ? [categories] : (categories ?? []);
  const categoryTerms = values.map((value) => {
    const category = value.trim();
    if (!/^[A-Za-z]+(?:-[A-Za-z]+)*(?:\.[A-Za-z]+(?:-[A-Za-z]+)*)?$/.test(category)) {
      throw new XnewsFetchError("config", `Invalid arXiv category: ${category}`, {
        url: "https://export.arxiv.org/api/query",
      });
    }
    return `cat:${category.includes(".") ? category : `${category}.*`}`;
  });
  const subjectTerm = `all:"${escapedSubject}"`;
  const categoryQuery =
    categoryTerms.length === 0 ? subjectTerm : `(${categoryTerms.join(" OR ")}) AND ${subjectTerm}`;
  if (!hasDateWindowBounds(dateWindow)) return categoryQuery;
  const since = dateWindow.sinceMs === undefined ? "*" : arxivSubmittedDate(dateWindow.sinceMs);
  const until = dateWindow.untilMs === undefined ? "*" : arxivSubmittedDate(dateWindow.untilMs);
  return `${categoryQuery} AND submittedDate:[${since} TO ${until}]`;
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

function filterArxivCategories(
  papers: readonly ResearchPaper[],
  categories: string | readonly string[] | undefined,
  limit: number | undefined,
): ResearchPaper[] {
  const values = typeof categories === "string" ? [categories] : (categories ?? []);
  const requested = values.map(normalizeResearchFilter).filter(Boolean);
  const filtered =
    requested.length === 0
      ? [...papers]
      : papers.filter((paper) =>
          (paper.research.categories ?? []).some((category) => {
            const normalized = normalizeResearchFilter(category);
            return requested.some(
              (value) => normalized === value || normalized.startsWith(`${value} `),
            );
          }),
        );
  return limit === undefined ? filtered : filtered.slice(0, limit);
}

function filterBisWorkingPapers(
  papers: readonly ResearchPaper[],
  query: string,
  institutions: readonly string[] | undefined,
  limit: number | undefined,
): ResearchPaper[] {
  const requestedInstitutions = new Set(
    (institutions ?? []).map(normalizeResearchFilter).filter(Boolean),
  );
  const queryTerms = normalizeResearchFilter(query).split(" ").filter(Boolean);
  const filtered = papers.filter((paper) => {
    const institution = normalizeResearchFilter(paper.research.institution ?? "");
    if (requestedInstitutions.size > 0 && !requestedInstitutions.has(institution)) return false;
    return researchPaperMatchesQuery(paper, queryTerms);
  });
  return limit === undefined ? filtered : filtered.slice(0, limit);
}

function filterResearchPapersByQuery(
  papers: readonly ResearchPaper[],
  query: string,
  limit: number | undefined,
): ResearchPaper[] {
  const queryTerms = normalizeResearchFilter(query).split(" ").filter(Boolean);
  const filtered = papers.filter((paper) => researchPaperMatchesQuery(paper, queryTerms));
  return limit === undefined ? filtered : filtered.slice(0, limit);
}

function researchPaperMatchesQuery(paper: ResearchPaper, queryTerms: readonly string[]): boolean {
  const haystack = normalizeResearchFilter(
    [
      paper.title,
      paper.summary,
      ...(paper.research.authors ?? []),
      paper.research.institution,
      paper.research.series,
      ...(paper.research.categories ?? []),
      ...(paper.research.jelCodes ?? []),
    ]
      .filter((value): value is string => value !== undefined)
      .join(" "),
  );
  return queryTerms.every((term) => haystack.includes(term));
}

function normalizeResearchFilter(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function redactOpenAlexApiKey(value: string): string {
  const url = new URL(value);
  url.searchParams.set("api_key", "<redacted>");
  return url.toString();
}

function watcherResultItems(
  result: {
    readonly items: readonly NewsItem[];
    readonly providers: readonly ProviderResult[];
    readonly warnings: readonly string[];
  },
  strict: boolean | undefined,
  label: string,
): NewsItem[] {
  if (strict && result.warnings.length > 0) {
    throw new Error(`${label} incomplete: ${result.warnings.join("; ")}`);
  }
  if (!result.providers.some((provider) => WATCH_SUCCESS_STATUSES[provider.status])) {
    const detail = result.warnings.length > 0 ? result.warnings.join("; ") : "all providers failed";
    throw new Error(`${label} unavailable: ${detail}`);
  }
  return [...result.items];
}

function fixedFeedProviderError(failure: FixedFeedFetchFailure): ProviderError {
  const cause = providerErrorFromUnknown(failure.error);
  const url = redactUrl(failure.url);
  const code = cause.code ?? "unknown";
  const detail = cause.status === undefined ? code : `HTTP ${cause.status}`;
  return {
    message: `${url} failed (${detail})`,
    code,
    ...(cause.status !== undefined ? { status: cause.status } : {}),
    url,
  };
}

function fixedFeedFailureWarning(provider: NewsProvider, failure: FixedFeedFetchFailure): string {
  return `${provider}: ${fixedFeedProviderError(failure).message}`;
}

function openAlexDateFilters(window: DateWindow): Readonly<Record<string, string>> {
  return {
    ...(window.sinceMs !== undefined
      ? { from_publication_date: new Date(window.sinceMs).toISOString().slice(0, 10) }
      : {}),
    ...(window.untilMs !== undefined
      ? { to_publication_date: new Date(window.untilMs).toISOString().slice(0, 10) }
      : {}),
  };
}

function isoDateFromMs(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function crossrefDateFilters(window: DateWindow): Readonly<Record<string, string>> {
  return {
    ...(window.sinceMs !== undefined ? { "from-pub-date": isoDateFromMs(window.sinceMs) } : {}),
    ...(window.untilMs !== undefined ? { "until-pub-date": isoDateFromMs(window.untilMs) } : {}),
  };
}

function bioRxivWindow(window: DateWindow): { readonly from?: string; readonly to?: string } {
  return {
    ...(window.sinceMs !== undefined ? { from: isoDateFromMs(window.sinceMs) } : {}),
    ...(window.untilMs !== undefined ? { to: isoDateFromMs(window.untilMs) } : {}),
  };
}

function osfDateFilters(window: DateWindow): {
  readonly publishedSince?: string;
  readonly publishedUntil?: string;
} {
  return {
    ...(window.sinceMs !== undefined ? { publishedSince: isoDateFromMs(window.sinceMs) } : {}),
    ...(window.untilMs !== undefined ? { publishedUntil: isoDateFromMs(window.untilMs) } : {}),
  };
}

function europePmcFeedQuery(subject: NewsSubject, window: DateWindow): string {
  const query = plainQueryFromSubject(subject);
  if (!hasDateWindowBounds(window)) return query;
  const since = window.sinceMs === undefined ? "1900-01-01" : isoDateFromMs(window.sinceMs);
  const until =
    window.untilMs === undefined ? isoDateFromMs(Date.now()) : isoDateFromMs(window.untilMs);
  return `(${query}) AND FIRST_PDATE:[${since} TO ${until}]`;
}

function worldBankFeedOptions(
  options: NewsFeedOptions,
  query: NewsFeedOptions,
  window: DateWindow,
) {
  const { since, until, limit, ...rest } = options;
  void since;
  void until;
  return {
    ...rest,
    sortBy: "docdt",
    order: "desc" as const,
    ...(limit ? { rows: limit } : {}),
    ...(query.worldBankDocTypes?.length ? { docTypes: query.worldBankDocTypes } : {}),
    ...(window.sinceMs !== undefined ? { since: isoDateFromMs(window.sinceMs) } : {}),
    ...(window.untilMs !== undefined ? { until: isoDateFromMs(window.untilMs) } : {}),
  };
}

function arxivSubmittedDate(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/\D/g, "").slice(0, 12);
}

function unreachableProvider(provider: never): never {
  throw new Error(`Unsupported news provider: ${String(provider)}`);
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

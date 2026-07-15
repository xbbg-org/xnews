export type {
  CompanyNewsQuery,
  CompanyNewsSubjectInput,
  MarketEventKind,
  NewsFeedOptions,
  NewsFeedQuery,
  NewsFeedResult,
  NewsItem,
  NewsItemProvenance,
  NewsKind,
  NewsProvider,
  NewsProviderCapability,
  NewsSubject,
  NewsSubjectInput,
  ProviderError,
  ProviderResult,
  ProviderStatus,
  SourceFetchOptions,
  TopicNewsQuery,
  TopicNewsSubjectInput,
  WatchlistNewsFeedResult,
  WatchlistNewsOptions,
  WatchlistNewsQuery,
  WatchlistSubjectResult,
  WatchNewsOptions,
  WatchTopicNewsOptions,
} from "./types";

export type { MarketEventClassification } from "./classify";

export {
  buildCompanyNewsFeed,
  buildCompanyNewsFeedResult,
  buildNewsFeed,
  buildNewsFeedResult,
  buildTopicNewsFeed,
  buildTopicNewsFeedResult,
  buildWatchlistNewsFeed,
  buildWatchlistNewsFeedResult,
  createNewsWatcher,
  createTopicNewsWatcher,
  createWatchlistNewsWatcher,
  mergeNewsItems,
  providerCapabilities,
} from "./feed";
export { classifyMarketEvent } from "./classify";
export { bingNewsRssUrl, fetchBingNews, parseBingNews } from "./sources/bing";
export {
  courtListenerSearchUrl,
  fetchCourtListenerNews,
  parseCourtListenerNews,
} from "./sources/courtlistener";
export {
  federalRegisterSearchUrl,
  fetchFederalRegisterNews,
  parseFederalRegisterNews,
} from "./sources/federalregister";
export { fetchFinvizNews, finvizQuoteUrl, parseFinvizNews } from "./sources/finviz";
export {
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  fetchFixedFeedNews,
  isFixedFeedProvider,
  parseFixedFeedNews,
} from "./sources/fixedfeeds";
export type { FixedFeedDefinition, FixedFeedProvider } from "./sources/fixedfeeds";
export { fetchGdeltNews, gdeltDocUrl, parseGdeltNews } from "./sources/gdelt";
export { fetchGoogleNews, googleNewsRssUrl, parseGoogleNews } from "./sources/google";
export {
  fetchHackerNewsStories,
  hackerNewsSearchUrl,
  parseHackerNewsStories,
} from "./sources/hackernews";
export { subjectMatcher } from "./sources/match";
export type { SubjectMatchItem, SubjectMatchTerms } from "./sources/match";
export { fetchNasdaqNews, nasdaqRssUrl, parseNasdaqNews } from "./sources/nasdaq";
export { fetchSecFilings, parseSecFilings, secCompanyAtomUrl } from "./sources/sec";
export {
  fetchSecFullTextFilings,
  parseSecFullTextFilings,
  secFullTextSearchUrl,
} from "./sources/secfulltext";
export {
  fetchSeekingAlphaNews,
  parseSeekingAlphaNews,
  seekingAlphaRssUrl,
} from "./sources/seekingalpha";
export { fetchTickerTickNews, parseTickerTickNews, tickerTickFeedUrl } from "./sources/tickertick";
export { fetchYahooFinanceNews, parseYahooFinanceNews, yahooFinanceRssUrl } from "./sources/yahoo";
export { fetchYahooSearchNews, parseYahooSearchNews, yahooSearchUrl } from "./sources/yahoosearch";
export { inferNewsKind, parseAtomEntries, parseRssItems } from "./xml";
export type { AtomParseOptions, RssParseOptions } from "./xml";

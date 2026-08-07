/**
 * Parse-only view of xnews: every provider's pure parser plus the shared
 * RSS/Atom machinery, the publication-date parser, and the event classifier.
 *
 * Parsers are pure and total - fixture text in, `NewsItem[]` out, no network.
 * Unlike `./catalog`, this module's import graph does include the fetch
 * layer (parsers live beside their fetchers), but nothing here dials: use it
 * with text retrieved by your own transport.
 */

export { PUBLISHED_AT_PARSER_VERSION, parsePublishedAt } from "./dates.js";
export type { ParsedPublishedAt, PublishedAtFormat } from "./dates.js";
export { classifyMarketEvent } from "./classify.js";
export type { MarketEventClassification } from "./classify.js";
export { inferNewsKind, parseAtomEntries, parseRssItems } from "./xml.js";
export type { AtomParseOptions, RssParseOptions } from "./xml.js";
export { subjectMatcher } from "./sources/match.js";
export type { SubjectMatchItem, SubjectMatchTerms } from "./sources/match.js";

export { parseBingNews } from "./sources/bing.js";
export { parseCourtListenerNews } from "./sources/courtlistener.js";
export { parseFederalRegisterNews } from "./sources/federalregister.js";
export { parseFinvizNews } from "./sources/finviz.js";
export { parseFixedFeedNews } from "./sources/fixedfeeds.js";
export { parseGdeltNews } from "./sources/gdelt.js";
export { parseGoogleNews } from "./sources/google.js";
export { parseHackerNewsStories } from "./sources/hackernews.js";
export { parseMsrbEmmaDisclosures } from "./sources/msrbemma.js";
export { parseNasdaqNews } from "./sources/nasdaq.js";
export { parseSecFilings } from "./sources/sec.js";
export { parseSecCurrentFilings } from "./sources/seccurrent.js";
export { parseSecFullTextFilings } from "./sources/secfulltext.js";
export { parseSeekingAlphaNews } from "./sources/seekingalpha.js";
export { parseTickerTickNews } from "./sources/tickertick.js";
export { parseYahooFinanceNews } from "./sources/yahoo.js";
export { parseYahooSearchNews } from "./sources/yahoosearch.js";
export { parseYoutubeChannelVideos } from "./sources/youtube.js";
export {
  parseYoutubeCaptionTracks,
  parseYoutubeTranscriptSegments,
} from "./sources/youtubetranscript.js";

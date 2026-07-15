import { fetchText } from "../http";
import { normalizeLimit } from "../options";
import { parseRssItems } from "../xml";
import { subjectMatcher, type SubjectMatchTerms } from "./match";
import type { NewsItem, NewsKind, SourceFetchOptions } from "../types";

const BROWSERISH_USER_AGENT = "Mozilla/5.0 xnews/0.1.0";

export const FIXED_FEED_PROVIDERS = [
  "marketwatch",
  "wsj",
  "cnbc",
  "pr-newswire",
  "globenewswire",
  "federal-reserve",
  "sec-press",
  "coindesk",
  "cointelegraph",
  "benzinga",
  "investing-com",
  "upi",
  "oilprice",
  "nyt",
  "bbc",
  "npr",
  "guardian",
  "ft",
  "economist",
  "fortune",
  "forbes",
  "washington-post",
] as const;

export type FixedFeedProvider = (typeof FIXED_FEED_PROVIDERS)[number];

export interface FixedFeedDefinition {
  readonly label: string;
  readonly urls: readonly string[];
  readonly kind?: NewsKind;
}

/**
 * Free public market and business feeds without native per-subject search.
 * Fetched whole and filtered locally against the requested subject.
 */
export const FIXED_FEEDS: Record<FixedFeedProvider, FixedFeedDefinition> = {
  marketwatch: {
    label: "MarketWatch",
    urls: [
      "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
      "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
      "https://feeds.content.dowjones.io/public/rss/mw_bulletins",
    ],
  },
  wsj: {
    label: "The Wall Street Journal",
    urls: [
      "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
      "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml",
    ],
  },
  cnbc: {
    label: "CNBC",
    urls: [
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135",
    ],
  },
  "pr-newswire": {
    label: "PR Newswire",
    urls: ["https://www.prnewswire.com/rss/news-releases-list.rss"],
    kind: "press-release",
  },
  globenewswire: {
    label: "GlobeNewswire",
    urls: [
      "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
    ],
    kind: "press-release",
  },
  "federal-reserve": {
    label: "Federal Reserve",
    urls: ["https://www.federalreserve.gov/feeds/press_all.xml"],
    kind: "press-release",
  },
  "sec-press": {
    label: "SEC Newsroom",
    urls: ["https://www.sec.gov/news/pressreleases.rss"],
    kind: "press-release",
  },
  coindesk: {
    label: "CoinDesk",
    urls: ["https://www.coindesk.com/arc/outboundfeeds/rss/"],
  },
  cointelegraph: {
    label: "Cointelegraph",
    urls: ["https://cointelegraph.com/rss"],
  },
  benzinga: {
    label: "Benzinga",
    urls: ["https://www.benzinga.com/feed"],
  },
  "investing-com": {
    label: "Investing.com",
    urls: ["https://www.investing.com/rss/news_25.rss"],
  },
  upi: {
    label: "UPI",
    urls: ["https://rss.upi.com/news/business_news.rss"],
  },
  oilprice: {
    label: "OilPrice.com",
    urls: ["https://oilprice.com/rss/main"],
  },
  nyt: {
    label: "The New York Times",
    urls: [
      "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml",
    ],
  },
  bbc: {
    label: "BBC News",
    urls: ["https://feeds.bbci.co.uk/news/business/rss.xml"],
  },
  npr: {
    label: "NPR",
    urls: ["https://feeds.npr.org/1006/rss.xml"],
  },
  guardian: {
    label: "The Guardian",
    urls: ["https://www.theguardian.com/business/rss"],
  },
  ft: {
    label: "Financial Times",
    urls: ["https://www.ft.com/rss/home"],
  },
  economist: {
    label: "The Economist",
    urls: [
      "https://www.economist.com/finance-and-economics/rss.xml",
      "https://www.economist.com/business/rss.xml",
    ],
  },
  fortune: {
    label: "Fortune",
    urls: ["https://fortune.com/feed/"],
  },
  forbes: {
    label: "Forbes",
    urls: ["https://www.forbes.com/business/feed/"],
  },
  "washington-post": {
    label: "The Washington Post",
    urls: ["https://feeds.washingtonpost.com/rss/business"],
  },
};

export function isFixedFeedProvider(provider: string): provider is FixedFeedProvider {
  return Object.hasOwn(FIXED_FEEDS, provider);
}

export async function fetchFixedFeedNews(
  provider: FixedFeedProvider,
  subject: SubjectMatchTerms,
  options: SourceFetchOptions = {},
): Promise<NewsItem[]> {
  const limit = normalizeLimit(options.limit);
  if (limit === 0) return [];

  const responses = await Promise.all(
    FIXED_FEEDS[provider].urls.map(async (url) =>
      fetchText(url, {
        ...options,
        ...(new URL(url).hostname.endsWith("sec.gov")
          ? {}
          : { userAgent: options.userAgent ?? BROWSERISH_USER_AGENT }),
      }),
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

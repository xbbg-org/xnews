import type { NewsKind } from "../types.js";

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
  /**
   * Suggested minimum seconds between polls of the same feed. A suggestion
   * for scheduler-owning consumers, not an enforced limit. Every built-in
   * definition includes it; the field stays optional so 0.1.x consumer-owned
   * definitions remain assignable.
   */
  readonly suggestedMinPollSeconds?: number;
}

type FixedFeedRegistry = Record<
  FixedFeedProvider,
  FixedFeedDefinition & { readonly suggestedMinPollSeconds: number }
>;

/**
 * Free public market and business feeds without native per-subject search.
 * Fetched whole and filtered locally against the requested subject.
 */
export const FIXED_FEEDS: FixedFeedRegistry = {
  marketwatch: {
    label: "MarketWatch",
    urls: [
      "https://feeds.content.dowjones.io/public/rss/mw_topstories",
      "https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines",
      "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
      "https://feeds.content.dowjones.io/public/rss/mw_bulletins",
    ],
    suggestedMinPollSeconds: 300,
  },
  wsj: {
    label: "The Wall Street Journal",
    urls: [
      "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
      "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml",
    ],
    suggestedMinPollSeconds: 300,
  },
  cnbc: {
    label: "CNBC",
    urls: [
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114",
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258",
      "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135",
    ],
    suggestedMinPollSeconds: 300,
  },
  "pr-newswire": {
    label: "PR Newswire",
    urls: ["https://www.prnewswire.com/rss/news-releases-list.rss"],
    kind: "press-release",
    suggestedMinPollSeconds: 300,
  },
  globenewswire: {
    label: "GlobeNewswire",
    urls: [
      "https://www.globenewswire.com/RssFeed/orgclass/1/feedTitle/GlobeNewswire%20-%20News%20about%20Public%20Companies",
    ],
    kind: "press-release",
    suggestedMinPollSeconds: 300,
  },
  "federal-reserve": {
    label: "Federal Reserve",
    urls: ["https://www.federalreserve.gov/feeds/press_all.xml"],
    kind: "press-release",
    suggestedMinPollSeconds: 600,
  },
  "sec-press": {
    label: "SEC Newsroom",
    urls: ["https://www.sec.gov/news/pressreleases.rss"],
    kind: "press-release",
    suggestedMinPollSeconds: 600,
  },
  coindesk: {
    label: "CoinDesk",
    urls: ["https://www.coindesk.com/arc/outboundfeeds/rss/"],
    suggestedMinPollSeconds: 300,
  },
  cointelegraph: {
    label: "Cointelegraph",
    urls: ["https://cointelegraph.com/rss"],
    suggestedMinPollSeconds: 300,
  },
  benzinga: {
    label: "Benzinga",
    urls: ["https://www.benzinga.com/feed"],
    suggestedMinPollSeconds: 300,
  },
  "investing-com": {
    label: "Investing.com",
    urls: ["https://www.investing.com/rss/news_25.rss"],
    suggestedMinPollSeconds: 300,
  },
  upi: {
    label: "UPI",
    urls: ["https://rss.upi.com/news/business_news.rss"],
    suggestedMinPollSeconds: 600,
  },
  oilprice: {
    label: "OilPrice.com",
    urls: ["https://oilprice.com/rss/main"],
    suggestedMinPollSeconds: 600,
  },
  nyt: {
    label: "The New York Times",
    urls: [
      "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml",
    ],
    suggestedMinPollSeconds: 600,
  },
  bbc: {
    label: "BBC News",
    urls: ["https://feeds.bbci.co.uk/news/business/rss.xml"],
    suggestedMinPollSeconds: 600,
  },
  npr: {
    label: "NPR",
    urls: ["https://feeds.npr.org/1006/rss.xml"],
    suggestedMinPollSeconds: 600,
  },
  guardian: {
    label: "The Guardian",
    urls: ["https://www.theguardian.com/business/rss"],
    suggestedMinPollSeconds: 600,
  },
  ft: {
    label: "Financial Times",
    urls: ["https://www.ft.com/rss/home"],
    suggestedMinPollSeconds: 600,
  },
  economist: {
    label: "The Economist",
    urls: [
      "https://www.economist.com/finance-and-economics/rss.xml",
      "https://www.economist.com/business/rss.xml",
    ],
    suggestedMinPollSeconds: 600,
  },
  fortune: {
    label: "Fortune",
    urls: ["https://fortune.com/feed/"],
    suggestedMinPollSeconds: 600,
  },
  forbes: {
    label: "Forbes",
    urls: ["https://www.forbes.com/business/feed/"],
    suggestedMinPollSeconds: 600,
  },
  "washington-post": {
    label: "The Washington Post",
    urls: ["https://feeds.washingtonpost.com/rss/business"],
    suggestedMinPollSeconds: 600,
  },
};

export function isFixedFeedProvider(provider: string): provider is FixedFeedProvider {
  return Object.hasOwn(FIXED_FEEDS, provider);
}

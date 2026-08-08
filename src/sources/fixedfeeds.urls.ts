import type { NewsKind, NewsProvider } from "../types.js";

export const FIXED_FEED_PROVIDERS = [
  "marketwatch",
  "wsj",
  "cnbc",
  "pr-newswire",
  "globenewswire",
  "federal-reserve",
  "sec-press",
  "ffiec",
  "fdic",
  "occ",
  "cfpb",
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
  "bcb-news",
  "boj-news",
  "bok-news",
  "rbi-news",
  "bsp-news",
  "hkma-news",
  "rba-news",
  "rbnz-news",
  "banco-de-espana-news",
  "banca-ditalia-news",
  "dnb-news",
  "central-bank-ireland-news",
  "cnb-news",
  "mnb-news",
  "tcmb-news",
  "sarb-news",
  "norges-bank-news",
  "riksbank-news",
  "central-bank-iceland-news",
  "ecb-news",
  "bank-england-news",
  "bank-canada-news",
  "bundesbank-news",
  "snb-news",
  "atlanta-fed-news",
  "richmond-fed-news",
  "dallas-fed-news",
  "bis-press",
  "bis-speeches",
  "fed-board-research",
  "bcb-research",
  "bok-research",
  "hkma-research",
  "ecb-research",
  "bank-canada-research",
  "bundesbank-research",
  "norges-bank-research",
  "snb-research",
  "rba-research",
  "banco-de-espana-research",
  "banca-ditalia-research",
  "dnb-research",
] as const;

export type FixedFeedProvider = (typeof FIXED_FEED_PROVIDERS)[number];

export const CENTRAL_BANK_NEWS_PROVIDERS = [
  "bcb-news",
  "boj-news",
  "bok-news",
  "rbi-news",
  "bsp-news",
  "hkma-news",
  "rba-news",
  "rbnz-news",
  "banco-de-espana-news",
  "banca-ditalia-news",
  "dnb-news",
  "central-bank-ireland-news",
  "cnb-news",
  "mnb-news",
  "tcmb-news",
  "sarb-news",
  "norges-bank-news",
  "riksbank-news",
  "central-bank-iceland-news",
  "ecb-news",
  "bank-england-news",
  "bank-canada-news",
  "bundesbank-news",
  "snb-news",
  "atlanta-fed-news",
  "richmond-fed-news",
  "dallas-fed-news",
  "bis-press",
  "bis-speeches",
] as const satisfies readonly (FixedFeedProvider & NewsProvider)[];

export const CENTRAL_BANK_RESEARCH_PROVIDERS = [
  "fed-board-research",
  "bcb-research",
  "bok-research",
  "hkma-research",
  "ecb-research",
  "bank-canada-research",
  "bundesbank-research",
  "norges-bank-research",
  "snb-research",
  "rba-research",
  "banco-de-espana-research",
  "banca-ditalia-research",
  "dnb-research",
] as const satisfies readonly (FixedFeedProvider & NewsProvider)[];

export interface FixedFeedDefinition {
  readonly label: string;
  readonly urls: readonly string[];
  readonly kind?: NewsKind;
  readonly format?: "rss" | "atom";
  readonly baseUrl?: string;
  readonly userAgentPolicy?: "browser" | "default";
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
  ffiec: {
    label: "FFIEC",
    urls: ["https://www.ffiec.gov/rss.xml"],
    kind: "press-release",
    suggestedMinPollSeconds: 600,
  },
  fdic: {
    label: "FDIC",
    urls: [
      "https://public.govdelivery.com/topics/USFDIC_26/feed.rss",
      "https://www.fdic.gov/rss.xml",
    ],
    kind: "press-release",
    suggestedMinPollSeconds: 600,
  },
  occ: {
    label: "OCC",
    urls: ["https://www.occ.gov/rss/occ_news.xml", "https://www.occ.gov/rss/occ_bulletins.xml"],
    kind: "press-release",
    suggestedMinPollSeconds: 600,
  },
  cfpb: {
    label: "CFPB",
    urls: ["https://www.consumerfinance.gov/about-us/newsroom/feed/"],
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
  "bcb-news": {
    label: "Banco Central do Brasil",
    urls: ["https://www.bcb.gov.br/api/feed/sitebcb/sitefeedsen/pressreleases"],
    kind: "press-release",
    format: "atom",
    suggestedMinPollSeconds: 900,
  },
  "boj-news": {
    label: "Bank of Japan",
    urls: ["https://www.boj.or.jp/en/rss/whatsnew.xml"],
    suggestedMinPollSeconds: 900,
  },
  "bok-news": {
    label: "Bank of Korea",
    urls: [
      "https://www.bok.or.kr/eng/bbs/E0000634/news.rss?menuNo=400069",
      "https://www.bok.or.kr/eng/bbs/E0002382/news.rss?menuNo=400074",
    ],
    suggestedMinPollSeconds: 900,
  },
  "rbi-news": {
    label: "Reserve Bank of India",
    urls: ["https://rbi.org.in/pressreleases_rss.xml", "https://rbi.org.in/speeches_rss.xml"],
    suggestedMinPollSeconds: 900,
  },
  "bsp-news": {
    label: "Bangko Sentral ng Pilipinas",
    urls: [
      "https://www.bsp.gov.ph/_layouts/15/listfeed.aspx?List=9b0a2117-49d8-4e96-80ba-8651a0e3e17a&View=8c968884-887d-4d63-8c00-ba05ea3c2d93",
    ],
    kind: "press-release",
    suggestedMinPollSeconds: 900,
  },
  "hkma-news": {
    label: "Hong Kong Monetary Authority",
    urls: [
      "https://www.hkma.gov.hk/eng/other-information/rss/rss_press-release.xml",
      "https://www.hkma.gov.hk/eng/other-information/rss/rss_speeches.xml",
    ],
    suggestedMinPollSeconds: 900,
  },
  "rba-news": {
    label: "Reserve Bank of Australia",
    urls: [
      "https://www.rba.gov.au/rss/rss-cb-media-releases.xml",
      "https://www.rba.gov.au/rss/rss-cb-speeches.xml",
    ],
    suggestedMinPollSeconds: 900,
  },
  "rbnz-news": {
    label: "Reserve Bank of New Zealand",
    urls: ["https://www.rbnz.govt.nz/feeds/news"],
    suggestedMinPollSeconds: 900,
  },
  "banco-de-espana-news": {
    label: "Banco de España",
    urls: ["https://www.bde.es/wbe/en/inicio/rss/rss-noticias/"],
    suggestedMinPollSeconds: 900,
  },
  "banca-ditalia-news": {
    label: "Banca d'Italia",
    urls: [
      "https://www.bancaditalia.it/util/index.rss.html?sezione=/media/comunicati&lingua=en",
      "https://www.bancaditalia.it/util/index.rss.html?sezione=/pubblicazioni/interventi-governatore&lingua=en",
    ],
    suggestedMinPollSeconds: 900,
  },
  "dnb-news": {
    label: "De Nederlandsche Bank",
    urls: ["https://www.dnb.nl/en/rss/16451/6882"],
    baseUrl: "https://www.dnb.nl",
    userAgentPolicy: "default",
    suggestedMinPollSeconds: 900,
  },
  "central-bank-ireland-news": {
    label: "Central Bank of Ireland",
    urls: ["https://www.centralbank.ie/feeds/news-media-feed"],
    suggestedMinPollSeconds: 900,
  },
  "cnb-news": {
    label: "Czech National Bank",
    urls: ["https://www.cnb.cz/en/.content/rss-feed/rss-feed_tz.xml"],
    kind: "press-release",
    suggestedMinPollSeconds: 900,
  },
  "mnb-news": {
    label: "Magyar Nemzeti Bank",
    urls: ["https://www.mnb.hu/enrss/16", "https://www.mnb.hu/enrss/8"],
    suggestedMinPollSeconds: 900,
  },
  "tcmb-news": {
    label: "Central Bank of the Republic of Türkiye",
    urls: [
      "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Bottom+Menu/Other/RSS/Press+Releases",
      "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Bottom+Menu/Other/RSS/Remarks+by+Governor",
    ],
    kind: "unknown",
    format: "atom",
    suggestedMinPollSeconds: 900,
  },
  "sarb-news": {
    label: "South African Reserve Bank",
    urls: ["https://www.resbank.co.za/bin/sarb/solr/publications/rss"],
    baseUrl: "https://www.resbank.co.za",
    suggestedMinPollSeconds: 900,
  },
  "norges-bank-news": {
    label: "Norges Bank",
    urls: [
      "https://www.norges-bank.no/en/rss-feeds/Press-releases---Norges-Bank/",
      "https://www.norges-bank.no/en/rss-feeds/Speeches---Norges-Bank/",
    ],
    suggestedMinPollSeconds: 900,
  },
  "riksbank-news": {
    label: "Sveriges Riksbank",
    urls: [
      "https://www.riksbank.se/en-gb/rss/press-releases/",
      "https://www.riksbank.se/en-gb/rss/speeches/",
    ],
    suggestedMinPollSeconds: 900,
  },
  "central-bank-iceland-news": {
    label: "Central Bank of Iceland",
    urls: ["https://cb.is/api/documents/views/articles/RSS-feed-english/rss"],
    suggestedMinPollSeconds: 900,
  },
  "ecb-news": {
    label: "European Central Bank",
    urls: ["https://www.ecb.europa.eu/rss/press.html"],
    suggestedMinPollSeconds: 900,
  },
  "bank-england-news": {
    label: "Bank of England",
    urls: [
      "https://www.bankofengland.co.uk/rss/news",
      "https://www.bankofengland.co.uk/rss/speeches",
    ],
    suggestedMinPollSeconds: 900,
  },
  "bank-canada-news": {
    label: "Bank of Canada",
    urls: [
      "https://www.bankofcanada.ca/content_type/press-releases/feed/",
      "https://www.bankofcanada.ca/content_type/speeches/feed/",
    ],
    suggestedMinPollSeconds: 900,
  },
  "bundesbank-news": {
    label: "Deutsche Bundesbank",
    urls: [
      "https://www.bundesbank.de/service/rss/en/633306/feed.rss",
      "https://www.bundesbank.de/service/rss/en/633296/feed.rss",
    ],
    suggestedMinPollSeconds: 900,
  },
  "snb-news": {
    label: "Swiss National Bank",
    urls: [
      "https://www.snb.ch/public/rss/en/pressrel",
      "https://www.snb.ch/public/rss/en/speeches",
    ],
    suggestedMinPollSeconds: 900,
  },
  "atlanta-fed-news": {
    label: "Federal Reserve Bank of Atlanta",
    urls: [
      "https://www.atlantafed.org/rss/pressindex",
      "https://www.atlantafed.org/rss/speechindex",
    ],
    suggestedMinPollSeconds: 900,
  },
  "richmond-fed-news": {
    label: "Federal Reserve Bank of Richmond",
    urls: [
      "https://www.richmondfed.org/press_room/press_releases/?cc_view=rss",
      "https://www.richmondfed.org/press_room/speeches?cc_view=rss",
    ],
    suggestedMinPollSeconds: 900,
  },
  "dallas-fed-news": {
    label: "Federal Reserve Bank of Dallas",
    urls: [
      "https://www.dallasfed.org/rss/releases.xml",
      "https://www.dallasfed.org/rss/speeches.xml",
    ],
    suggestedMinPollSeconds: 900,
  },
  "bis-press": {
    label: "Bank for International Settlements",
    urls: ["https://www.bis.org/doclist/all_pressrels.rss"],
    kind: "press-release",
    suggestedMinPollSeconds: 900,
  },
  "bis-speeches": {
    label: "BIS Central Bank Speeches",
    urls: ["https://www.bis.org/doclist/cbspeeches.rss"],
    suggestedMinPollSeconds: 900,
  },
  "fed-board-research": {
    label: "Federal Reserve Board Working Papers",
    urls: [
      "https://www.federalreserve.gov/feeds/feds.xml",
      "https://www.federalreserve.gov/feeds/ifdp.xml",
    ],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "bcb-research": {
    label: "Banco Central do Brasil Research",
    urls: ["https://www.bcb.gov.br/api/feed/sitebcb/sitefeedsen/researchreport"],
    kind: "analysis",
    format: "atom",
    suggestedMinPollSeconds: 21600,
  },
  "bok-research": {
    label: "Bank of Korea Research",
    urls: ["https://www.bok.or.kr/eng/bbs/B0000179/news.rss?menuNo=400063"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "hkma-research": {
    label: "Hong Kong Monetary Authority Research",
    urls: ["https://www.hkma.gov.hk/eng/other-information/rss/rss_research.xml"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "ecb-research": {
    label: "European Central Bank Working Papers",
    urls: ["https://www.ecb.europa.eu/rss/wppub.html"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "bank-canada-research": {
    label: "Bank of Canada Working Papers",
    urls: ["https://www.bankofcanada.ca/content_type/working-papers/feed/"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "bundesbank-research": {
    label: "Deutsche Bundesbank Discussion Papers",
    urls: ["https://www.bundesbank.de/service/rss/en/633292/feed.rss"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "norges-bank-research": {
    label: "Norges Bank Working Papers",
    urls: ["https://www.norges-bank.no/en/rss-feeds/Working-papers---Norges-Bank/"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "snb-research": {
    label: "Swiss National Bank Research",
    urls: ["https://www.snb.ch/public/rss/en/papers"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "rba-research": {
    label: "Reserve Bank of Australia Research Discussion Papers",
    urls: ["https://www.rba.gov.au/rss/rss-cb-rdp.xml"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "banco-de-espana-research": {
    label: "Banco de España Research",
    urls: ["https://www.bde.es/wbe/en/inicio/rss/rss-estudios-publicaciones/"],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "banca-ditalia-research": {
    label: "Banca d'Italia Working Papers",
    urls: [
      "https://www.bancaditalia.it/util/index.rss.html?sezione=/pubblicazioni/temi-discussione&lingua=en",
    ],
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
  "dnb-research": {
    label: "De Nederlandsche Bank Research",
    urls: ["https://www.dnb.nl/en/rss/16455/4614"],
    baseUrl: "https://www.dnb.nl",
    userAgentPolicy: "default",
    kind: "analysis",
    suggestedMinPollSeconds: 21600,
  },
};

export function isFixedFeedProvider(provider: string): provider is FixedFeedProvider {
  return Object.hasOwn(FIXED_FEEDS, provider);
}

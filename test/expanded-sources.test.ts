import { expect, test } from "bun:test";
import {
  buildCompanyNewsFeedResult,
  buildTopicNewsFeedResult,
  extractYoutubeVideoId,
  fetchYoutubeChannelVideos,
  fetchYoutubeSubscriptions,
  fetchYoutubeTranscript,
  FIXED_FEED_PROVIDERS,
  FIXED_FEEDS,
  isYoutubeChannelId,
  msrbEmmaPeriods,
  parseBingNews,
  parseCourtListenerNews,
  parseFederalRegisterNews,
  parseFixedFeedNews,
  parseGdeltNews,
  parseHackerNewsStories,
  parseMsrbEmmaDisclosures,
  parseNasdaqNews,
  parseSecCurrentFilings,
  parseSecFullTextFilings,
  parseSeekingAlphaNews,
  parseTickerTickNews,
  parseYahooSearchNews,
  parseYoutubeCaptionTracks,
  parseYoutubeChannelVideos,
  parseYoutubeTranscriptSegments,
  pickYoutubeCaptionTrack,
  providerCapabilities,
  resolveYoutubeChannelId,
  secFullTextSearchUrl,
  subjectMatcher,
  youtubeChannelFeedUrl,
  youtubeWatchUrl,
} from "../src";
import {
  bingRssFixture,
  courtListenerAtomFixture,
  emptyRssFixture,
  federalRegisterJsonFixture,
  gdeltJsonFixture,
  hackerNewsJsonFixture,
  marketFeedRssFixture,
  msrbEmmaJsonFixture,
  nasdaqRssFixture,
  secCurrentAtomFixture,
  secFullTextErrorJsonFixture,
  secFullTextJsonFixture,
  secFullTextXslJsonFixture,
  seekingAlphaRssFixture,
  tickerTickJsonFixture,
  yahooSearchJsonFixture,
  youtubeAtomFixture,
  youtubeChannelPageFixture,
  youtubeMacroAtomFixture,
  youtubePlayerNoCaptionsFixture,
  youtubePlayerResponseFixture,
  youtubeSrv3TranscriptFixture,
  youtubeTranscriptXmlFixture,
  youtubeWatchPageFixture,
} from "./fixtures";

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("parses Bing News RSS and unwraps redirect links", () => {
  const items = parseBingNews(bingRssFixture);

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "bing-news",
    title: "Reinsurance Group of America prices senior notes offering",
    url: "https://www.example.com/rga-notes-offering",
    canonicalUrl: "https://www.example.com/rga-notes-offering",
    source: "Example Wire",
    publishedAt: "2026-07-13T15:00:00.000Z",
  });
  expect(items[1]?.url).toBe("https://www.example.org/insurance-stocks-steady");
  expect(items[1]?.source).toBe("Bing News");
});

test("parses TickerTick stories with related tickers and epoch timestamps", () => {
  const items = parseTickerTickNews(tickerTickJsonFixture, "rga");

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "tickertick",
    title: "Reinsurance Group of America (NYSE:RGA) Hits New 1-Year High",
    url: "https://www.marketbeat.com/instant-alerts/rga-hits-new-1-year-high-2026-07-13/",
    source: "marketbeat.com",
    ticker: "RGA",
    publishedAt: new Date(1783954841000).toISOString(),
    summary: "RGA reaches a new 52-week high.",
    relatedTickers: ["RGA"],
  });
  expect(items[1]?.relatedTickers).toEqual(["EG", "RGA"]);
  expect(() => parseTickerTickNews("rate limited", "rga")).toThrow(/non-JSON TickerTick/);
});

test("parses GDELT article lists with seendate timestamps", () => {
  const items = parseGdeltNews(gdeltJsonFixture);

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "gdelt",
    title: "Global reinsurance outlook improves",
    url: "https://www.example.com/global-reinsurance-outlook",
    source: "example.com",
    publishedAt: "2026-07-13T22:15:00.000Z",
    publishedAtText: "20260713T221500Z",
  });
  expect(() => parseGdeltNews("Please limit requests")).toThrow(/non-JSON GDELT/);
});

test("parses Hacker News stories and falls back to discussion links", () => {
  const items = parseHackerNewsStories(hackerNewsJsonFixture);

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "hacker-news",
    title: "Insurance modeling with open data",
    url: "https://blog.example.com/insurance-modeling",
    source: "Hacker News",
    publishedAt: "2026-07-13T18:45:00.000Z",
  });
  expect(items[1]?.url).toBe("https://news.ycombinator.com/item?id=48913907");
});

test("parses Yahoo search news with publisher and related tickers", () => {
  const items = parseYahooSearchNews(yahooSearchJsonFixture);

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "yahoo-search",
    title: "RGA Outperforms Industry, Hits 52-Week High",
    source: "Zacks",
    publishedAt: new Date(1783954800 * 1000).toISOString(),
    relatedTickers: ["MFC", "RGA"],
  });
  expect(items[1]?.source).toBe("Business Wire");
  expect(items[1]?.kind).toBe("press-release");
});

test("parses SEC full-text hits into archive filing links", () => {
  const items = parseSecFullTextFilings(secFullTextJsonFixture, { ticker: "rga" });

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "sec-fulltext",
    kind: "filing",
    title: "8-K - Reinsurance Group of America, Incorporated  (RGA)",
    url: "https://www.sec.gov/Archives/edgar/data/898174/000119312526123456/d123456d8k.htm",
    source: "SEC EDGAR",
    ticker: "RGA",
    formType: "8-K",
    accessionNumber: "0001193125-26-123456",
    cik: "898174",
    fileNumber: "001-11848",
    filingDate: "2026-06-22",
    summary: "CURRENT REPORT",
  });
  expect(items[0]?.publishedAt).toBe("2026-06-22T00:00:00.000Z");
});

test("renders XML ownership filings through their XSL stylesheet path", () => {
  const items = parseSecFullTextFilings(secFullTextXslJsonFixture, {});

  expect(items).toHaveLength(1);
  expect(items[0]?.url).toBe(
    "https://www.sec.gov/Archives/edgar/data/898174/000118143126054321/xslF345X03/primary_doc.xml",
  );
  expect(items[0]?.formType).toBe("4");
});

test("throws on EFTS errorType payloads served with HTTP 200", () => {
  expect(() => parseSecFullTextFilings(secFullTextErrorJsonFixture)).toThrow(
    /Result window is too large/,
  );
});

test("scopes SEC full-text search to an entity via ticker or padded CIK", () => {
  expect(secFullTextSearchUrl("earnings", { ticker: "NVDA" })).toContain("entityName=NVDA");
  expect(secFullTextSearchUrl("earnings", { ticker: "1045810" })).toContain(
    "entityName=0001045810",
  );
  expect(secFullTextSearchUrl("earnings", {})).not.toContain("entityName");
});

test("parses Federal Register documents with agency sources", () => {
  const items = parseFederalRegisterNews(federalRegisterJsonFixture);

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "federal-register",
    title: "Rule: Credit for Reinsurance Model Regulation Updates",
    url: "https://www.federalregister.gov/documents/2026/07/01/2026-12345/credit-for-reinsurance",
    source: "Treasury Department",
    summary: "Final rule updating credit for reinsurance requirements.",
    publishedAt: "2026-07-01T00:00:00.000Z",
  });
});

test("parses CourtListener entries using published dates and court authors", () => {
  const items = parseCourtListenerNews(courtListenerAtomFixture);

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "courtlistener",
    kind: "article",
    title: "In Re Reinsurance Group of America v. Example State",
    url: "https://www.courtlistener.com/opinion/1234567/rga-v-example-state/",
    source: "Missouri Court of Appeals",
    publishedAt: "2026-06-20T07:00:00.000Z",
  });
});

test("parses Nasdaq per-symbol RSS items", () => {
  const items = parseNasdaqNews(nasdaqRssFixture, "rga");

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "nasdaq",
    title: "RGA Outperforms Industry After Strong Quarter",
    url: "https://www.nasdaq.com/articles/rga-outperforms-industry-after-strong-quarter",
    source: "Nasdaq",
    ticker: "RGA",
  });
});

test("parses Seeking Alpha items and restores per-story URLs from guids", () => {
  const items = parseSeekingAlphaNews(seekingAlphaRssFixture, "RGA");

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "seeking-alpha",
    title: "Reinsurance Group of America appoints new CFO",
    url: "https://seekingalpha.com/MarketCurrent:4605518",
    ticker: "RGA",
  });
  expect(items[1]?.url).toBe(
    "https://seekingalpha.com/article/4904996-rga-q1-financial-instruments?source=feed_symbol_RGA",
  );
});

test("fixed feeds filter company subjects by name and boundary-safe ticker", () => {
  const items = parseFixedFeedNews("marketwatch", marketFeedRssFixture, {
    ticker: "RGA",
    companyName: "Reinsurance Group of America",
  });

  expect(items.map((item) => item.title)).toEqual([
    "Reinsurance Group of America raises dividend",
    "Insurers rally as rates stabilize (NYSE:RGA)",
  ]);
  expect(items[0]?.provider).toBe("marketwatch");
  expect(items[0]?.source).toBe("MarketWatch");
});

test("fixed feeds filter topic subjects by all query tokens", () => {
  const items = parseFixedFeedNews("guardian", marketFeedRssFixture, {
    query: "insurance regulation",
  });

  expect(items.map((item) => item.title)).toEqual(["ARGAN wins construction award"]);
});

test("press-release wires mark filtered items as press releases", () => {
  const items = parseFixedFeedNews("pr-newswire", marketFeedRssFixture, { ticker: "RGA" });

  expect(items).toHaveLength(1);
  expect(items[0]?.kind).toBe("press-release");
  expect(items[0]?.source).toBe("PR Newswire");
});

test("subject matcher requires cashtag or exchange context for single-letter tickers", () => {
  const matches = subjectMatcher({ ticker: "A" });

  expect(matches({ title: "A big day for markets" })).toBe(false);
  expect(matches({ title: "Agilent (NYSE:A) reports earnings" })).toBe(true);
  expect(matches({ title: "Traders pile into $A calls" })).toBe(true);
  expect(matches({ title: "Watching RGA today" })).toBe(false);
});

test("every fixed feed provider has capabilities, urls, and a label", () => {
  for (const provider of FIXED_FEED_PROVIDERS) {
    expect(providerCapabilities(provider)).toEqual(["company", "topic"]);
    expect(FIXED_FEEDS[provider].urls.length).toBeGreaterThan(0);
    expect(FIXED_FEEDS[provider].label.length).toBeGreaterThan(0);
  }
});

test("new query providers expose expected capabilities", () => {
  expect(providerCapabilities("bing-news")).toEqual(["company", "topic"]);
  expect(providerCapabilities("gdelt")).toEqual(["company", "topic"]);
  expect(providerCapabilities("tickertick")).toEqual(["company"]);
  expect(providerCapabilities("hacker-news")).toEqual(["company", "topic"]);
  expect(providerCapabilities("yahoo-search")).toEqual(["company", "topic"]);
  expect(providerCapabilities("sec-fulltext")).toEqual(["company", "topic", "filing"]);
  expect(providerCapabilities("federal-register")).toEqual(["company", "topic"]);
  expect(providerCapabilities("courtlistener")).toEqual(["company", "topic"]);
  expect(providerCapabilities("nasdaq")).toEqual(["company"]);
  expect(providerCapabilities("seeking-alpha")).toEqual(["company"]);
});

test("company feed integrates new providers through injected fetch", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    companyName: "Reinsurance Group of America",
    sources: ["tickertick", "bing-news", "sec-fulltext", "seeking-alpha", "marketwatch"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      if (href.includes("api.tickertick.com")) return new Response(tickerTickJsonFixture);
      if (href.includes("bing.com")) return new Response(bingRssFixture);
      if (href.includes("efts.sec.gov")) return new Response(secFullTextJsonFixture);
      if (href.includes("seekingalpha.com")) return new Response(seekingAlphaRssFixture);
      if (href.includes("mw_topstories")) return new Response(marketFeedRssFixture);
      if (href.includes("feeds.content.dowjones.io")) return new Response(emptyRssFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(result.partial).toBe(false);
  expect(result.providers).toHaveLength(5);
  for (const provider of result.providers) {
    expect(provider.status).toBe("ok");
    expect(provider.itemCount).toBeGreaterThan(0);
  }
  const marketwatch = result.providers.find((provider) => provider.provider === "marketwatch");
  expect(marketwatch?.requestUrls).toEqual(FIXED_FEEDS.marketwatch.urls);
  expect(fetchedUrls.filter((url) => url.includes("feeds.content.dowjones.io"))).toHaveLength(4);
  const providers = new Set(result.items.map((item) => item.provider));
  expect(providers).toEqual(
    new Set(["tickertick", "bing-news", "sec-fulltext", "seeking-alpha", "marketwatch"]),
  );
});

test("topic feeds support query providers and filtered fixed feeds", async () => {
  const result = await buildTopicNewsFeedResult({
    query: "insurance regulation",
    sources: ["hacker-news", "federal-register", "guardian", "nasdaq"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("hn.algolia.com")) return new Response(hackerNewsJsonFixture);
      if (href.includes("federalregister.gov")) return new Response(federalRegisterJsonFixture);
      if (href.includes("theguardian.com")) return new Response(marketFeedRssFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  const statusByProvider = new Map(
    result.providers.map((provider) => [provider.provider, provider.status]),
  );
  expect(statusByProvider.get("hacker-news")).toBe("ok");
  expect(statusByProvider.get("federal-register")).toBe("ok");
  expect(statusByProvider.get("guardian")).toBe("ok");
  expect(statusByProvider.get("nasdaq")).toBe("unsupported");
  expect(result.warnings).toEqual(["nasdaq: topic subjects are unsupported"]);
});

test("company requirements surface unsupported reasons for missing fields", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "",
    companyName: "Reinsurance Group of America",
    sources: ["tickertick", "federal-register", "gdelt"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("federalregister.gov")) return new Response(federalRegisterJsonFixture);
      if (href.includes("gdeltproject.org")) return new Response(gdeltJsonFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  const tickertick = result.providers.find((provider) => provider.provider === "tickertick");
  expect(tickertick?.status).toBe("unsupported");
  expect(tickertick?.warnings).toEqual(["tickertick: company ticker is required"]);
  expect(
    result.providers.find((provider) => provider.provider === "federal-register")?.status,
  ).toBe("ok");
  expect(result.providers.find((provider) => provider.provider === "gdelt")?.status).toBe("ok");

  const nameless = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["federal-register", "courtlistener"],
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });
  for (const provider of nameless.providers) {
    expect(provider.status).toBe("unsupported");
    expect(provider.warnings).toEqual([`${provider.provider}: companyName is required`]);
  }
});

test("date windows propagate into query provider request urls", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    companyName: "Reinsurance Group of America",
    sources: ["sec-fulltext", "gdelt", "federal-register", "courtlistener"],
    since: "2026-06-01T00:00:00.000Z",
    until: "2026-07-01T00:00:00.000Z",
    secForms: ["8-K"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("efts.sec.gov")) return new Response(secFullTextJsonFixture);
      if (href.includes("gdeltproject.org")) return new Response(gdeltJsonFixture);
      if (href.includes("federalregister.gov")) return new Response(federalRegisterJsonFixture);
      if (href.includes("courtlistener.com")) return new Response(courtListenerAtomFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  const urlByProvider = new Map(
    result.providers.map((provider) => [provider.provider, provider.requestUrls[0] ?? ""]),
  );
  expect(urlByProvider.get("sec-fulltext")).toContain("dateRange=custom");
  expect(urlByProvider.get("sec-fulltext")).toContain("startdt=2026-06-01");
  expect(urlByProvider.get("sec-fulltext")).toContain("enddt=2026-07-01");
  expect(urlByProvider.get("sec-fulltext")).toContain("forms=8-K");
  expect(urlByProvider.get("gdelt")).toContain("startdatetime=20260601000000");
  expect(urlByProvider.get("gdelt")).toContain("enddatetime=20260701000000");
  expect(urlByProvider.get("federal-register")).toContain(
    "conditions%5Bpublication_date%5D%5Bgte%5D=2026-06-01",
  );
  expect(urlByProvider.get("courtlistener")).toContain("filed_after=2026-06-01");

  const secFullText = result.providers.find((provider) => provider.provider === "sec-fulltext");
  expect(secFullText?.status).toBe("ok");
  expect(secFullText?.items[0]?.publishedAt).toBe("2026-06-22T00:00:00.000Z");
});

test("parses SEC latest-filings entries with form types and urn accessions", () => {
  const items = parseSecCurrentFilings(secCurrentAtomFixture, { ticker: "rga" });

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    provider: "sec-current",
    kind: "filing",
    title: "8-K - Reinsurance Group of America, Incorporated (0000898174) (Filer)",
    url: "https://www.sec.gov/Archives/edgar/data/898174/000089817426000042/0000898174-26-000042-index.htm",
    source: "SEC EDGAR",
    ticker: "RGA",
    formType: "8-K",
    accessionNumber: "0000898174-26-000042",
    publishedAt: "2026-07-14T21:30:29.000Z",
  });
  expect(items[1]?.formType).toBe("4");
});

test("sec-current topic filtering keeps boundary-safe token matches only", () => {
  const items = parseSecCurrentFilings(secCurrentAtomFixture, {
    filterQuery: "insurance holdings",
  });

  expect(items.map((item) => item.title)).toEqual([
    "4 - Insurance Holdings Corp (0001234567) (Issuer)",
  ]);
});

test("sec-current company subjects search EDGAR by company name per form", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    companyName: "Reinsurance Group of America",
    sources: ["sec-current"],
    secForms: ["8-K", "4"],
    fetch: async (input) => {
      fetchedUrls.push(fetchInputUrl(input));
      return new Response(secCurrentAtomFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(2);
  for (const url of fetchedUrls) {
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://www.sec.gov");
    expect(parsed.searchParams.get("action")).toBe("getcurrent");
    expect(parsed.searchParams.get("company")).toBe("Reinsurance Group of America");
    expect(parsed.searchParams.get("output")).toBe("atom");
  }
  expect(fetchedUrls.map((url) => new URL(url).searchParams.get("type"))).toEqual(["8-K", "4"]);
  expect(providerCapabilities("sec-current")).toEqual(["company", "topic", "filing"]);

  const provider = result.providers[0];
  expect(provider?.status).toBe("ok");
  expect(provider?.requestUrls).toEqual(fetchedUrls);
  expect(provider?.items.every((item) => item.ticker === "RGA")).toBe(true);

  const nameless = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["sec-current"],
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });
  expect(nameless.providers[0]?.status).toBe("unsupported");
  expect(nameless.warnings).toEqual(["sec-current: companyName is required"]);
});

test("sec-current topic subjects stream the market-wide feed and filter locally", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildTopicNewsFeedResult({
    query: "insurance holdings",
    sources: ["sec-current"],
    fetch: async (input) => {
      fetchedUrls.push(fetchInputUrl(input));
      return new Response(secCurrentAtomFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(1);
  const parsed = new URL(fetchedUrls[0] ?? "");
  expect(parsed.searchParams.get("action")).toBe("getcurrent");
  expect(parsed.searchParams.get("company")).toBeNull();
  expect(result.providers[0]?.status).toBe("ok");
  expect(result.items.map((item) => item.title)).toEqual([
    "4 - Insurance Holdings Corp (0001234567) (Issuer)",
  ]);
});

test("parses MSRB EMMA continuing disclosures with details links and .NET dates", () => {
  const items = parseMsrbEmmaDisclosures(msrbEmmaJsonFixture);

  expect(items).toHaveLength(3);
  expect(items[0]).toMatchObject({
    provider: "msrb-emma",
    kind: "filing",
    title: "HOCKING TECHNICAL COLLEGE OHIO GEN RCPTS: Rating Change",
    url: "https://emma.msrb.org/MarketActivity/ContinuingDisclosureDetails/P21552419",
    canonicalUrl: "https://emma.msrb.org/MarketActivity/ContinuingDisclosureDetails/P21552419",
    source: "MSRB EMMA",
    companyName: "HOCKING TECHNICAL COLLEGE OHIO GEN RCPTS",
    publishedAt: "2026-07-17T23:13:45.000Z",
  });
  expect(items[2]).toMatchObject({
    title: "EXAMPLE CITY WATER & SEWER AUTH: Bond Call (Modified) (Unconfirmed)",
    url: "https://emma.msrb.org/MarketActivity/ContinuingDisclosureDetails/P21552001",
    publishedAt: "2026-07-17T03:30:00.000Z",
  });
});

test("msrb-emma filters disclosures by subject terms locally", () => {
  const byQuery = parseMsrbEmmaDisclosures(msrbEmmaJsonFixture, {
    terms: { query: "rating change" },
  });
  expect(byQuery.map((item) => item.title)).toEqual([
    "HOCKING TECHNICAL COLLEGE OHIO GEN RCPTS: Rating Change",
  ]);

  const byIssuer = parseMsrbEmmaDisclosures(msrbEmmaJsonFixture, {
    terms: { companyName: "Utah County Utah Transn Sales Tax Rev" },
  });
  expect(byIssuer).toHaveLength(1);
  expect(byIssuer[0]?.companyName).toBe("UTAH COUNTY UTAH TRANSN SALES TAX REV");
});

test("msrbEmmaPeriods maps date windows onto EMMA posting windows", () => {
  const wednesdayNoonEt = Date.UTC(2026, 6, 15, 16, 0, 0);
  expect(msrbEmmaPeriods({ period: "LastWeek" }, wednesdayNoonEt)).toEqual(["LastWeek"]);
  expect(msrbEmmaPeriods({}, wednesdayNoonEt)).toEqual(["Today", "Yesterday"]);
  expect(msrbEmmaPeriods({ since: "2026-07-14T00:00:00.000Z" }, wednesdayNoonEt)).toEqual([
    "Today",
    "Yesterday",
    "ThisWeek",
  ]);
  expect(msrbEmmaPeriods({ since: "2026-07-05T12:00:00.000Z" }, wednesdayNoonEt)).toEqual([
    "Today",
    "Yesterday",
    "ThisWeek",
    "LastWeek",
  ]);

  // On Sundays ThisWeek adds nothing beyond Today+Yesterday and is skipped.
  const sundayNoonEt = Date.UTC(2026, 6, 19, 16, 0, 0);
  expect(msrbEmmaPeriods({ since: "2026-07-05T12:00:00.000Z" }, sundayNoonEt)).toEqual([
    "Today",
    "Yesterday",
    "LastWeek",
  ]);
});

test("msrb-emma topic subjects stream recent windows and dedupe overlaps", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildTopicNewsFeedResult({
    query: "rating change",
    sources: ["msrb-emma"],
    fetch: async (input) => {
      fetchedUrls.push(fetchInputUrl(input));
      return new Response(msrbEmmaJsonFixture);
    },
  });

  expect(fetchedUrls.map((url) => new URL(url).searchParams.get("selectedPeriod"))).toEqual([
    "Today",
    "Yesterday",
  ]);
  for (const url of fetchedUrls) {
    expect(url.startsWith("https://emma.msrb.org/MarketActivity/GetCdData")).toBe(true);
  }
  expect(providerCapabilities("msrb-emma")).toEqual(["company", "topic", "filing"]);

  const provider = result.providers[0];
  expect(provider?.status).toBe("ok");
  expect(provider?.requestUrls).toEqual(fetchedUrls);
  expect(result.items.map((item) => item.title)).toEqual([
    "HOCKING TECHNICAL COLLEGE OHIO GEN RCPTS: Rating Change",
  ]);
});

test("msrb-emma company subjects match issuer names and require a name", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "",
    companyName: "Utah County Utah Transn Sales Tax Rev",
    sources: ["msrb-emma"],
    fetch: async () => new Response(msrbEmmaJsonFixture),
  });
  expect(result.providers[0]?.status).toBe("ok");
  expect(result.items.map((item) => item.title)).toEqual([
    "UTAH COUNTY UTAH TRANSN SALES TAX REV: Annual Financial Information and Operating Data, Audited Financial Statements or ACFR",
  ]);

  const nameless = await buildCompanyNewsFeedResult({
    ticker: "MUB",
    sources: ["msrb-emma"],
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });
  expect(nameless.providers[0]?.status).toBe("unsupported");
  expect(nameless.warnings).toEqual(["msrb-emma: companyName is required"]);
});

test("builds YouTube channel feed URLs with a Shorts-free playlist variant", () => {
  expect(youtubeChannelFeedUrl("UCmktminuteaaaaaaaaaaaaa")).toBe(
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCmktminuteaaaaaaaaaaaaa",
  );
  expect(youtubeChannelFeedUrl("UCmktminuteaaaaaaaaaaaaa", { hideShorts: true })).toBe(
    "https://www.youtube.com/feeds/videos.xml?playlist_id=UULFmktminuteaaaaaaaaaaaaa",
  );
  expect(isYoutubeChannelId("UCmktminuteaaaaaaaaaaaaa")).toBe(true);
  expect(isYoutubeChannelId("@MarketMinute")).toBe(false);
});

test("parses YouTube channel Atom feeds into video items", () => {
  const items = parseYoutubeChannelVideos(youtubeAtomFixture);

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    id: "youtube|fedCut2026A|Fed Cuts Rates & Markets Rally",
    provider: "youtube",
    kind: "video",
    title: "Fed Cuts Rates & Markets Rally",
    url: "https://www.youtube.com/watch?v=fedCut2026A",
    canonicalUrl: "https://www.youtube.com/watch?v=fedCut2026A",
    source: "Market Minute",
    publishedAt: "2026-07-14T15:00:31.000Z",
    publishedAtText: "2026-07-14T15:00:31+00:00",
    summary: "Rate decision recap. Second line of notes.",
  });
  expect(items[1]?.publishedAt).toBe("2026-07-10T09:00:00.000Z");
  expect(items[1]?.summary).toBeUndefined();
  expect(parseYoutubeChannelVideos(youtubeAtomFixture, 1)).toHaveLength(1);
});

test("falls back to the videoId watch URL when an entry has no link tag", () => {
  const items = parseYoutubeChannelVideos(youtubeMacroAtomFixture);

  expect(items).toHaveLength(1);
  expect(items[0]?.url).toBe("https://www.youtube.com/watch?v=macroWk26Cc");
  expect(items[0]?.source).toBe("Macro Weekly");
});

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected promise to reject");
}

test("resolves YouTube channel references to canonical channel IDs", async () => {
  expect(
    await resolveYoutubeChannelId("UCmktminuteaaaaaaaaaaaaa", {
      fetch: async () => {
        throw new Error("should not fetch");
      },
    }),
  ).toBe("UCmktminuteaaaaaaaaaaaaa");
  expect(
    await resolveYoutubeChannelId(
      "https://www.youtube.com/channel/UCmktminuteaaaaaaaaaaaaa/videos",
      {
        fetch: async () => {
          throw new Error("should not fetch");
        },
      },
    ),
  ).toBe("UCmktminuteaaaaaaaaaaaaa");

  const fetchedUrls: string[] = [];
  const pageFetch = async (input: RequestInfo | URL): Promise<Response> => {
    fetchedUrls.push(fetchInputUrl(input));
    return new Response(youtubeChannelPageFixture);
  };
  expect(await resolveYoutubeChannelId("@MarketMinute", { fetch: pageFetch })).toBe(
    "UCMktabcdefghijklmnopqrs",
  );
  expect(await resolveYoutubeChannelId("MarketMinute", { fetch: pageFetch })).toBe(
    "UCMktabcdefghijklmnopqrs",
  );
  expect(fetchedUrls).toEqual([
    "https://www.youtube.com/@MarketMinute",
    "https://www.youtube.com/@MarketMinute",
  ]);

  expect(
    await rejectionMessage(
      resolveYoutubeChannelId("@Nowhere", { fetch: async () => new Response("<html></html>") }),
    ),
  ).toMatch(/channel ID/);
});

test("fetches channel videos through the Shorts-free playlist when hideShorts is set", async () => {
  const fetchedUrls: string[] = [];
  const items = await fetchYoutubeChannelVideos("UCmktminuteaaaaaaaaaaaaa", {
    hideShorts: true,
    limit: 1,
    fetch: async (input) => {
      fetchedUrls.push(fetchInputUrl(input));
      return new Response(youtubeAtomFixture);
    },
  });

  expect(fetchedUrls).toEqual([
    "https://www.youtube.com/feeds/videos.xml?playlist_id=UULFmktminuteaaaaaaaaaaaaa",
  ]);
  expect(items).toHaveLength(1);
});

test("applies date windows to YouTube channel fetches locally", async () => {
  const items = await fetchYoutubeChannelVideos("UCmktminuteaaaaaaaaaaaaa", {
    since: "2026-07-12T00:00:00.000Z",
    fetch: async () => new Response(youtubeAtomFixture),
  });

  expect(items.map((item) => item.title)).toEqual(["Fed Cuts Rates & Markets Rally"]);
});

test("merges YouTube subscriptions newest-first and isolates per-channel failures", async () => {
  const result = await fetchYoutubeSubscriptions(
    [
      "UCmktminuteaaaaaaaaaaaaa",
      "UCmktminuteaaaaaaaaaaaaa",
      "UCmacroweeklybbbbbbbbbbb",
      "UCdeadchannelccccccccccc",
    ],
    {
      fetch: async (input) => {
        const href = fetchInputUrl(input);
        if (href.includes("channel_id=UCmktminuteaaaaaaaaaaaaa")) {
          return new Response(youtubeAtomFixture);
        }
        if (href.includes("channel_id=UCmacroweeklybbbbbbbbbbb")) {
          return new Response(youtubeMacroAtomFixture);
        }
        return new Response("Not Found", { status: 404, statusText: "Not Found" });
      },
    },
  );

  expect(result.partial).toBe(true);
  expect(result.channels).toHaveLength(4);
  expect(result.channels[3]?.error).toMatch(/intermittently 404s/);
  expect(result.items.map((item) => item.title)).toEqual([
    "Fed Cuts Rates & Markets Rally",
    "Macro Weekly: Payrolls Preview",
    "CPI Print Reaction",
  ]);
  expect(result.channels[0]?.channelId).toBe("UCmktminuteaaaaaaaaaaaaa");
});

test("extracts YouTube video IDs from IDs and URL shapes", () => {
  expect(extractYoutubeVideoId("fedCut2026A")).toBe("fedCut2026A");
  expect(extractYoutubeVideoId("https://www.youtube.com/watch?v=fedCut2026A&t=42s")).toBe(
    "fedCut2026A",
  );
  expect(extractYoutubeVideoId("https://youtu.be/fedCut2026A?si=xyz")).toBe("fedCut2026A");
  expect(extractYoutubeVideoId("https://www.youtube.com/shorts/fedCut2026A")).toBe("fedCut2026A");
  expect(extractYoutubeVideoId("https://www.youtube.com/embed/fedCut2026A")).toBe("fedCut2026A");
  expect(extractYoutubeVideoId("m.youtube.com/watch?v=fedCut2026A")).toBe("fedCut2026A");
  expect(extractYoutubeVideoId("https://example.com/watch?v=fedCut2026A")).toBeUndefined();
  expect(extractYoutubeVideoId("not a video")).toBeUndefined();
  expect(youtubeWatchUrl("fedCut2026A")).toBe("https://www.youtube.com/watch?v=fedCut2026A");
});

test("parses caption tracks and picks by language preference", () => {
  const tracks = parseYoutubeCaptionTracks(youtubeWatchPageFixture);

  expect(tracks).toHaveLength(3);
  expect(tracks[0]).toEqual({
    url: "https://www.youtube.com/api/timedtext?v=fedCut2026A&lang=en&kind=asr",
    languageCode: "en",
    name: "English (auto-generated)",
    generated: true,
  });
  expect(tracks[2]).toMatchObject({ languageCode: "es", name: "Spanish", generated: false });

  expect(pickYoutubeCaptionTrack(tracks, ["en"])?.languageCode).toBe("en");
  expect(pickYoutubeCaptionTrack(tracks, ["en-GB"])?.languageCode).toBe("en-GB");
  expect(pickYoutubeCaptionTrack(tracks, ["es", "en"])?.languageCode).toBe("es");
  expect(pickYoutubeCaptionTrack(tracks, ["fr"])?.languageCode).toBe("en-GB");
  expect(pickYoutubeCaptionTrack([], ["en"])).toBeUndefined();
  expect(parseYoutubeCaptionTracks("<html>no captions</html>")).toEqual([]);
});

test("parses timedtext transcripts with double-encoded entities", () => {
  const segments = parseYoutubeTranscriptSegments(youtubeTranscriptXmlFixture);

  expect(segments).toHaveLength(3);
  expect(segments[0]).toEqual({ text: "so the fed just cut rates", startMs: 80, durationMs: 2360 });
  expect(segments[1]?.text).toBe("here's what it means for markets");
  expect(segments[2]).toEqual({ text: "and that's the wrap", startMs: 8140, durationMs: 0 });
});

test("parses srv3 timedtext paragraphs with word fragments", () => {
  const segments = parseYoutubeTranscriptSegments(youtubeSrv3TranscriptFixture);

  expect(segments).toHaveLength(3);
  expect(segments[0]).toEqual({
    text: "so the fed just cut rates",
    startMs: 80,
    durationMs: 2360,
  });
  expect(segments[1]?.text).toBe("here's what it means");
  expect(segments[2]).toEqual({ text: "plain text line", startMs: 8140, durationMs: 1000 });
});

test("fetches a full transcript through the player API caption tracks", async () => {
  const fetchedUrls: string[] = [];
  const fetchedInits: (RequestInit | undefined)[] = [];
  const transcript = await fetchYoutubeTranscript("https://www.youtube.com/watch?v=fedCut2026A", {
    languages: ["en-GB"],
    fetch: async (input, init) => {
      fetchedUrls.push(fetchInputUrl(input));
      fetchedInits.push(init);
      const href = fetchInputUrl(input);
      if (href.includes("youtubei/v1/player")) return new Response(youtubePlayerResponseFixture);
      if (href.includes("timedtext")) return new Response(youtubeSrv3TranscriptFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(fetchedUrls).toEqual([
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    "https://www.youtube.com/api/timedtext?v=fedCut2026A&caps=asr&lang=en-GB&fmt=srv3",
  ]);
  expect(fetchedInits[0]?.method).toBe("POST");
  const playerRequestBody = fetchedInits[0]?.body;
  expect(typeof playerRequestBody).toBe("string");
  expect(playerRequestBody).toContain('"videoId":"fedCut2026A"');
  expect(transcript).toMatchObject({
    videoId: "fedCut2026A",
    languageCode: "en-GB",
    trackName: "English (United Kingdom)",
    generated: false,
  });
  expect(transcript.segments).toHaveLength(3);
  expect(transcript.text).toBe("so the fed just cut rates here's what it means plain text line");
});

test("falls back to watch-page caption tracks when the player API has none", async () => {
  const fetchedUrls: string[] = [];
  const transcript = await fetchYoutubeTranscript("fedCut2026A", {
    languages: ["en-GB"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      if (href.includes("youtubei/v1/player")) return new Response(youtubePlayerNoCaptionsFixture);
      if (href.includes("/watch?v=fedCut2026A")) return new Response(youtubeWatchPageFixture);
      if (href.includes("timedtext")) return new Response(youtubeTranscriptXmlFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(fetchedUrls).toEqual([
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    "https://www.youtube.com/watch?v=fedCut2026A",
    "https://www.youtube.com/api/timedtext?v=fedCut2026A&lang=en-GB",
  ]);
  expect(transcript.languageCode).toBe("en-GB");
  expect(transcript.text).toBe(
    "so the fed just cut rates here's what it means for markets and that's the wrap",
  );

  expect(
    await rejectionMessage(
      fetchYoutubeTranscript("fedCut2026A", { fetch: async () => new Response("<html></html>") }),
    ),
  ).toMatch(/No caption tracks/);

  expect(
    await rejectionMessage(
      fetchYoutubeTranscript("fedCut2026A", {
        fetch: async (input) => {
          const href = fetchInputUrl(input);
          if (href.includes("youtubei/v1/player")) {
            return new Response(youtubePlayerResponseFixture);
          }
          return new Response("");
        },
      }),
    ),
  ).toMatch(/proof-of-origin/);
});

test("reports youtube as unsupported for subject-based feeds", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["youtube"],
    fetch: async () => {
      throw new Error("should not fetch");
    },
  });

  expect(result.providers[0]?.status).toBe("unsupported");
  expect(result.providers[0]?.warnings[0]).toMatch(/fetchYoutubeSubscriptions/);
  expect(providerCapabilities("youtube")).toEqual([]);
});

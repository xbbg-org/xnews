import { expect, test } from "bun:test";
import {
  buildCompanyNewsFeed,
  buildCompanyNewsFeedResult,
  buildNewsFeedResult,
  buildTopicNewsFeed,
  buildTopicNewsFeedResult,
  buildWatchlistNewsFeed,
  buildWatchlistNewsFeedResult,
  createTopicNewsWatcher,
  mergeNewsItems,
  parseFinvizNews,
  parseGoogleNews,
  parseSecFilings,
  parseYahooFinanceNews,
} from "../src";
import type { CompanyNewsQuery } from "../src";
import {
  finvizFixture,
  finvizSpanSourceFixture,
  googleRssFixture,
  secAtomFixture,
  yahooRssFixture,
} from "./fixtures";

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

const yahooDateWindowRssFixture = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[Lower bound included]]></title>
<link>https://example.com/rga/lower-bound</link>
<guid isPermaLink="false">lower-bound</guid>
<pubDate>Mon, 22 Jun 2026 00:00:00 +0000</pubDate>
<source url="https://example.com">Business Wire</source>
</item>
<item>
<title><![CDATA[Upper bound included]]></title>
<link>https://example.com/rga/upper-bound</link>
<guid isPermaLink="false">upper-bound</guid>
<pubDate>Tue, 23 Jun 2026 00:00:00 +0000</pubDate>
<source url="https://example.com">Business Wire</source>
</item>
<item>
<title><![CDATA[Before window excluded]]></title>
<link>https://example.com/rga/before-window</link>
<guid isPermaLink="false">before-window</guid>
<pubDate>Sun, 21 Jun 2026 23:59:59 +0000</pubDate>
<source url="https://example.com">Business Wire</source>
</item>
<item>
<title><![CDATA[Undated item excluded]]></title>
<link>https://example.com/rga/undated</link>
<guid isPermaLink="false">undated</guid>
<source url="https://example.com">Business Wire</source>
</item>
</channel></rss>`;

const watchlistCompanyGoogleFixture = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[RGA market update]]></title>
<link>https://news.google.com/rss/articles/rga-market-update</link>
<guid isPermaLink="false">rga-market-update</guid>
<pubDate>Tue, 23 Jun 2026 14:30:00 +0000</pubDate>
<source url="https://www.businesswire.com">Business Wire</source>
<description><![CDATA[RGA market update summary.]]></description>
</item>
</channel></rss>`;

const watchlistTopicGoogleFixture = `<?xml version="1.0"?><rss><channel>
<item>
<title><![CDATA[Insurance regulation roundup]]></title>
<link>https://news.google.com/rss/articles/insurance-regulation</link>
<guid isPermaLink="false">insurance-regulation</guid>
<pubDate>Tue, 23 Jun 2026 14:30:00 +0000</pubDate>
<source url="https://www.businesswire.com">Business Wire</source>
<description><![CDATA[Insurance regulation roundup summary.]]></description>
</item>
</channel></rss>`;

test("parses Yahoo Finance RSS items into normalized news", () => {
  const items = parseYahooFinanceNews(yahooRssFixture, "RGA");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "yahoo-finance",
    ticker: "RGA",
    source: "Business Wire",
    kind: "press-release",
    title: "Laura Cockrill Named Chief Financial Officer, RGA",
    publishedAt: "2026-06-22T13:00:00.000Z",
  });
});

test("parses SEC Atom filings into normalized news", () => {
  const items = parseSecFilings(secAtomFixture, "RGA");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "sec-edgar",
    ticker: "RGA",
    source: "SEC EDGAR",
    kind: "filing",
    formType: "8-K",
    accessionNumber: "0001193125-26-123456",
  });
});

test("parses Finviz news rows and keeps the previous date for time-only rows", () => {
  const items = parseFinvizNews(finvizFixture, "RGA");
  expect(items).toHaveLength(2);
  expect(items[0]?.source).toBe("Business Wire");
  expect(items[0]?.url).toBe("https://www.businesswire.com/news/home/20260701565020/en");
  expect(items[0]?.publishedAt).toBe("2026-07-01T20:15:00.000Z");
  expect(items[1]).toMatchObject({
    provider: "finviz",
    ticker: "RGA",
    source: "Zacks",
    kind: "analysis",
    publishedAtText: "Jul-01-26 09:00AM",
    publishedAt: "2026-07-01T13:00:00.000Z",
    url: "https://finviz.com/news/123/rga-analysis",
  });
});

test("parses Finviz span sources without requiring parentheses", () => {
  const items = parseFinvizNews(finvizSpanSourceFixture, "RGA");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "finviz",
    ticker: "RGA",
    source: "Zacks",
    kind: "analysis",
    url: "https://finviz.com/news/456/rga-zacks",
  });
});

test("root parseGoogleNews export parses Google RSS items", () => {
  const items = parseGoogleNews(googleRssFixture, "RGA", { ticker: "RGA" });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "google-news",
    ticker: "RGA",
    source: "Business Wire",
    kind: "press-release",
    title: "RGA names new director - Business Wire",
  });
});

test("limit validation applies to parsed source items", () => {
  expect(parseYahooFinanceNews(yahooRssFixture, "RGA", 0)).toHaveLength(0);
  expect(parseSecFilings(secAtomFixture, "RGA", 0)).toHaveLength(0);
  expect(parseFinvizNews(finvizFixture, "RGA", 0)).toHaveLength(0);
  expect(parseGoogleNews(googleRssFixture, "RGA", 0)).toHaveLength(0);

  expect(() => parseYahooFinanceNews(yahooRssFixture, "RGA", -1)).toThrow(RangeError);
  expect(() => parseSecFilings(secAtomFixture, "RGA", -1)).toThrow(RangeError);
  expect(() => parseFinvizNews(finvizFixture, "RGA", -1)).toThrow(RangeError);
  expect(() => parseGoogleNews(googleRssFixture, "RGA", -1)).toThrow(RangeError);
});

test("merges duplicated links and sorts dated items newest first", () => {
  const duplicate = parseYahooFinanceNews(yahooRssFixture, "RGA")[0];
  expect(duplicate).toBeDefined();
  if (!duplicate) throw new Error("Expected Yahoo fixture to produce a news item");
  const older = {
    ...duplicate,
    id: "older",
    url: "https://example.com/older",
    canonicalUrl: "https://example.com/older",
    publishedAt: "2026-01-01T00:00:00.000Z",
  };
  const merged = mergeNewsItems([[older, duplicate, duplicate]]);
  expect(merged.map((item) => item.url)).toEqual([
    "https://finance.yahoo.com/markets/stocks/articles/laura-cockrill-named-chief-financial-130000000.html",
    "https://example.com/older",
  ]);
});

test("buildCompanyNewsFeed can run against injected source fetchers", async () => {
  const feed = await buildCompanyNewsFeed({
    ticker: "RGA",
    companyName: "Reinsurance Group of America",
    sources: ["yahoo-finance", "sec-edgar", "finviz"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("feeds.finance.yahoo.com")) return new Response(yahooRssFixture);
      if (href.includes("sec.gov")) return new Response(secAtomFixture);
      if (href.includes("finviz.com")) return new Response(finvizFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(feed).toHaveLength(4);
  expect(new Set(feed.map((item) => item.provider))).toEqual(
    new Set(["yahoo-finance", "sec-edgar", "finviz"]),
  );
});

test("buildTopicNewsFeed fetches Google RSS for a topic query without requiring a ticker", async () => {
  const fetchedUrls: string[] = [];
  const feed = await buildTopicNewsFeed({
    query: "AI regulation",
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      return new Response(googleRssFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(1);
  const fetchedUrl = new URL(fetchedUrls[0] ?? "");
  expect(fetchedUrl.origin).toBe("https://news.google.com");
  expect(fetchedUrl.pathname).toBe("/rss/search");
  expect(fetchedUrl.searchParams.get("q")).toBe("AI regulation");
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({
    provider: "google-news",
    source: "Business Wire",
    kind: "press-release",
    title: "RGA names new director - Business Wire",
    url: "https://news.google.com/rss/articles/rga-director",
    publishedAt: "2026-06-23T14:30:00.000Z",
  });
  expect(feed[0]?.ticker).toBeUndefined();
});

test("buildTopicNewsFeedResult reports Google warnings while lenient topic feed returns items when fetch succeeds", async () => {
  const failingResult = await buildTopicNewsFeedResult({
    query: "insurance regulation",
    fetch: async () => {
      throw new Error("google unavailable");
    },
  });

  expect(failingResult.items).toEqual([]);
  expect(failingResult.warnings).toEqual(["google-news: google unavailable"]);
  expect(failingResult.providers).toHaveLength(1);
  expect(failingResult.providers[0]).toMatchObject({
    provider: "google-news",
    items: [],
    warnings: ["google-news: google unavailable"],
  });

  const feed = await buildTopicNewsFeed({
    query: "insurance regulation",
    fetch: async () => new Response(googleRssFixture),
  });

  expect(feed).toHaveLength(1);
  expect(feed[0]?.provider).toBe("google-news");
  expect(feed[0]?.title).toBe("RGA names new director - Business Wire");
});

test("createTopicNewsWatcher yields an initial realtime batch from an injected Google RSS fixture", async () => {
  const watcher = createTopicNewsWatcher({
    query: "insurance regulation",
    intervalMs: 60_000,
    fetch: async () => new Response(googleRssFixture),
  });

  const first = await watcher.next();
  expect(first.done).toBe(false);
  expect(first.value).toHaveLength(1);
  expect(first.value?.[0]).toMatchObject({
    provider: "google-news",
    source: "Business Wire",
    title: "RGA names new director - Business Wire",
  });

  await watcher.return(undefined);
});

test("partial provider failures return successful items and result warnings", async () => {
  const query: CompanyNewsQuery = {
    ticker: "RGA",
    sources: ["yahoo-finance", "finviz"] as const,
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("feeds.finance.yahoo.com")) return new Response(yahooRssFixture);
      if (href.includes("finviz.com")) throw new Error("finviz unavailable");
      throw new Error(`Unexpected URL ${href}`);
    },
  };

  const feed = await buildCompanyNewsFeed(query);
  expect(feed).toHaveLength(1);
  expect(feed[0]?.provider).toBe("yahoo-finance");

  let strictError: unknown;
  try {
    await buildCompanyNewsFeed({ ...query, strict: true });
  } catch (error) {
    strictError = error;
  }
  if (!(strictError instanceof Error)) {
    throw new Error("Expected strict provider failure to throw");
  }
  expect(strictError.message).toContain("News feed incomplete");

  const result = await buildCompanyNewsFeedResult(query);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.provider).toBe("yahoo-finance");
  expect(result.warnings).toEqual(["finviz: finviz unavailable"]);
  expect(result.providers.find((provider) => provider.provider === "finviz")?.items).toHaveLength(
    0,
  );
});

test("SEC feed fetches by CIK while preserving ticker on filings", async () => {
  const fetchedUrls: string[] = [];
  const feed = await buildCompanyNewsFeed({
    ticker: "RGA",
    cik: "0000898174",
    sources: ["sec-edgar"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      if (new URL(href).searchParams.get("CIK") !== "0000898174") {
        throw new Error(`Expected SEC CIK lookup, got ${href}`);
      }
      return new Response(secAtomFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(1);
  expect(feed).toHaveLength(1);
  expect(feed[0]).toMatchObject({
    provider: "sec-edgar",
    ticker: "RGA",
    formType: "8-K",
    accessionNumber: "0001193125-26-123456",
  });
});

test("company feed result reports provider health metadata for successful and failed providers", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["yahoo-finance", "finviz"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("feeds.finance.yahoo.com")) return new Response(yahooRssFixture);
      if (href.includes("finviz.com")) throw new Error("finviz unavailable");
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(result.items).toHaveLength(1);

  const yahooProvider = result.providers.find((provider) => provider.provider === "yahoo-finance");
  expect(yahooProvider).toBeDefined();
  if (!yahooProvider) throw new Error("Expected Yahoo provider diagnostics");
  expect(yahooProvider.status).toBe("ok");
  expect(yahooProvider.itemCount).toBe(1);
  expect(yahooProvider.items).toHaveLength(1);
  expect(Number.isNaN(Date.parse(yahooProvider.fetchedAt))).toBe(false);
  expect(yahooProvider.durationMs).toBeGreaterThanOrEqual(0);
  expect(yahooProvider.requestUrls).toHaveLength(1);
  const yahooRequestUrl = new URL(yahooProvider.requestUrls[0] ?? "");
  expect(yahooRequestUrl.origin).toBe("https://feeds.finance.yahoo.com");
  expect(yahooRequestUrl.searchParams.get("s")).toBe("RGA");

  const finvizProvider = result.providers.find((provider) => provider.provider === "finviz");
  expect(finvizProvider).toBeDefined();
  if (!finvizProvider) throw new Error("Expected Finviz provider diagnostics");
  expect(finvizProvider.status).toBe("error");
  expect(finvizProvider.itemCount).toBe(0);
  expect(finvizProvider.items).toEqual([]);
  expect(finvizProvider.warnings).toEqual(["finviz: finviz unavailable"]);
  expect(Number.isNaN(Date.parse(finvizProvider.fetchedAt))).toBe(false);
  expect(finvizProvider.durationMs).toBeGreaterThanOrEqual(0);
  expect(finvizProvider.requestUrls).toEqual(["https://finviz.com/quote.ashx?t=RGA&p=d"]);
});

test("topic subject feeds default to Google News only", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildNewsFeedResult({
    subject: { kind: "topic", query: "AI regulation" },
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      return new Response(googleRssFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(1);
  const fetchedUrl = new URL(fetchedUrls[0] ?? "");
  expect(fetchedUrl.origin).toBe("https://news.google.com");
  expect(fetchedUrl.pathname).toBe("/rss/search");
  expect(fetchedUrl.searchParams.get("q")).toBe("AI regulation");
  expect(result.providers.map((provider) => provider.provider)).toEqual(["google-news"]);
  expect(result.providers[0]).toMatchObject({
    provider: "google-news",
    status: "ok",
    itemCount: 1,
    requestUrls: [fetchedUrls[0]],
  });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]?.provider).toBe("google-news");
});

test("topic subject feeds report explicitly requested unsupported providers without fetching them", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildNewsFeedResult({
    subject: { kind: "topic", query: "AI regulation" },
    sources: ["google-news", "sec-edgar", "finviz", "yahoo-finance"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      if (!href.startsWith("https://news.google.com/")) {
        throw new Error(`Unsupported provider was fetched: ${href}`);
      }
      return new Response(googleRssFixture);
    },
  });

  expect(fetchedUrls).toHaveLength(1);
  expect(result.items).toHaveLength(1);
  expect(result.providers.map((provider) => provider.provider)).toEqual([
    "google-news",
    "sec-edgar",
    "finviz",
    "yahoo-finance",
  ]);

  for (const providerName of ["sec-edgar", "finviz", "yahoo-finance"] as const) {
    const provider = result.providers.find((entry) => entry.provider === providerName);
    expect(provider).toBeDefined();
    if (!provider) throw new Error(`Expected ${providerName} diagnostics`);
    expect(provider.status).toBe("unsupported");
    expect(provider.itemCount).toBe(0);
    expect(provider.items).toEqual([]);
    expect(provider.requestUrls).toEqual([]);
    expect(provider.warnings).toEqual([`${providerName}: topic subjects are unsupported`]);
  }
});

test("date windows keep only parseable published dates inside inclusive bounds", async () => {
  const result = await buildCompanyNewsFeedResult({
    ticker: "RGA",
    sources: ["yahoo-finance"],
    since: "2026-06-22T00:00:00.000Z",
    until: "2026-06-23T00:00:00.000Z",
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      if (href.includes("feeds.finance.yahoo.com")) return new Response(yahooDateWindowRssFixture);
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(result.items.map((item) => item.title)).toEqual([
    "Upper bound included",
    "Lower bound included",
  ]);
  expect(result.items.every((item) => item.publishedAt !== undefined)).toBe(true);
});

test("cross-source duplicates merge by normalized canonical URL with provenance", () => {
  const yahooItem = {
    id: "yahoo-duplicate",
    provider: "yahoo-finance",
    kind: "article",
    title: "RGA announces capital plan",
    url: "https://finance.yahoo.com/news/rga-capital-plan",
    canonicalUrl: "https://www.example.com/news/rga-capital-plan?utm_source=yahoo&utm_campaign=rga",
    source: "Yahoo Finance",
    publishedAt: "2026-06-23T14:30:00.000Z",
  } as const;
  const finvizItem = {
    id: "finviz-duplicate",
    provider: "finviz",
    kind: "analysis",
    title: "RGA announces capital plan",
    url: "https://www.example.com/news/rga-capital-plan?utm_medium=feed#markets",
    source: "Business Wire",
    ticker: "RGA",
    publishedAt: "2026-06-23T14:30:00.000Z",
  } as const;

  const merged = mergeNewsItems([[yahooItem], [finvizItem]]);

  expect(merged).toHaveLength(1);
  expect(merged[0]?.seenInProviders).toEqual(["finviz", "yahoo-finance"]);
  expect(merged[0]?.provenance).toEqual([
    {
      provider: "finviz",
      source: "Business Wire",
      url: "https://www.example.com/news/rga-capital-plan?utm_medium=feed#markets",
    },
    {
      provider: "yahoo-finance",
      source: "Yahoo Finance",
      url: "https://finance.yahoo.com/news/rga-capital-plan",
    },
  ]);
});

test("watchlist feed result groups per-subject results and returns merged top-level items", async () => {
  const fetchedUrls: string[] = [];
  const result = await buildWatchlistNewsFeedResult({
    subjects: [
      { kind: "company", ticker: "RGA", companyName: "Reinsurance Group of America" },
      { kind: "topic", query: "insurance regulation" },
    ],
    sources: ["google-news"],
    fetch: async (input) => {
      const href = fetchInputUrl(input);
      fetchedUrls.push(href);
      if (href.includes("insurance+regulation") || href.includes("insurance%20regulation")) {
        return new Response(watchlistTopicGoogleFixture);
      }
      if (href.startsWith("https://news.google.com/")) {
        return new Response(watchlistCompanyGoogleFixture);
      }
      throw new Error(`Unexpected URL ${href}`);
    },
  });

  expect(fetchedUrls).toHaveLength(2);
  expect(result.subjects).toHaveLength(2);
  expect(result.subjects.map((entry) => entry.subject.kind)).toEqual(["company", "topic"]);
  expect(result.subjects[0]?.result.items.map((item) => item.title)).toEqual(["RGA market update"]);
  expect(result.subjects[1]?.result.items.map((item) => item.title)).toEqual([
    "Insurance regulation roundup",
  ]);
  expect(result.items.map((item) => item.title).toSorted()).toEqual([
    "Insurance regulation roundup",
    "RGA market update",
  ]);
  expect(result.providers).toHaveLength(2);
  expect(result.partial).toBe(false);
});

test("strict feed wrappers reject provider warnings and failures", async () => {
  let companyError: unknown;
  try {
    await buildCompanyNewsFeed({
      ticker: "RGA",
      sources: ["finviz"],
      strict: true,
      fetch: async () => {
        throw new Error("finviz unavailable");
      },
    });
  } catch (error) {
    companyError = error;
  }
  if (!(companyError instanceof Error)) {
    throw new Error("Expected strict company feed to reject provider failures");
  }
  expect(companyError.message).toContain("News feed incomplete");
  expect(companyError.message).toContain("finviz: finviz unavailable");

  let topicError: unknown;
  try {
    await buildTopicNewsFeed({
      query: "AI regulation",
      strict: true,
      fetch: async () => {
        throw new Error("google unavailable");
      },
    });
  } catch (error) {
    topicError = error;
  }
  if (!(topicError instanceof Error)) {
    throw new Error("Expected strict topic feed to reject provider failures");
  }
  expect(topicError.message).toContain("Topic news feed incomplete");
  expect(topicError.message).toContain("google-news: google unavailable");

  let watchlistError: unknown;
  try {
    await buildWatchlistNewsFeed({
      subjects: [{ kind: "topic", query: "AI regulation" }],
      sources: ["finviz"],
      strict: true,
      fetch: async () => {
        throw new Error("Unsupported provider should not be fetched");
      },
    });
  } catch (error) {
    watchlistError = error;
  }
  if (!(watchlistError instanceof Error)) {
    throw new Error("Expected strict watchlist feed to reject provider warnings");
  }
  expect(watchlistError.message).toMatch(/incomplete/i);
  expect(watchlistError.message).toContain("finviz: topic subjects are unsupported");
});

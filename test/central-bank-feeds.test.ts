import { expect, test } from "bun:test";
import { buildTopicNewsFeed, buildTopicNewsFeedResult } from "../src/feed.js";
import { BROWSERISH_USER_AGENT, DEFAULT_USER_AGENT } from "../src/http.js";
import {
  CENTRAL_BANK_NEWS_PROVIDERS,
  CENTRAL_BANK_RESEARCH_PROVIDERS,
  fetchFixedFeedNews,
  FIXED_FEEDS,
  FIXED_FEED_PROVIDERS,
  parseFixedFeedNews,
} from "../src/sources/fixedfeeds.js";
import type { NewsProvider, SourceFetch } from "../src/types.js";

const bcbAtomFixture = `
  <feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
      <title>Monetary policy decision published</title>
      <link rel="alternate" href="https://www.bcb.gov.br/en/pressdetail/1001" />
      <id>https://www.bcb.gov.br/en/pressdetail/1001</id>
      <updated>2026-08-08T14:30:00-03:00</updated>
      <summary>The monetary policy committee announced its latest decision.</summary>
    </entry>
    <entry>
      <title>Payments system notice</title>
      <link rel="alternate" href="https://www.bcb.gov.br/en/pressdetail/1002" />
      <id>https://www.bcb.gov.br/en/pressdetail/1002</id>
      <updated>2026-08-07T10:00:00-03:00</updated>
      <summary>Operational information for payment providers.</summary>
    </entry>
  </feed>
`;

const relativeRssFixture = `
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <item>
        <title>Monetary policy statement</title>
        <link>/wps/wcm/connect/en/tcmb+en/main+menu/announcements/decision</link>
        <guid>decision-1</guid>
        <dc:date>2026-08-07</dc:date>
      </item>
    </channel>
  </rss>
`;

const dnbRelativeRssFixture = `
  <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
      <item>
        <title>DNB monetary policy statement</title>
        <link>/en/general-news/news-2026/monetary-policy-statement</link>
        <guid>dnb-statement-1</guid>
        <dc:date>2026-08-08</dc:date>
      </item>
    </channel>
  </rss>
`;

const rssOneFixture = `
  <rdf:RDF
    xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
  >
    <channel rdf:about="https://www.bankofcanada.ca/" />
    <item rdf:about="https://www.bankofcanada.ca/2026/08/staff-working-paper-2026-30/">
      <title>Productivity and monetary transmission</title>
      <link>https://www.bankofcanada.ca/2026/08/staff-working-paper-2026-30/</link>
      <dc:date>2026-08-06T09:15:00-04:00</dc:date>
    </item>
  </rdf:RDF>
`;

const expectedNewsProviders = [
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
] as const satisfies readonly NewsProvider[];

const expectedResearchProviders = [
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
] as const satisfies readonly NewsProvider[];

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

test("central-bank groups contain the verified news and research cohorts", () => {
  expect(CENTRAL_BANK_NEWS_PROVIDERS).toEqual(expectedNewsProviders);
  expect(CENTRAL_BANK_RESEARCH_PROVIDERS).toEqual(expectedResearchProviders);
  expect(CENTRAL_BANK_NEWS_PROVIDERS.length).toBeGreaterThanOrEqual(25);
  expect(CENTRAL_BANK_RESEARCH_PROVIDERS.length).toBeGreaterThanOrEqual(10);

  const allGroupedProviders = [...CENTRAL_BANK_NEWS_PROVIDERS, ...CENTRAL_BANK_RESEARCH_PROVIDERS];
  expect(new Set(allGroupedProviders).size).toBe(allGroupedProviders.length);
  for (const provider of allGroupedProviders) {
    expect(FIXED_FEED_PROVIDERS).toContain(provider);
    expect(FIXED_FEEDS[provider]).toBeDefined();
  }
});

test("central-bank registry rows declare safe endpoints, formats, kinds, and poll intervals", () => {
  for (const provider of CENTRAL_BANK_NEWS_PROVIDERS) {
    const definition = FIXED_FEEDS[provider];
    expect(definition.suggestedMinPollSeconds).toBeGreaterThanOrEqual(600);
    expect(definition.urls.length).toBeGreaterThan(0);
    for (const url of definition.urls) expect(new URL(url).protocol).toBe("https:");
    if (definition.baseUrl) expect(new URL(definition.baseUrl).protocol).toBe("https:");
  }

  for (const provider of CENTRAL_BANK_RESEARCH_PROVIDERS) {
    const definition = FIXED_FEEDS[provider];
    expect(definition.kind).toBe("analysis");
    expect(definition.suggestedMinPollSeconds).toBeGreaterThanOrEqual(21600);
    for (const url of definition.urls) expect(new URL(url).protocol).toBe("https:");
  }

  expect(FIXED_FEEDS["bcb-news"]).toMatchObject({
    format: "atom",
    kind: "press-release",
  });
  expect(FIXED_FEEDS["dnb-news"]).toMatchObject({
    baseUrl: "https://www.dnb.nl",
    userAgentPolicy: "default",
  });
  expect(FIXED_FEEDS["dnb-research"]).toMatchObject({
    baseUrl: "https://www.dnb.nl",
    userAgentPolicy: "default",
  });
  expect(FIXED_FEEDS["tcmb-news"]).toMatchObject({
    urls: [
      "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Bottom+Menu/Other/RSS/Press+Releases",
      "https://www.tcmb.gov.tr/wps/wcm/connect/EN/TCMB+EN/Bottom+Menu/Other/RSS/Remarks+by+Governor",
    ],
    format: "atom",
    kind: "unknown",
  });
  expect(FIXED_FEEDS["tcmb-news"].baseUrl).toBeUndefined();
  expect(FIXED_FEEDS["bcb-research"]).toMatchObject({ format: "atom", kind: "analysis" });
  expect(FIXED_FEEDS["rba-news"].format).toBeUndefined();
  expect(FIXED_FEEDS["bsp-news"].kind).toBe("press-release");
  expect(FIXED_FEEDS["cnb-news"].kind).toBe("press-release");
  expect(FIXED_FEEDS["bis-press"].kind).toBe("press-release");
  expect(FIXED_FEEDS["bok-news"].kind).toBeUndefined();
  expect(FIXED_FEEDS["ecb-news"].kind).toBeUndefined();
});

test("relative central-bank links resolve against every declarative base URL", () => {
  const cases = [["sarb-news", "https://www.resbank.co.za"]] as const;

  for (const [provider, baseUrl] of cases) {
    const item = parseFixedFeedNews(provider, relativeRssFixture, {
      query: "monetary policy",
    })[0];
    const expectedUrl = new URL(
      "/wps/wcm/connect/en/tcmb+en/main+menu/announcements/decision",
      baseUrl,
    ).href;

    expect(item).toMatchObject({
      provider,
      url: expectedUrl,
      canonicalUrl: expectedUrl,
      publishedAtText: "2026-08-07",
    });
    expect(item?.publishedAt).toBeDefined();
  }
});

test("DNB fixed feeds use their declared agent, resolve relative links, and allow overrides", async () => {
  const requests: Array<{ readonly url: string; readonly userAgent: string }> = [];
  const fetch: SourceFetch = async (input, init) => {
    const url = fetchInputUrl(input);
    const userAgent = new Headers(init?.headers).get("User-Agent");
    if (userAgent === null) throw new Error("Expected User-Agent header");
    requests.push({ url, userAgent });
    return new Response(url.includes("bcb.gov.br") ? bcbAtomFixture : dnbRelativeRssFixture);
  };

  const subject = { query: "monetary policy" };
  const dnbItems = await fetchFixedFeedNews("dnb-news", subject, { fetch });
  await fetchFixedFeedNews("dnb-research", subject, { fetch });
  await fetchFixedFeedNews("bcb-news", subject, { fetch });
  await fetchFixedFeedNews("dnb-news", subject, {
    fetch,
    userAgent: "caller-agent",
  });

  const dnbNewsUrl = FIXED_FEEDS["dnb-news"].urls[0];
  const dnbResearchUrl = FIXED_FEEDS["dnb-research"].urls[0];
  const bcbNewsUrl = FIXED_FEEDS["bcb-news"].urls[0];
  if (dnbNewsUrl === undefined || dnbResearchUrl === undefined || bcbNewsUrl === undefined) {
    throw new Error("Expected each User-Agent policy fixture to declare a URL");
  }

  expect(requests).toEqual([
    { url: dnbNewsUrl, userAgent: DEFAULT_USER_AGENT },
    { url: dnbResearchUrl, userAgent: DEFAULT_USER_AGENT },
    { url: bcbNewsUrl, userAgent: BROWSERISH_USER_AGENT },
    { url: dnbNewsUrl, userAgent: "caller-agent" },
  ]);
  expect(dnbItems[0]).toMatchObject({
    provider: "dnb-news",
    url: "https://www.dnb.nl/en/general-news/news-2026/monetary-policy-statement",
    canonicalUrl: "https://www.dnb.nl/en/general-news/news-2026/monetary-policy-statement",
  });
});

test("RSS 1.0 research rows retain DC dates and analysis classification", () => {
  const item = parseFixedFeedNews("bank-canada-research", rssOneFixture, {
    query: "productivity",
  })[0];

  expect(item).toMatchObject({
    provider: "bank-canada-research",
    kind: "analysis",
    publishedAt: "2026-08-06T13:15:00.000Z",
    publishedAtText: "2026-08-06T09:15:00-04:00",
  });
});

test("Atom fixed feeds use injected fetch, preserve dates, and filter subjects locally", async () => {
  const requestedUrls: string[] = [];
  const fetch: SourceFetch = async (input) => {
    requestedUrls.push(fetchInputUrl(input));
    return new Response(bcbAtomFixture, {
      status: 200,
      headers: { "content-type": "application/atom+xml" },
    });
  };

  const items = await buildTopicNewsFeed({
    query: "monetary policy",
    sources: ["bcb-news"],
    fetch,
  });

  expect(requestedUrls).toEqual([...FIXED_FEEDS["bcb-news"].urls]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    provider: "bcb-news",
    kind: "press-release",
    title: "Monetary policy decision published",
    publishedAt: "2026-08-08T17:30:00.000Z",
    publishedAtText: "2026-08-08T14:30:00-03:00",
  });
});

test("multi-URL fixed feeds preserve successful items and report failed siblings", async () => {
  const urls = FIXED_FEEDS["bank-canada-news"].urls;
  const result = await buildTopicNewsFeedResult({
    query: "monetary transmission",
    sources: ["bank-canada-news"],
    fetch: async (input) =>
      fetchInputUrl(input) === urls[0]
        ? new Response(rssOneFixture)
        : new Response("upstream response must stay private", { status: 503 }),
  });

  expect(result.items.map((item) => item.title)).toEqual([
    "Productivity and monetary transmission",
  ]);
  expect(result.partial).toBe(true);
  expect(result.providers[0]).toMatchObject({
    provider: "bank-canada-news",
    status: "partial",
    itemCount: 1,
    requestUrls: urls,
  });
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0]).toContain(urls[1]);
  expect(result.warnings[0]).toContain("HTTP 503");
  expect(result.warnings[0]).not.toContain("upstream response must stay private");
});

test("multi-URL fixed feeds apply the news limit after canonical merge and chronology", async () => {
  const urls = FIXED_FEEDS["bank-canada-news"].urls;
  const firstFeed = `
    <rss version="2.0">
      <channel>
        <item>
          <title>Monetary transmission shared bulletin</title>
          <link>https://www.bankofcanada.ca/2026/08/shared-bulletin/</link>
          <guid>shared-bulletin</guid>
          <pubDate>Mon, 04 Aug 2025 00:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Monetary transmission older unique item</title>
          <link>https://www.bankofcanada.ca/2026/08/older-unique/</link>
          <guid>older-unique</guid>
          <pubDate>Sat, 02 Aug 2025 00:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
  `;
  const secondFeed = `
    <rss version="2.0">
      <channel>
        <item>
          <title>Monetary transmission shared bulletin</title>
          <link>https://www.bankofcanada.ca/2026/08/shared-bulletin/</link>
          <guid>shared-bulletin</guid>
          <pubDate>Mon, 04 Aug 2025 00:00:00 GMT</pubDate>
        </item>
        <item>
          <title>Monetary transmission newest unique item</title>
          <link>https://www.bankofcanada.ca/2026/08/newest-unique/</link>
          <guid>newest-unique</guid>
          <pubDate>Sun, 03 Aug 2025 00:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
  `;

  const result = await buildTopicNewsFeedResult({
    query: "monetary transmission",
    sources: ["bank-canada-news"],
    limit: 2,
    fetch: async (input) => new Response(fetchInputUrl(input) === urls[0] ? firstFeed : secondFeed),
  });

  expect(result.items.map((item) => item.title)).toEqual([
    "Monetary transmission shared bulletin",
    "Monetary transmission newest unique item",
  ]);
});

test("multi-URL fixed feeds report an error when every URL fails", async () => {
  const urls = FIXED_FEEDS["bank-canada-news"].urls;
  const result = await buildTopicNewsFeedResult({
    query: "monetary transmission",
    sources: ["bank-canada-news"],
    fetch: async () => new Response("private failure body", { status: 502 }),
  });

  expect(result.items).toEqual([]);
  expect(result.partial).toBe(true);
  expect(result.providers[0]).toMatchObject({
    provider: "bank-canada-news",
    status: "error",
    itemCount: 0,
    requestUrls: urls,
    error: { code: "http_status", status: 502 },
  });
  expect(result.warnings).toHaveLength(urls.length);
  expect(result.warnings.join(" ")).not.toContain("private failure body");
  for (const url of urls) {
    expect(result.warnings.some((warning) => warning.includes(url))).toBe(true);
  }
});

test("zero limit avoids fixed-feed network requests", async () => {
  let fetchCount = 0;
  const items = await fetchFixedFeedNews(
    "bcb-news",
    { query: "monetary policy" },
    {
      limit: 0,
      fetch: async () => {
        fetchCount += 1;
        return new Response(bcbAtomFixture);
      },
    },
  );

  expect(items).toEqual([]);
  expect(fetchCount).toBe(0);
});

import { expect, test } from "bun:test";
import * as catalog from "../src/catalog.js";
import {
  CENTRAL_BANK_NEWS_PROVIDERS,
  CENTRAL_BANK_RESEARCH_PROVIDERS,
  buildCompanyNewsFeedResult,
  buildTopicNewsFeedResult,
  fredDataSource,
  providerCapabilities,
} from "../src/index.js";
import * as parsers from "../src/parsers.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

const arxivFixture = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>https://arxiv.org/abs/2601.00001v1</id><published>2026-01-01T00:00:00Z</published>
    <title>Machine learning result</title><link href="https://arxiv.org/abs/2601.00001v1" rel="alternate" />
    <category term="cs.LG" /><arxiv:primary_category term="cs.LG" />
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2601.00002v1</id><published>2026-01-02T00:00:00Z</published>
    <title>Monetary policy result</title><link href="https://arxiv.org/abs/2601.00002v1" rel="alternate" />
    <category term="econ.EM" /><arxiv:primary_category term="econ.EM" />
  </entry>
</feed>`;

const openAlexFixture = JSON.stringify({
  meta: { count: 1, per_page: 1 },
  results: [
    {
      id: "https://openalex.org/W100",
      display_name: "Monetary transmission at Acme",
      publication_date: "2026-02-03",
      primary_location: { landing_page_url: "https://example.test/openalex-paper" },
    },
  ],
});

const bisWorkingPapersFixture = JSON.stringify({
  list: {
    "/publ/work1": {
      path: "/publ/work1",
      publication_start_date: "2026-01-01",
      short_title: "Unrelated financial stability paper",
    },
    "/publ/work2": {
      path: "/publ/work2",
      publication_start_date: "2026-02-01",
      short_title: "Monetary policy transmission",
      topics: ["Monetary policy"],
    },
  },
});

const bisResearchHubRssFixture = `<?xml version="1.0"?><rdf:RDF
  xmlns="http://purl.org/rss/1.0/"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:cb="http://www.cbwiki.net/wiki/index.php/Specification_1.1">
  <item><title>Inflation dynamics</title><link>https://alpha.example/paper.pdf</link><dc:date>2026-01-01</dc:date>
    <cb:paper><cb:institutionAbbrev>Alpha Bank</cb:institutionAbbrev><cb:resource><cb:link>https://alpha.example/paper.pdf</cb:link></cb:resource></cb:paper>
  </item>
  <item><title>Inflation expectations</title><link>https://beta.example/paper.pdf</link><dc:date>2026-02-01</dc:date>
    <cb:paper><cb:institutionAbbrev>Beta Bank</cb:institutionAbbrev><cb:resource><cb:link>https://beta.example/paper.pdf</cb:link></cb:resource></cb:paper>
  </item>
</rdf:RDF>`;

const fixedAtomFeedFixture =
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Central bank policy update</title><link href="https://example.test/atom" /></entry></feed>';
const fixedRssFeedFixture =
  '<rss version="2.0"><channel><item><title>Central bank policy update</title><link>https://example.test/rss</link></item></channel></rss>';

test("research providers expose exact company and topic capabilities", () => {
  for (const provider of ["arxiv", "openalex", "bis-research", "bis-research-hub"] as const) {
    expect(providerCapabilities(provider)).toEqual(["company", "topic"]);
  }
});

test("research provider policies preserve governed access and license caveats", () => {
  expect(catalog.ARXIV_PROVIDER_POLICY.minRequestIntervalMs).toBe(3_000);
  expect(catalog.OPENALEX_PROVIDER_POLICY).toMatchObject({
    maxRequestsPerSecond: 100,
    requiresApiKey: true,
  });
  expect(catalog.OPENALEX_PROVIDER_POLICY.notes).toContain("daily budget");
  expect(catalog.FRED_PROVIDER_POLICY).toMatchObject({
    maxRequestsPerSecond: 2,
    requiresApiKey: true,
    termsUrl: "https://fred.stlouisfed.org/docs/api/terms_of_use.html",
  });
  expect(catalog.BIS_PROVIDER_POLICY.notes).toContain("not a content-redistribution license");
  expect(catalog.PROVIDER_POLICIES["sec-edgar"]).toMatchObject({
    maxRequestsPerSecond: 10,
    requiresDeclaredUserAgent: true,
  });
  expect(catalog.PROVIDER_POLICIES["msrb-emma"]?.requiresTermsAcceptance).toBe(
    "https://emma.msrb.org",
  );
});

test("arXiv constrains categories and dates upstream before local filtering", async () => {
  const requested: string[] = [];
  const result = await buildTopicNewsFeedResult({
    query: "monetary policy",
    sources: ["arxiv"],
    arxivCategories: ["econ", "q-fin.EC"],
    since: "2025-12-31T00:00:00Z",
    until: "2026-12-31T23:59:00Z",
    limit: 2,
    fetch: async (input) => {
      requested.push(inputUrl(input));
      return new Response(arxivFixture);
    },
  });

  expect(result.items.map((item) => item.title)).toEqual(["Monetary policy result"]);
  expect(result.providers[0]).toMatchObject({
    provider: "arxiv",
    status: "ok",
    capabilities: ["company", "topic"],
    itemCount: 1,
  });
  const url = new URL(requested[0] ?? "");
  expect(url.searchParams.get("search_query")).toBe(
    '(cat:econ.* OR cat:q-fin.EC) AND all:"monetary policy" AND submittedDate:[202512310000 TO 202612312359]',
  );
  expect(url.searchParams.get("max_results")).toBe("2");
  expect(result.providers[0]?.requestUrls).toEqual(requested);
});

test("invalid arXiv categories disable the provider before network I/O", async () => {
  let fetchCalls = 0;
  for (const category of [".", "-", "econ.", ".econ", "econ..EM", "q--fin.EC"]) {
    const result = await buildTopicNewsFeedResult({
      query: "monetary policy",
      sources: ["arxiv"],
      arxivCategories: [category],
      fetch: async () => {
        fetchCalls += 1;
        return new Response(arxivFixture);
      },
    });

    expect(result.partial).toBe(true);
    expect(result.providers[0]).toMatchObject({
      provider: "arxiv",
      status: "disabled",
      requestUrls: [],
      error: { code: "config" },
    });
  }
  expect(fetchCalls).toBe(0);
});

test("OpenAlex dispatch requires a key and redacts it from diagnostics", async () => {
  let missingKeyCalls = 0;
  const missingKey = await buildTopicNewsFeedResult({
    query: "monetary policy",
    sources: ["openalex"],
    fetch: async () => {
      missingKeyCalls += 1;
      return new Response(openAlexFixture);
    },
  });
  expect(missingKeyCalls).toBe(0);
  expect(missingKey.providers[0]).toMatchObject({
    provider: "openalex",
    status: "disabled",
    error: { code: "config" },
  });

  const secret = "openalex-secret-key";
  const requested: string[] = [];
  const result = await buildCompanyNewsFeedResult({
    ticker: "ACME",
    companyName: "Acme Corporation",
    sources: ["openalex"],
    openAlexApiKey: secret,
    since: "2026-01-01",
    until: "2026-12-31",
    limit: 37,
    fetch: async (input) => {
      requested.push(inputUrl(input));
      return new Response(openAlexFixture);
    },
  });

  expect(new URL(requested[0] ?? "").searchParams.get("search")).toBe("Acme Corporation");
  expect(new URL(requested[0] ?? "").searchParams.get("api_key")).toBe(secret);
  expect(new URL(requested[0] ?? "").searchParams.get("filter")).toBe(
    "from_publication_date:2026-01-01,to_publication_date:2026-12-31",
  );
  expect(new URL(requested[0] ?? "").searchParams.get("per_page")).toBe("37");
  expect(result.providers[0]).toMatchObject({ provider: "openalex", status: "ok", itemCount: 1 });
  expect(result.providers[0]?.requestUrls.join(" ")).not.toContain(secret);
  expect(new URL(result.providers[0]?.requestUrls[0] ?? "").searchParams.get("api_key")).toBe(
    "<redacted>",
  );
});

test("BIS Working Papers filter the full snapshot locally by subject and institution", async () => {
  const requested: string[] = [];
  const result = await buildCompanyNewsFeedResult({
    ticker: "BIS",
    companyName: "monetary policy",
    sources: ["bis-research"],
    bisInstitutions: ["Bank for International Settlements"],
    limit: 1,
    fetch: async (input) => {
      requested.push(inputUrl(input));
      return new Response(bisWorkingPapersFixture);
    },
  });

  expect(result.items.map((item) => item.title)).toEqual(["Monetary policy transmission"]);
  expect(result.providers[0]).toMatchObject({
    provider: "bis-research",
    status: "ok",
    itemCount: 1,
  });
  expect(requested).toEqual([catalog.BIS_WORKING_PAPERS_URL]);
  expect(result.providers[0]?.requestUrls).toEqual([catalog.BIS_WORKING_PAPERS_URL]);
});

test("recent BIS Research Hub uses RSS and applies institution filtering", async () => {
  const requested: string[] = [];
  const result = await buildTopicNewsFeedResult({
    query: "inflation",
    sources: ["bis-research-hub"],
    bisInstitutions: ["Beta Bank"],
    fetch: async (input) => {
      requested.push(inputUrl(input));
      return new Response(bisResearchHubRssFixture);
    },
  });

  expect(result.items.map((item) => item.title)).toEqual(["Inflation expectations"]);
  expect(requested).toEqual([catalog.BIS_RESEARCH_HUB_RSS_URL]);
  expect(requested).not.toContain(catalog.BIS_RESEARCH_HUB_URL);
  expect(result.providers[0]).toMatchObject({
    provider: "bis-research-hub",
    status: "ok",
    itemCount: 1,
  });
});

test("central-bank groups are public and every grouped provider uses fixed-feed dispatch", async () => {
  expect(CENTRAL_BANK_NEWS_PROVIDERS).toEqual(catalog.CENTRAL_BANK_NEWS_PROVIDERS);
  expect(CENTRAL_BANK_RESEARCH_PROVIDERS).toEqual(catalog.CENTRAL_BANK_RESEARCH_PROVIDERS);

  for (const provider of [...CENTRAL_BANK_NEWS_PROVIDERS, ...CENTRAL_BANK_RESEARCH_PROVIDERS]) {
    const result = await buildTopicNewsFeedResult({
      query: "central bank",
      sources: [provider],
      fetch: async () =>
        new Response(
          catalog.FIXED_FEEDS[provider].format === "atom"
            ? fixedAtomFeedFixture
            : fixedRssFeedFixture,
        ),
    });
    expect(result.providers[0]?.status).toBe("ok");
    expect(result.providers[0]?.provider).toBe(provider);
    expect(result.providers[0]?.requestUrls).toEqual(catalog.FIXED_FEEDS[provider].urls);
  }
});

test("research providers stay opt-in and public entrypoints expose source APIs", async () => {
  const topic = await buildTopicNewsFeedResult({
    query: "defaults",
    fetch: async () => new Response("<rss><channel /></rss>"),
  });
  const company = await buildCompanyNewsFeedResult({
    ticker: "ACME",
    companyName: "Acme Corporation",
    secUserAgent: "xnews-integration-test tests@example.com",
    fetch: async (input) =>
      new Response(inputUrl(input).includes("sec.gov") ? "<feed />" : "<rss><channel /></rss>"),
  });

  expect(topic.providers.map((provider) => provider.provider)).toEqual(["google-news"]);
  expect(company.providers.map((provider) => provider.provider)).toEqual([
    "sec-edgar",
    "yahoo-finance",
    "google-news",
    "finviz",
  ]);
  expect(typeof catalog.arxivSearchUrl).toBe("function");
  expect(typeof catalog.openAlexWorksUrl).toBe("function");
  expect(typeof catalog.fredSeriesObservationsUrl).toBe("function");
  expect(typeof parsers.parseArxivPapers).toBe("function");
  expect(typeof parsers.parseOpenAlexWorks).toBe("function");
  expect(typeof parsers.parseBisResearchHubRecent).toBe("function");
  expect(typeof parsers.parseFredObservations).toBe("function");
  expect(typeof fredDataSource).toBe("function");
});

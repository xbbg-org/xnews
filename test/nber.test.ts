import { expect, test } from "bun:test";
import { parsePublishedAt } from "../src/dates.js";
import {
  fetchNberRecentPapers,
  fetchNberWorkingPapers,
  NBER_RSS_URL,
  nberListingUrl,
  parseNberRecentPapers,
  parseNberWorkingPapers,
} from "../src/sources/nber.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeListingRecord = {
  imageurl: "/sites/default/files/styles/working_paper/public/2026-08/nber.jpg",
  authors: [
    '<a href="/people/ada_economist">Ada Economist</a>',
    '<a href="/people/ben_researcher">Ben &amp; Researcher</a>',
  ],
  publisheddate: null,
  displaydate: "August 2026",
  abstract: "<p>Inflation &amp; output are studied together.</p>",
  newthisweek: true,
  nid: "123456",
  title: "Inflation and Output Dynamics",
  type: "working_paper",
  url: "/papers/w34210",
  id: "working_paper_34210",
  backofficeid: "34210",
  displaytypename: "Working Paper",
};

const completeListingResponse = JSON.stringify({
  totalResults: 1,
  results: [completeListingRecord],
});

const completeRssItem = `
  <item>
    <title>Monetary Policy &amp; Employment -- by Alice Author, Bob Economist</title>
    <description><![CDATA[<p>A study of monetary policy &amp; employment.</p>]]></description>
    <link>https://www.nber.org/papers/w34211</link>
    <guid>https://www.nber.org/papers/w34211</guid>
    <pubDate>Fri, 07 Aug 2026 14:30:00 GMT</pubDate>
  </item>`;

const completeRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>New NBER Working Papers</title>${completeRssItem}</channel></rss>`;

function rssWithItems(items: string): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;
}

test("builds default and fully filtered NBER listing URLs", () => {
  expect(nberListingUrl()).toBe(
    "https://www.nber.org/api/v1/working_page_listing/contentType/working_paper/_/_/search?page=1&perPage=50&sortBy=public_date",
  );
  expect(
    nberListingUrl({
      q: "inflation & growth",
      page: 3,
      perPage: 75,
      sortBy: "public_date",
    }),
  ).toBe(
    "https://www.nber.org/api/v1/working_page_listing/contentType/working_paper/_/_/search?page=3&perPage=75&sortBy=public_date&q=inflation+%26+growth",
  );
  expect(() => nberListingUrl({ page: 0 })).toThrow("page must be a positive integer");
  expect(() => nberListingUrl({ page: 1.5 })).toThrow("page must be a positive integer");
  expect(() => nberListingUrl({ perPage: -1 })).toThrow("perPage must be a positive integer");
});

test("parses complete NBER listing metadata and strips author HTML", () => {
  const papers = parseNberWorkingPapers(completeListingResponse);
  const listingPublishedAt = parsePublishedAt("August 2026")?.instant;

  if (!listingPublishedAt) throw new Error("expected August 2026 to parse");
  expect(papers).toEqual([
    {
      id: "nber|w34210|Inflation and Output Dynamics",
      provider: "nber",
      kind: "analysis",
      title: "Inflation and Output Dynamics",
      url: "https://www.nber.org/papers/w34210",
      canonicalUrl: "https://www.nber.org/papers/w34210",
      source: "NBER Working Papers",
      publishedAt: listingPublishedAt,
      publishedAtText: "August 2026",
      summary: "Inflation & output are studied together.",
      research: {
        authors: ["Ada Economist", "Ben & Researcher"],
        institution: "NBER",
        series: "NBER Working Papers",
        issue: "34210",
        externalId: "w34210",
      },
    },
  ]);
});

test("skips invalid listing records, deduplicates paper numbers, and truncates to limit", () => {
  const second = {
    ...completeListingRecord,
    title: "A Second Paper",
    url: "/papers/w34212",
    displaydate: "July 2026",
  };
  const body = JSON.stringify({
    totalResults: 5,
    results: [
      { title: "Missing URL" },
      completeListingRecord,
      { ...completeListingRecord, title: "Duplicate presentation" },
      second,
      null,
    ],
  });

  expect(parseNberWorkingPapers(body).map((paper) => paper.research.externalId)).toEqual([
    "w34210",
    "w34212",
  ]);
  expect(parseNberWorkingPapers(body, 1).map((paper) => paper.title)).toEqual([
    "Inflation and Output Dynamics",
  ]);
  expect(parseNberWorkingPapers(body, 0)).toEqual([]);
});

test("distinguishes empty NBER listings from listings with no valid records", () => {
  expect(parseNberWorkingPapers(JSON.stringify({ totalResults: 0, results: [] }))).toEqual([]);
  expect(() =>
    parseNberWorkingPapers(JSON.stringify({ totalResults: 1, results: [{ title: "No URL" }] })),
  ).toThrow("NBER Working Papers response contained no valid records");
  expect(() => parseNberWorkingPapers(JSON.stringify({ totalResults: 0 }))).toThrow(
    "unexpected NBER Working Papers response shape",
  );
});

test("fetches NBER listings with injected transport, mapped page size, and custom user-agent", async () => {
  const requested: string[] = [];
  const userAgents: (string | null)[] = [];
  const papers = await fetchNberWorkingPapers({
    q: "inflation & growth",
    page: 2,
    limit: 1,
    userAgent: "nber-test/1.0 contact@example.com",
    fetch: async (input, init) => {
      requested.push(inputUrl(input));
      userAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(completeListingResponse);
    },
  });

  expect(requested).toEqual([
    "https://www.nber.org/api/v1/working_page_listing/contentType/working_paper/_/_/search?page=2&perPage=1&sortBy=public_date&q=inflation+%26+growth",
  ]);
  expect(userAgents).toEqual(["nber-test/1.0 contact@example.com"]);
  expect(papers).toHaveLength(1);
});

test("parses NBER RSS titles, bylines, publication dates, and abstracts", () => {
  const papers = parseNberRecentPapers(completeRss);

  expect(papers).toEqual([
    {
      id: "nber|w34211|Monetary Policy & Employment",
      provider: "nber",
      kind: "analysis",
      title: "Monetary Policy & Employment",
      url: "https://www.nber.org/papers/w34211",
      canonicalUrl: "https://www.nber.org/papers/w34211",
      source: "NBER Working Papers",
      publishedAt: "2026-08-07T14:30:00.000Z",
      publishedAtText: "Fri, 07 Aug 2026 14:30:00 GMT",
      summary: "A study of monetary policy & employment.",
      research: {
        authors: ["Alice Author", "Bob Economist"],
        institution: "NBER",
        series: "NBER Working Papers",
        issue: "34211",
        externalId: "w34211",
      },
    },
  ]);
});

test("skips invalid RSS records, deduplicates paper numbers, and truncates to limit", () => {
  const second = `
    <item>
      <title>Fiscal Rules -- by Carol Researcher</title>
      <description>Fiscal policy evidence.</description>
      <link>https://www.nber.org/papers/w34212</link>
      <pubDate>Thu, 06 Aug 2026 09:00:00 GMT</pubDate>
    </item>`;
  const xml = rssWithItems(`
    <item><title>Missing paper link -- by Nobody</title></item>
    ${completeRssItem}
    ${completeRssItem}
    ${second}`);

  expect(parseNberRecentPapers(xml).map((paper) => paper.research.externalId)).toEqual([
    "w34211",
    "w34212",
  ]);
  expect(parseNberRecentPapers(xml, 1).map((paper) => paper.title)).toEqual([
    "Monetary Policy & Employment",
  ]);
  expect(parseNberRecentPapers(xml, 0)).toEqual([]);
});

test("throws when an NBER RSS payload contains candidates but no valid records", () => {
  expect(() =>
    parseNberRecentPapers(
      rssWithItems("<item><title>Missing paper link -- by Nobody</title></item>"),
    ),
  ).toThrow("NBER RSS response contained no valid records");
});

test("fetches the NBER RSS endpoint with injected transport and a custom user-agent", async () => {
  const requested: string[] = [];
  const userAgents: (string | null)[] = [];
  const papers = await fetchNberRecentPapers({
    limit: 1,
    userAgent: "nber-rss-test/1.0 contact@example.com",
    fetch: async (input, init) => {
      requested.push(inputUrl(input));
      userAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(completeRss);
    },
  });

  expect(requested).toEqual([NBER_RSS_URL]);
  expect(userAgents).toEqual(["nber-rss-test/1.0 contact@example.com"]);
  expect(papers).toHaveLength(1);
});

test("zero limits short-circuit both NBER fetch functions before network access", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    return new Response("unused");
  };

  expect(await fetchNberWorkingPapers({ limit: 0, fetch })).toEqual([]);
  expect(await fetchNberRecentPapers({ limit: 0, fetch })).toEqual([]);
  expect(calls).toBe(0);
});

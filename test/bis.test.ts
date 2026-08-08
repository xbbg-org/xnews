import { expect, test } from "bun:test";
import {
  BIS_RESEARCH_HUB_RSS_URL,
  BIS_RESEARCH_HUB_URL,
  BIS_WORKING_PAPERS_URL,
  fetchBisResearchHub,
  fetchBisResearchHubRecent,
  fetchBisWorkingPapers,
  parseBisResearchHub,
  parseBisResearchHubRecent,
  parseBisWorkingPapers,
} from "../src/sources/bis.js";

const workingPapersFixture = JSON.stringify({
  list: {
    "/publ/work100": {
      path: "/publ/work100",
      publication_timestamp: "2022-01-10 14:00:00",
      publication_start_date: "2022-01-10",
      short_title: "Older monetary paper",
      authors: [{ id: 1, name: "Older Author" }],
      topics: ["Monetary policy"],
      jel_codes: ["E52"],
    },
    "/publ/work1323": {
      path: "/publ/work1323",
      publication_timestamp: "2026-01-20 14:00:00",
      publication_start_date: "2026-01-20",
      short_title: "Banks and capital requirements: evidence from countercyclical buffers",
    },
    "/publ/work900": {
      path: "/publ/work900",
      publication_timestamp: "2024-06-05 14:00:00",
      publication_start_date: "2024-06-05",
      short_title: "Middle financial paper",
      authors: [
        { id: 2, name: "Alice Economist" },
        { id: 3, name: "Bob Researcher" },
      ],
      topics: ["Financial stability", "Banking"],
      jel_codes: ["G21", "G28"],
    },
    malformed: {
      publication_start_date: "2027-01-01",
      short_title: "Missing path",
    },
  },
});

const researchHubFixture = JSON.stringify({
  old: {
    id: 10,
    title: "Inflation persistence",
    issue: "WP-10",
    primary_href: "https://alpha.example/papers/wp10.pdf",
    publication_date: "2023-04",
    series: {
      name: "Alpha Bank Working Papers",
      institution: "Alpha Central Bank",
      country: "Alphaland",
    },
    authors: ["Ana García"],
    jel_codes: ["E31"],
  },
  newest: {
    id: 12,
    title: "Monetary policy and bank lending",
    issue: "WP-12",
    primary_href: "https://beta.example/papers/wp12.pdf",
    publication_date: "2026-02-14",
    abstract: "Evidence on credit transmission.",
    series: {
      name: "Beta Research Series",
      institution: "Beta Reserve Bank",
      country: "Betania",
    },
    authors: ["Alice Economist", "Béla Author"],
    jel_codes: ["E52", "G21"],
  },
  middle: {
    id: 11,
    title: "Payments without complete institution metadata",
    issue: "11",
    primary_href: "https://unknown.example/paper/11",
    publication_date: "2025-01-02",
    series: { name: "Payments Papers" },
    authors: ["Casey Scholar"],
  },
  malformed: {
    id: 13,
    title: "Missing full text link",
    publication_date: "2026-03-01",
  },
});

const rssMetadataFixture = `<?xml version="1.0"?>
<rdf:RDF xmlns="http://purl.org/rss/1.0/"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:cb="http://www.cbwiki.net/wiki/index.php/Specification_1.1">
  <item rdf:about="https://future.example/wp99.pdf">
    <title>Future-dated liquidity paper</title>
    <link>https://future.example/wp99.pdf</link>
    <dc:date>2099-09-01T00:00:00Z</dc:date>
    <dcterms:abstract>An abstract &amp; preserved detail.</dcterms:abstract>
    <cb:paper>
      <cb:simpleTitle>Future-dated liquidity paper</cb:simpleTitle>
      <cb:institutionAbbrev>FCB</cb:institutionAbbrev>
      <cb:country>Freedonia</cb:country>
      <cb:resource><cb:title>Full text</cb:title><cb:link>https://future.example/wp99.pdf</cb:link></cb:resource>
      <cb:person type="author"><cb:nameAsWritten>Alice Author</cb:nameAsWritten></cb:person>
      <cb:person type="author"><cb:nameAsWritten>Bob Author</cb:nameAsWritten></cb:person>
      <cb:publicationDate>2099-09</cb:publicationDate>
      <cb:publication>Future Central Bank Working Papers</cb:publication>
      <cb:issue>WP-99</cb:issue>
      <cb:JELCode>E52</cb:JELCode>
      <cb:JELCode>G21</cb:JELCode>
    </cb:paper>
  </item>
  <item rdf:about="https://normal.example/wp20.pdf">
    <dc:title>Normal research paper</dc:title>
    <link>https://normal.example/wp20.pdf</link>
    <dc:date>2025-03-04T00:00:00Z</dc:date>
    <dcterms:abstract>Normal abstract.</dcterms:abstract>
    <cb:paper>
      <cb:resource><cb:title>Full text</cb:title><cb:link>https://normal.example/wp20.pdf</cb:link></cb:resource>
      <cb:person type="author"><cb:nameAsWritten>Carol Author</cb:nameAsWritten></cb:person>
      <cb:publication>Normal Bank Papers</cb:publication>
      <cb:JELCode>C22</cb:JELCode>
    </cb:paper>
  </item>
</rdf:RDF>`;

test("BIS machine endpoint constants use the official URLs", () => {
  expect(BIS_WORKING_PAPERS_URL).toBe("https://www.bis.org/api/document_lists/wppubls.json");
  expect(BIS_RESEARCH_HUB_URL).toBe("https://www.bis.org/api/reshub_papers.json");
  expect(BIS_RESEARCH_HUB_RSS_URL).toBe("https://www.bis.org/doclist/reshub_papers.rss");
});

test("working-paper snapshots sort parsed dates instead of trusting object order", () => {
  const papers = parseBisWorkingPapers(workingPapersFixture);

  expect(papers.map((paper) => paper.research.issue)).toEqual(["1323", "900", "100"]);
  expect(papers[1]).toMatchObject({
    provider: "bis-research",
    kind: "analysis",
    title: "Middle financial paper",
    url: "https://www.bis.org/publ/work900.htm",
    canonicalUrl: "https://www.bis.org/publ/work900.htm",
    publishedAt: "2024-06-05T00:00:00.000Z",
    publishedAtText: "2024-06-05",
    tags: ["Financial stability", "Banking"],
    research: {
      authors: ["Alice Economist", "Bob Researcher"],
      institution: "Bank for International Settlements",
      country: "Switzerland",
      series: "BIS Working Papers",
      issue: "900",
      jelCodes: ["G21", "G28"],
      categories: ["Financial stability", "Banking"],
      externalId: "/publ/work900",
      pdfUrl: "https://www.bis.org/publ/work900.pdf",
    },
  });
});

test("working-paper parsing keeps withdrawn or missing-metadata records safe", () => {
  const papers = parseBisWorkingPapers(workingPapersFixture, 1);

  expect(papers).toHaveLength(1);
  expect(papers[0]).toMatchObject({
    title: "Banks and capital requirements: evidence from countercyclical buffers",
    url: "https://www.bis.org/publ/work1323.htm",
    research: {
      issue: "1323",
      externalId: "/publ/work1323",
      pdfUrl: "https://www.bis.org/publ/work1323.pdf",
    },
  });
  expect(papers[0]?.research.authors).toBeUndefined();
  expect(papers[0]?.research.jelCodes).toBeUndefined();
});

test("research-hub snapshots retain native metadata and apply filters before limits", () => {
  const all = parseBisResearchHub(researchHubFixture);
  expect(all.map((paper) => paper.research.externalId)).toEqual(["12", "11", "10"]);
  expect(all[0]).toMatchObject({
    provider: "bis-research-hub",
    title: "Monetary policy and bank lending",
    source: "Beta Reserve Bank",
    publishedAt: "2026-02-14T00:00:00.000Z",
    summary: "Evidence on credit transmission.",
    research: {
      institution: "Beta Reserve Bank",
      country: "Betania",
      series: "Beta Research Series",
      issue: "WP-12",
      authors: ["Alice Economist", "Béla Author"],
      jelCodes: ["E52", "G21"],
      externalId: "12",
      pdfUrl: "https://beta.example/papers/wp12.pdf",
    },
  });

  expect(
    parseBisResearchHub(researchHubFixture, {
      institutions: ["alpha central bank", "BETA RESERVE BANK"],
      query: "alice policy E52",
      limit: 1,
    }).map((paper) => paper.research.externalId),
  ).toEqual(["12"]);
  expect(parseBisResearchHub(researchHubFixture, { institutions: ["Missing Bank"] })).toEqual([]);
  expect(parseBisResearchHub(researchHubFixture, { query: "casey payments" })).toHaveLength(1);
});

test("preserves reduced BIS date text without inventing a day-level instant", () => {
  const [yearPrecision] = parseBisWorkingPapers(
    JSON.stringify({
      list: [
        {
          path: "/publ/work77",
          short_title: "Annual publication date",
          publication_start_date: "2024",
        },
      ],
    }),
  );
  expect(yearPrecision).toMatchObject({ publishedAtText: "2024" });
  expect(yearPrecision?.publishedAt).toBeUndefined();

  const [monthPrecision] = parseBisResearchHub(
    JSON.stringify({
      paper: {
        id: 78,
        title: "Monthly publication date",
        primary_href: "https://example.test/work78",
        publication_date: "2024-06",
      },
    }),
  );
  expect(monthPrecision).toMatchObject({ publishedAtText: "2024-06" });
  expect(monthPrecision?.publishedAt).toBeUndefined();
});

test("distinguishes empty BIS snapshots from invalid endpoint schemas", () => {
  expect(parseBisWorkingPapers(JSON.stringify({ list: [] }))).toEqual([]);
  expect(parseBisWorkingPapers(JSON.stringify({ list: {} }))).toEqual([]);
  expect(parseBisResearchHub(JSON.stringify({}))).toEqual([]);

  expect(() => parseBisWorkingPapers(JSON.stringify({}))).toThrow(
    "unexpected BIS Working Papers response shape",
  );
  expect(() => parseBisWorkingPapers(JSON.stringify({ list: "not-a-snapshot" }))).toThrow(
    "unexpected BIS Working Papers response shape",
  );
  expect(() =>
    parseBisWorkingPapers(JSON.stringify({ list: [{ short_title: "Missing path" }] })),
  ).toThrow("BIS Working Papers response contained no valid records");

  expect(() => parseBisResearchHub(JSON.stringify([]))).toThrow(
    "unexpected BIS Central Bank Research Hub response shape",
  );
  expect(() => parseBisResearchHub(JSON.stringify({ metadata: "not-a-paper" }))).toThrow(
    "BIS Central Bank Research Hub response contained no valid records",
  );
});

test("BIS snapshot parsers reject record counts above the bounded maximum", () => {
  const oversizedSnapshot: Record<string, null> = {};
  for (let index = 0; index <= 100_000; index += 1) {
    oversizedSnapshot[`r${index}`] = null;
  }
  const oversizedBody = JSON.stringify(oversizedSnapshot);

  expect(() => parseBisResearchHub(oversizedBody)).toThrow(
    "BIS Central Bank Research Hub response exceeded record limit",
  );
  expect(() => parseBisWorkingPapers(`{"list":${oversizedBody}}`)).toThrow(
    "BIS Working Papers response exceeded record limit",
  );
});

test("recent Research Hub RSS validates the complete feed envelope before scanning items", () => {
  expect(parseBisResearchHubRecent('<rss version="2.0"><channel /></rss>')).toEqual([]);

  expect(() =>
    parseBisResearchHubRecent(
      "<html><item><title>Not a feed</title><link>https://example.test/paper</link></item></html>",
    ),
  ).toThrow("BIS Research Hub: invalid RSS feed response");
  expect(() => parseBisResearchHubRecent("<rdf:RDF><item>")).toThrow(
    "BIS Research Hub: invalid RSS feed response",
  );
  expect(() =>
    parseBisResearchHubRecent(
      `<rdf:RDF xmlns:rdf="rdf">
        <item>
          <title>Complete paper</title>
          <link>https://example.test/complete.pdf</link>
        </item>
        <item><title>Truncated paper`,
    ),
  ).toThrow("BIS Research Hub: invalid RSS feed response");
});

test("recent Research Hub RSS distinguishes malformed items from filtered valid items", () => {
  expect(() =>
    parseBisResearchHubRecent(
      "<rss><channel><item><title>Missing link</title></item></channel></rss>",
    ),
  ).toThrow("BIS Research Hub RSS response contained no valid records");

  const validFeed =
    "<rss><channel><item><title>Valid paper</title><link>https://example.test/valid.pdf</link></item></channel></rss>";
  expect(parseBisResearchHubRecent(validFeed, { institutions: ["Missing Bank"] })).toEqual([]);
});

test("recent Research Hub RSS captures namespace metadata and rejects future normalization", () => {
  const papers = parseBisResearchHubRecent(rssMetadataFixture);

  expect(papers).toHaveLength(2);
  expect(papers[0]).toMatchObject({
    provider: "bis-research-hub",
    kind: "analysis",
    title: "Future-dated liquidity paper",
    url: "https://future.example/wp99.pdf",
    canonicalUrl: "https://future.example/wp99.pdf",
    source: "FCB",
    publishedAtText: "2099-09-01T00:00:00Z",
    summary: "An abstract & preserved detail.",
    research: {
      authors: ["Alice Author", "Bob Author"],
      institution: "FCB",
      country: "Freedonia",
      series: "Future Central Bank Working Papers",
      issue: "WP-99",
      jelCodes: ["E52", "G21"],
      pdfUrl: "https://future.example/wp99.pdf",
    },
  });
  expect(papers[0]?.publishedAt).toBeUndefined();
  expect(papers[1]?.publishedAt).toBe("2025-03-04T00:00:00.000Z");
});

test("recent Research Hub RSS deduplicates URL variants by metadata identity", () => {
  const xml = `<rdf:RDF xmlns:rdf="rdf" xmlns:dc="dc" xmlns:cb="cb">
    <item rdf:about="https://bank.example/wp17.pdf">
      <title>Capital buffers</title><link>https://bank.example/wp17.pdf</link>
      <dc:date>2026-01-02</dc:date><cb:paper>
        <cb:institutionAbbrev>CB</cb:institutionAbbrev>
        <cb:resource><cb:link>https://bank.example/wp17.pdf</cb:link></cb:resource>
        <cb:person type="author"><cb:nameAsWritten>Alex One</cb:nameAsWritten></cb:person>
        <cb:publication>Central Bank Papers</cb:publication><cb:issue>17</cb:issue>
      </cb:paper>
    </item>
    <item rdf:about="https://bank.example/download?id=17">
      <title>Capital buffers, revised URL</title><link>https://bank.example/download?id=17</link>
      <dc:date>2026-01-02</dc:date><cb:paper>
        <cb:institutionAbbrev>CB</cb:institutionAbbrev>
        <cb:resource><cb:link>https://bank.example/download?id=17</cb:link></cb:resource>
        <cb:person type="author"><cb:nameAsWritten>Alex One</cb:nameAsWritten></cb:person>
        <cb:publication>Central Bank Papers</cb:publication><cb:issue>17</cb:issue>
      </cb:paper>
    </item>
    <item rdf:about="https://other.example/a.pdf">
      <title>Fallback identity</title><link>https://other.example/a.pdf</link>
      <dc:date>2026-01-03</dc:date><cb:paper>
        <cb:resource><cb:link>https://other.example/a.pdf</cb:link></cb:resource>
        <cb:person type="author"><cb:nameAsWritten>Jamie Two</cb:nameAsWritten></cb:person>
      </cb:paper>
    </item>
    <item rdf:about="https://other.example/b.pdf">
      <title>Fallback identity</title><link>https://other.example/b.pdf</link>
      <dc:date>2026-01-03</dc:date><cb:paper>
        <cb:resource><cb:link>https://other.example/b.pdf</cb:link></cb:resource>
        <cb:person type="author"><cb:nameAsWritten>Jamie Two</cb:nameAsWritten></cb:person>
      </cb:paper>
    </item>
  </rdf:RDF>`;

  const papers = parseBisResearchHubRecent(xml);
  expect(papers).toHaveLength(2);
  expect(papers.map((paper) => paper.url)).toEqual([
    "https://bank.example/wp17.pdf",
    "https://other.example/a.pdf",
  ]);
});

test("BIS fetch wrappers use injected fetch and post-parse filtering", async () => {
  const requested: string[] = [];
  const injectedFetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (url === BIS_WORKING_PAPERS_URL) return new Response(workingPapersFixture);
    if (url === BIS_RESEARCH_HUB_URL) return new Response(researchHubFixture);
    if (url === BIS_RESEARCH_HUB_RSS_URL) return new Response(rssMetadataFixture);
    return new Response("missing", { status: 404 });
  };

  const [working, snapshot, recent] = await Promise.all([
    fetchBisWorkingPapers({ fetch: injectedFetch, limit: 2 }),
    fetchBisResearchHub({
      fetch: injectedFetch,
      institutions: ["Beta Reserve Bank"],
      query: "credit transmission",
      limit: 1,
    }),
    fetchBisResearchHubRecent({ fetch: injectedFetch, query: "normal C22", limit: 1 }),
  ]);

  expect(working).toHaveLength(2);
  expect(snapshot.map((paper) => paper.research.externalId)).toEqual(["12"]);
  expect(recent.map((paper) => paper.title)).toEqual(["Normal research paper"]);
  expect(requested.toSorted()).toEqual(
    [BIS_WORKING_PAPERS_URL, BIS_RESEARCH_HUB_URL, BIS_RESEARCH_HUB_RSS_URL].toSorted(),
  );
});

test("zero limits return without invoking fetch", async () => {
  let calls = 0;
  const injectedFetch = async (): Promise<Response> => {
    calls += 1;
    return new Response("unexpected");
  };

  expect(await fetchBisWorkingPapers({ fetch: injectedFetch, limit: 0 })).toEqual([]);
  expect(await fetchBisResearchHub({ fetch: injectedFetch, limit: 0 })).toEqual([]);
  expect(await fetchBisResearchHubRecent({ fetch: injectedFetch, limit: 0 })).toEqual([]);
  expect(parseBisWorkingPapers("not json", 0)).toEqual([]);
  expect(parseBisResearchHub("not json", { limit: 0 })).toEqual([]);
  expect(parseBisResearchHubRecent("not xml", { limit: 0 })).toEqual([]);
  expect(calls).toBe(0);
});

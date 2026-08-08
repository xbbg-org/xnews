import { expect, test } from "bun:test";
import {
  ARXIV_MIN_REQUEST_INTERVAL_MS,
  arxivCategoryFeedUrl,
  arxivSearchUrl,
  fetchArxivAnnouncements,
  fetchArxivPapers,
  parseArxivPapers,
} from "../src/sources/arxiv.js";

const searchAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://export.arxiv.org/abs/2401.01234v02</id>
    <updated>2025-02-03T10:20:30Z</updated>
    <published>2024-01-02T03:04:05Z</published>
    <title>Learning &amp; Monetary Policy</title>
    <summary>A paper about learning &amp; policy.</summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Irving Fisher</name></author>
    <link href="http://arxiv.org/abs/2401.01234v2" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" rel="related" type="application/pdf" />
    <category term="econ.EM" scheme="http://arxiv.org/schemas/atom" />
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom" />
    <arxiv:primary_category term="cs.LG" scheme="http://arxiv.org/schemas/atom" />
    <arxiv:doi>https://doi.org/10.1234/example.5</arxiv:doi>
    <arxiv:license>http://creativecommons.org/licenses/by/4.0/</arxiv:license>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-ex/0307015</id>
    <updated>2007-06-25T17:09:59-04:00</updated>
    <published>2003-07-01T12:00:00Z</published>
    <title>Legacy Identifier Paper</title>
    <summary>Legacy abstract.</summary>
    <author><name>H1 Collaboration</name></author>
    <link href="http://arxiv.org/abs/hep-ex/0307015v1" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/hep-ex/0307015v1" rel="related" type="application/pdf" />
    <category term="hep-ex" />
    <arxiv:primary_category term="hep-ex" />
  </entry>
</feed>`;

const announcementAtom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <entry>
    <id>oai:arXiv.org:2203.01250v3</id>
    <title>Mass concentration</title>
    <updated>2024-08-23T16:08:30Z</updated>
    <published>2024-08-23T00:00:00-04:00</published>
    <link href="https://arxiv.org/abs/2203.01250" rel="alternate" type="text/html" />
    <summary>arXiv:2203.01250v3 Announce Type: replace-cross
Abstract: The announcement abstract.</summary>
    <category term="math.AP" />
    <category term="math.OC" />
    <arxiv:announce_type>replace-cross</arxiv:announce_type>
    <dc:rights>http://creativecommons.org/licenses/by/4.0/</dc:rights>
    <dc:creator>Antonin Monteil, Paul Pegon</dc:creator>
  </entry>
  <entry>
    <id>oai:arXiv.org:2203.01250v3</id>
    <title>Mass concentration (cross-list duplicate)</title>
    <updated>2024-08-23T16:08:31Z</updated>
    <published>2024-08-23T00:00:00-04:00</published>
    <link href="https://arxiv.org/abs/2203.01250" rel="alternate" />
    <summary>arXiv:2203.01250v3 Announce Type: cross
Abstract: Duplicate listing.</summary>
    <category term="math.OC" />
    <arxiv:announce_type>cross</arxiv:announce_type>
  </entry>
</feed>`;

const announcementRss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>Inflation expectations</title>
      <link>https://arxiv.org/abs/2501.12345</link>
      <description>arXiv:2501.12345v1 Announce Type: new
Abstract: Expectations remain anchored.</description>
      <guid isPermaLink="false">oai:arXiv.org:2501.12345v1</guid>
      <category>econ.EM</category>
      <category>q-fin.EC</category>
      <pubDate>Fri, 10 Jan 2025 00:00:00 -0500</pubDate>
      <arxiv:announce_type>new</arxiv:announce_type>
      <arxiv:DOI>10.5555/inflation</arxiv:DOI>
      <dc:rights>https://creativecommons.org/licenses/by/4.0/</dc:rights>
      <dc:creator>Jane Doe, John Roe</dc:creator>
    </item>
  </channel>
</rss>`;

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test("builds encoded official arXiv category and legacy search URLs", () => {
  expect(arxivCategoryFeedUrl(["cs.AI", "stat.ML"])).toBe(
    "https://rss.arxiv.org/atom/cs.AI+stat.ML",
  );
  expect(arxivCategoryFeedUrl(["econ.EM", "category/with slash"], "rss")).toBe(
    "https://rss.arxiv.org/rss/econ.EM+category%2Fwith%20slash",
  );

  const url = new URL(
    arxivSearchUrl('ti:"monetary policy" AND cat:q-fin.EC', {
      start: 20,
      limit: 25,
      sortBy: "lastUpdatedDate",
      sortOrder: "descending",
    }),
  );
  expect(url.origin + url.pathname).toBe("https://export.arxiv.org/api/query");
  expect(url.searchParams.get("search_query")).toBe('ti:"monetary policy" AND cat:q-fin.EC');
  expect(url.searchParams.get("start")).toBe("20");
  expect(url.searchParams.get("max_results")).toBe("25");
  expect(url.searchParams.get("sortBy")).toBe("lastUpdatedDate");
  expect(url.searchParams.get("sortOrder")).toBe("descending");
});

test("parses new and legacy Atom search IDs and paper metadata", () => {
  const papers = parseArxivPapers(searchAtom);

  expect(papers).toHaveLength(2);
  expect(papers[0]).toMatchObject({
    id: "arxiv|2401.01234v2",
    provider: "arxiv",
    kind: "analysis",
    title: "Learning & Monetary Policy",
    url: "https://arxiv.org/abs/2401.01234v2",
    publishedAt: "2024-01-02T03:04:05.000Z",
    summary: "A paper about learning & policy.",
    research: {
      authors: ["Ada Lovelace", "Irving Fisher"],
      categories: ["cs.LG", "econ.EM"],
      externalId: "2401.01234",
      version: "2",
      doi: "10.1234/example.5",
      submittedAt: "2024-01-02T03:04:05.000Z",
      updatedAt: "2025-02-03T10:20:30.000Z",
      pdfUrl: "https://arxiv.org/pdf/2401.01234v2",
      licenseUrl: "http://creativecommons.org/licenses/by/4.0/",
    },
  });
  expect(papers[1]).toMatchObject({
    id: "arxiv|hep-ex/0307015v1",
    url: "https://arxiv.org/abs/hep-ex/0307015v1",
    research: {
      externalId: "hep-ex/0307015",
      version: "1",
      authors: ["H1 Collaboration"],
      categories: ["hep-ex"],
    },
  });
});

test("skips malformed records without discarding valid papers", () => {
  const withMalformedEntry = searchAtom.replace(
    "<entry>",
    "<entry><title>Missing identifier</title></entry><entry>",
  );
  expect(parseArxivPapers(withMalformedEntry)).toHaveLength(2);
});

test("rejects feeds where every candidate is invalid while preserving empty feeds", () => {
  expect(() =>
    parseArxivPapers(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><title>Missing identifier</title></entry>
        <entry><id>https://arxiv.org/abs/2501.12345</id></entry>
      </feed>`,
    ),
  ).toThrow("arxiv: feed contained no valid papers");
  expect(parseArxivPapers(`<feed xmlns="http://www.w3.org/2005/Atom"></feed>`)).toEqual([]);
});

test("ignores alternate and PDF links for a conflicting arXiv identifier", () => {
  const papers = parseArxivPapers(
    `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>https://arxiv.org/abs/2501.12345v2</id>
        <title>Canonical identity wins</title>
        <link rel="alternate" href="https://arxiv.org/abs/2401.99999v7" />
        <link title="pdf" type="application/pdf" href="https://arxiv.org/pdf/2401.99999v7" />
      </entry>
    </feed>`,
  );

  expect(papers[0]).toMatchObject({
    url: "https://arxiv.org/abs/2501.12345v2",
    research: {
      externalId: "2501.12345",
      version: "2",
      pdfUrl: "https://arxiv.org/pdf/2501.12345v2",
    },
  });
});

test("uses announcement time instead of Atom generation time and dedupes cross-lists", () => {
  const papers = parseArxivPapers(announcementAtom);

  expect(papers).toHaveLength(1);
  expect(papers[0]).toMatchObject({
    url: "https://arxiv.org/abs/2203.01250",
    publishedAt: "2024-08-23T04:00:00.000Z",
    publishedAtText: "2024-08-23T00:00:00-04:00",
    summary: "The announcement abstract.",
    research: {
      authors: ["Antonin Monteil", "Paul Pegon"],
      categories: ["math.AP", "math.OC"],
      externalId: "2203.01250",
      version: "3",
      announcedAt: "2024-08-23T04:00:00.000Z",
      announceType: "replace-cross",
      pdfUrl: "https://arxiv.org/pdf/2203.01250v3",
    },
  });
  expect(papers[0]?.research).not.toHaveProperty("submittedAt");
  expect(papers[0]?.research).not.toHaveProperty("updatedAt");
});

test("parses RSS announcement creators, categories, DOI, and dates", () => {
  const papers = parseArxivPapers(announcementRss);

  expect(papers).toHaveLength(1);
  expect(papers[0]).toMatchObject({
    url: "https://arxiv.org/abs/2501.12345",
    publishedAt: "2025-01-10T05:00:00.000Z",
    summary: "Expectations remain anchored.",
    research: {
      authors: ["Jane Doe", "John Roe"],
      categories: ["econ.EM", "q-fin.EC"],
      externalId: "2501.12345",
      version: "1",
      doi: "10.5555/inflation",
      announcedAt: "2025-01-10T05:00:00.000Z",
      announceType: "new",
    },
  });
});

test("fetch adapters use injected fetch, official URLs, and a descriptive user agent", async () => {
  const requests: Array<{ readonly url: string; readonly userAgent: string }> = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = inputUrl(input);
    requests.push({
      url,
      userAgent: new Headers(init?.headers).get("user-agent") ?? "",
    });
    return new Response(url.includes("export.arxiv.org") ? searchAtom : announcementRss);
  };

  const searchResults = await fetchArxivPapers("all:inflation expectations", {
    fetch,
    start: 5,
    limit: 1,
  });
  const announcementResults = await fetchArxivAnnouncements(["econ.EM", "q-fin.EC"], {
    fetch,
    format: "rss",
  });

  expect(searchResults).toHaveLength(1);
  expect(announcementResults).toHaveLength(1);
  expect(requests[0]?.url).toContain(
    "https://export.arxiv.org/api/query?search_query=all%3Ainflation+expectations&start=5&max_results=1",
  );
  expect(requests[1]?.url).toBe("https://rss.arxiv.org/rss/econ.EM+q-fin.EC");
  expect(requests.every((request) => request.userAgent.includes("@xbbg/xnews arXiv adapter"))).toBe(
    true,
  );
  expect(ARXIV_MIN_REQUEST_INTERVAL_MS).toBe(3_000);
});

test("zero limits return without invoking fetch", async () => {
  let calls = 0;
  const fetch = async (): Promise<Response> => {
    calls += 1;
    return new Response(searchAtom);
  };

  expect(await fetchArxivPapers("all:inflation", { fetch, limit: 0 })).toEqual([]);
  expect(await fetchArxivAnnouncements("econ.EM", { fetch, limit: 0 })).toEqual([]);
  expect(calls).toBe(0);
});

import { expect, test } from "bun:test";
import { parseFixedFeedNews } from "../src/sources/fixedfeeds.js";
import { decodeEntities } from "../src/text.js";
import type { NewsItem, NewsProvider, ResearchPaper } from "../src/types.js";
import {
  matchXmlBlocks,
  parseAtomEntries,
  parseRssItems,
  readXmlAttribute,
  readXmlTag,
  readXmlTags,
} from "../src/xml.js";

test("RSS 1.0 items use namespaced dates after pubDate", () => {
  const items = parseRssItems(
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <item rdf:about="https://example.com/dc-date">
        <title>DC dated paper</title>
        <link>https://example.com/dc-date</link>
        <dc:date>2026-08-07T15:30:00+02:00</dc:date>
      </item>
      <item rdf:about="https://example.com/pub-date">
        <title>pubDate takes precedence</title>
        <link>https://example.com/pub-date</link>
        <pubDate>Fri, 07 Aug 2026 13:30:00 GMT</pubDate>
        <dc:date>2025-01-01T00:00:00Z</dc:date>
      </item>
    </rdf:RDF>`,
    { provider: "bis-research", kind: "analysis", sourceFallback: "BIS" },
  );

  expect(items).toHaveLength(2);
  expect(items[0]).toMatchObject({
    title: "DC dated paper",
    publishedAt: "2026-08-07T13:30:00.000Z",
    publishedAtText: "2026-08-07T15:30:00+02:00",
  });
  expect(items[1]).toMatchObject({
    title: "pubDate takes precedence",
    publishedAt: "2026-08-07T13:30:00.000Z",
    publishedAtText: "Fri, 07 Aug 2026 13:30:00 GMT",
  });
});

test("RSS link selection skips namespaced self-closing links", () => {
  const items = parseRssItems(
    `<rss xmlns:atom="http://www.w3.org/2005/Atom"><channel><item>
      <title>Policy rate decision</title>
      <atom:link href="https://example.com/alternate" />
      <link>https://example.com/policy-rate</link>
    </item></channel></rss>`,
    { provider: "norges-bank-news", sourceFallback: "Norges Bank" },
  );

  expect(items).toHaveLength(1);
  expect(items[0]?.url).toBe("https://example.com/policy-rate");
});

test("RSS and Atom parsers reject wrong or truncated envelopes but accept empty feeds", () => {
  const reflectedSecret = "api_key=reflected-secret";
  expect(() =>
    parseRssItems(`<html><body>${reflectedSecret}</body></html>`, {
      provider: "bing-news",
      sourceFallback: "Bing News",
    }),
  ).toThrow("bing-news: invalid RSS feed response");
  expect(() =>
    parseAtomEntries(
      `<feed><entry><title>Complete</title><link href="https://example.com/complete" /></entry>` +
        `<entry><title>${reflectedSecret}</title>`,
      { provider: "arxiv", sourceFallback: "arXiv" },
    ),
  ).toThrow("arxiv: invalid Atom feed response");

  try {
    parseAtomEntries(`<feed><entry><title>${reflectedSecret}</title>`, {
      provider: "arxiv",
      sourceFallback: "arXiv",
    });
    throw new Error("expected truncated Atom feed to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error("expected truncated Atom feed rejection to throw an Error", { cause: error });
    }
    expect(error.message).not.toContain(reflectedSecret);
  }

  expect(
    parseRssItems("<rss><channel></channel></rss>", {
      provider: "bing-news",
      sourceFallback: "Bing News",
    }),
  ).toEqual([]);
  expect(
    parseAtomEntries("<feed></feed>", {
      provider: "arxiv",
      sourceFallback: "arXiv",
    }),
  ).toEqual([]);
});

test("shared RSS parsing distinguishes malformed, mixed, filtered, and empty feeds", () => {
  expect(() =>
    parseRssItems(
      `<rss><channel>
        <item><title>Missing link</title></item>
        <item><link>https://example.com/missing-title</link></item>
      </channel></rss>`,
      { provider: "marketwatch", sourceFallback: "MarketWatch" },
    ),
  ).toThrow("marketwatch: RSS response contained no valid records");

  expect(
    parseRssItems(
      `<rss><channel>
        <item><title>Missing link</title></item>
        <item><title>Valid item</title><link>https://example.com/valid-rss</link></item>
      </channel></rss>`,
      { provider: "marketwatch", sourceFallback: "MarketWatch" },
    ),
  ).toEqual([
    expect.objectContaining({
      title: "Valid item",
      url: "https://example.com/valid-rss",
    }),
  ]);

  expect(
    parseFixedFeedNews(
      "marketwatch",
      `<rss><channel>
        <item><title>Valid but filtered item</title><link>https://example.com/filtered-rss</link></item>
      </channel></rss>`,
      { query: "ZXQWVUNMATCHED" },
    ),
  ).toEqual([]);
  expect(
    parseRssItems("<rss><channel></channel></rss>", {
      provider: "marketwatch",
      sourceFallback: "MarketWatch",
    }),
  ).toEqual([]);
});

test("shared Atom parsing distinguishes malformed, mixed, filtered, and empty feeds", () => {
  expect(() =>
    parseAtomEntries(
      `<feed>
        <entry><title>Missing link</title></entry>
        <entry><link href="https://example.com/missing-title" /></entry>
      </feed>`,
      { provider: "bcb-news", sourceFallback: "Banco Central do Brasil" },
    ),
  ).toThrow("bcb-news: Atom response contained no valid records");

  expect(
    parseAtomEntries(
      `<feed>
        <entry><title>Missing link</title></entry>
        <entry><title>Valid entry</title><link href="https://example.com/valid-atom" /></entry>
      </feed>`,
      { provider: "bcb-news", sourceFallback: "Banco Central do Brasil" },
    ),
  ).toEqual([
    expect.objectContaining({
      title: "Valid entry",
      url: "https://example.com/valid-atom",
    }),
  ]);

  expect(
    parseFixedFeedNews(
      "bcb-news",
      `<feed>
        <entry><title>Valid but filtered entry</title><link href="https://example.com/filtered-atom" /></entry>
      </feed>`,
      { query: "ZXQWVUNMATCHED" },
    ),
  ).toEqual([]);
  expect(
    parseAtomEntries("<feed></feed>", {
      provider: "bcb-news",
      sourceFallback: "Banco Central do Brasil",
    }),
  ).toEqual([]);
});

test("XML envelopes reject excessive nesting but accept normal nested feeds", () => {
  const deeplyNestedFeed = `<feed>${"<group>".repeat(256)}${"</group>".repeat(256)}</feed>`;
  expect(() =>
    parseAtomEntries(deeplyNestedFeed, {
      provider: "arxiv",
      sourceFallback: "arXiv",
    }),
  ).toThrow("arxiv: invalid Atom feed response");

  expect(
    parseAtomEntries(
      `<feed><group><entry><title>Nested paper</title><link href="https://example.com/nested" /></entry></group></feed>`,
      { provider: "arxiv", sourceFallback: "arXiv" },
    ),
  ).toEqual([
    expect.objectContaining({
      provider: "arxiv",
      title: "Nested paper",
      url: "https://example.com/nested",
    }),
  ]);
});

test("Atom publication dates prefer published and invalid numeric entities never throw", () => {
  const items = parseAtomEntries(
    `<feed>
      <entry>
        <title>Publication precedence</title>
        <link href="https://example.com/paper" />
        <published>2024-01-02T03:04:05Z</published>
        <updated>2025-02-03T10:20:30Z</updated>
      </entry>
    </feed>`,
    { provider: "arxiv", sourceFallback: "arXiv" },
  );

  expect(items[0]).toMatchObject({
    publishedAt: "2024-01-02T03:04:05.000Z",
    publishedAtText: "2024-01-02T03:04:05Z",
  });
  expect(decodeEntities("&#x110000; &#xD800; &#99999999;")).toBe("&#x110000; &#xD800; &#99999999;");
});

test("malformed repeated opening tags do not produce partial XML blocks", () => {
  const repeated = "<entry>".repeat(100_000);
  expect([...matchXmlBlocks(`${repeated}</entry>`, "entry")]).toEqual([]);
});

test("XML helpers match local names, repeated tags, and attributes", () => {
  const xml = `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
    <atom:entry>
      <atom:title><![CDATA[Namespaced paper]]></atom:title>
      <atom:author><atom:name>Ada Lovelace</atom:name></atom:author>
      <author><name>Grace Hopper</name></author>
      <atom:link rel="alternate" href="https://example.com/paper" />
      <category term="economics" />
    </atom:entry>
  </atom:feed>`;
  const blocks = [...matchXmlBlocks(xml, "entry")];
  const authors = readXmlTags(blocks[0] ?? "", "author").map((author) =>
    readXmlTag(author, "name"),
  );

  expect(blocks).toHaveLength(1);
  expect(readXmlTag(blocks[0] ?? "", "title")).toBe("Namespaced paper");
  expect(authors).toEqual(["Ada Lovelace", "Grace Hopper"]);
  expect(readXmlAttribute(blocks[0] ?? "", "link", "href")).toBe("https://example.com/paper");
  expect(readXmlAttribute(blocks[0] ?? "", "category", "term")).toBe("economics");
});

test("Atom parsing accepts namespace-prefixed entries, tags, and link attributes", () => {
  const items = parseAtomEntries(
    `<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
      <atom:entry>
        <atom:title>Namespaced Atom paper</atom:title>
        <atom:link rel="related" href="https://example.com/related" />
        <atom:link rel="alternate" href="https://example.com/paper" />
        <atom:updated>2026-08-08T12:00:00Z</atom:updated>
      </atom:entry>
    </atom:feed>`,
    { provider: "arxiv", kind: "analysis", sourceFallback: "arXiv" },
  );

  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    title: "Namespaced Atom paper",
    url: "https://example.com/paper",
    publishedAt: "2026-08-08T12:00:00.000Z",
  });
});

test("research paper types accept the contracted metadata and provider IDs", () => {
  const providers = [
    "arxiv",
    "openalex",
    "bis-research",
    "bis-research-hub",
    "bis-press",
    "bis-speeches",
  ] satisfies readonly NewsProvider[];
  const paper = {
    id: "paper:1",
    provider: "openalex",
    kind: "analysis",
    title: "A research paper",
    url: "https://example.com/paper",
    source: "OpenAlex",
    research: {
      authors: ["Ada Lovelace"],
      institution: "Analytical Engine Institute",
      country: "GB",
      series: "Working Papers",
      issue: "42",
      doi: "10.1234/example",
      jelCodes: ["E31"],
      categories: ["economics"],
      externalId: "W123",
      version: "v2",
      submittedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      announcedAt: "2026-08-03T00:00:00.000Z",
      announceType: "new",
      pdfUrl: "https://example.com/paper.pdf",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    },
  } satisfies ResearchPaper;
  const item: NewsItem = paper;

  expect(providers).toHaveLength(6);
  expect(item.research?.authors).toEqual(["Ada Lovelace"]);
});

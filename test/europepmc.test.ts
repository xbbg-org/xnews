import { expect, test } from "bun:test";
import {
  EUROPE_PMC_SEARCH_URL,
  europePmcSearchUrl,
  fetchEuropePmcPapers,
  parseEuropePmcPapers,
} from "../src/sources/europepmc.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const coreRecord = {
  id: "12345678",
  source: "MED",
  pmid: "12345678",
  doi: "https://doi.org/10.1234/Mixed.Case",
  title: "Monetary policy and health",
  authorString: "Ada Economist, Ben Researcher.",
  journalTitle: "Journal of Policy Medicine",
  issue: "4",
  journalVolume: "17",
  pubYear: "2026",
  firstPublicationDate: "2026-07-09",
  abstractText: "Policy effects &amp; growth.",
};

const liteRecord = {
  id: "PPR123",
  source: "PPR",
  title: "A lite preprint",
  authorString: "One Author.",
  pubYear: "2024",
};

function responseWith(results: readonly unknown[], metadata: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...metadata,
    resultList: { result: results },
  });
}

test("builds the default Europe PMC search URL", () => {
  expect(europePmcSearchUrl("inflation")).toBe(
    `${EUROPE_PMC_SEARCH_URL}?query=inflation&format=json`,
  );
});

test("builds a Europe PMC URL with every search option", () => {
  const query = "FIRST_PDATE:[2026-07-01 TO 2026-08-08] AND SRC:PPR";
  expect(
    europePmcSearchUrl(query, {
      pageSize: 1_000,
      cursorMark: "AoIIP+/=",
      resultType: "core",
      sort: "P_PDATE_D desc",
      synonym: false,
    }),
  ).toBe(
    `${EUROPE_PMC_SEARCH_URL}?query=FIRST_PDATE%3A%5B2026-07-01+TO+2026-08-08%5D+AND+SRC%3APPR&format=json&pageSize=1000&cursorMark=AoIIP%2B%2F%3D&resultType=core&sort=P_PDATE_D+desc&synonym=false`,
  );
});

test("passes fielded query text through untouched", () => {
  const query = "  FIRST_PDATE:[2026-07-01 TO 2026-08-08] AND SRC:PPR  ";
  const built = new URL(europePmcSearchUrl(query));

  expect(built.searchParams.get("query")).toBe(query);
});

test("rejects blank queries and page sizes outside 1 through 1000", () => {
  expect(() => europePmcSearchUrl(" \t ")).toThrow(TypeError);
  for (const pageSize of [0, 1.5, 1_001]) {
    expect(() => europePmcSearchUrl("inflation", { pageSize })).toThrow(RangeError);
  }

  expect(
    new URL(europePmcSearchUrl("inflation", { pageSize: 1 })).searchParams.get("pageSize"),
  ).toBe("1");
  expect(
    new URL(europePmcSearchUrl("inflation", { pageSize: 1_000 })).searchParams.get("pageSize"),
  ).toBe("1000");
});

test("parses a core record and page cursor metadata", () => {
  const page = parseEuropePmcPapers(
    responseWith([coreRecord], { hitCount: 87, nextCursorMark: "next+/=" }),
  );

  expect(page).toEqual({
    items: [
      {
        id: "europe-pmc|MED/12345678|Monetary policy and health",
        provider: "europe-pmc",
        kind: "analysis",
        title: "Monetary policy and health",
        url: "https://europepmc.org/article/MED/12345678",
        canonicalUrl: "https://doi.org/10.1234/mixed.case",
        source: "Journal of Policy Medicine",
        publishedAt: "2026-07-09T00:00:00.000Z",
        publishedAtText: "2026-07-09",
        summary: "Policy effects & growth.",
        research: {
          authors: ["Ada Economist", "Ben Researcher"],
          series: "Journal of Policy Medicine",
          issue: "4",
          doi: "10.1234/mixed.case",
          externalId: "MED/12345678",
        },
      },
    ],
    hitCount: 87,
    nextCursorMark: "next+/=",
  });
});

test("parses a lite record with publication-year text and optional page metadata absent", () => {
  expect(parseEuropePmcPapers(responseWith([liteRecord]))).toEqual({
    items: [
      {
        id: "europe-pmc|PPR/PPR123|A lite preprint",
        provider: "europe-pmc",
        kind: "analysis",
        title: "A lite preprint",
        url: "https://europepmc.org/article/PPR/PPR123",
        canonicalUrl: "https://europepmc.org/article/PPR/PPR123",
        source: "Europe PMC",
        publishedAtText: "2024",
        research: {
          authors: ["One Author"],
          externalId: "PPR/PPR123",
        },
      },
    ],
  });
});

test("skips invalid and duplicate Europe PMC records", () => {
  const page = parseEuropePmcPapers(
    responseWith([
      null,
      {},
      { id: "missing-source", title: "Invalid" },
      { source: "MED", id: "missing-title" },
      coreRecord,
      { ...coreRecord, title: "Duplicate external id" },
    ]),
  );

  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.research.externalId).toBe("MED/12345678");
  expect(page.items[0]?.title).toBe("Monetary policy and health");
});

test("throws when a Europe PMC response contains candidates but no valid records", () => {
  expect(() =>
    parseEuropePmcPapers(responseWith([null, {}, { source: "MED", id: "123", title: "   " }])),
  ).toThrow("Europe PMC response contained no valid records");
});

test("truncates at the limit and returns before parsing for limit zero", () => {
  const second = { ...liteRecord, id: "PPR456", title: "Second paper" };
  expect(parseEuropePmcPapers(responseWith([coreRecord, second]), 1).items).toEqual([
    expect.objectContaining({ title: "Monetary policy and health" }),
  ]);
  expect(parseEuropePmcPapers("not JSON", 0)).toEqual({ items: [] });
});

test("uses injected fetch, derives pageSize from limit, and sends a custom user-agent", async () => {
  let requestedUrl = "";
  const requestedUserAgents: (string | null)[] = [];
  const page = await fetchEuropePmcPapers("monetary policy", {
    limit: 2,
    cursorMark: "next+/=",
    resultType: "core",
    sort: "P_PDATE_D desc",
    synonym: true,
    userAgent: "europe-pmc-test/1.0 research@example.test",
    fetch: async (input, init) => {
      requestedUrl = inputUrl(input);
      requestedUserAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(responseWith([], { hitCount: 0 }));
    },
  });

  expect(requestedUrl).toBe(
    `${EUROPE_PMC_SEARCH_URL}?query=monetary+policy&format=json&pageSize=2&cursorMark=next%2B%2F%3D&resultType=core&sort=P_PDATE_D+desc&synonym=true`,
  );
  expect(requestedUserAgents).toEqual(["europe-pmc-test/1.0 research@example.test"]);
  expect(page).toEqual({ items: [], hitCount: 0 });
});

test("does not fetch when limit is zero", async () => {
  let calls = 0;
  const page = await fetchEuropePmcPapers("unused", {
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(responseWith([coreRecord]));
    },
  });

  expect(calls).toBe(0);
  expect(page).toEqual({ items: [] });
});

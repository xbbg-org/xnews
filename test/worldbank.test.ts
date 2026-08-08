import { expect, test } from "bun:test";
import {
  fetchWorldBankDocuments,
  parseWorldBankDocuments,
  WORLD_BANK_DOCUMENTS_API_URL,
  worldBankDocumentsUrl,
} from "../src/sources/worldbank.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const completeResponse = JSON.stringify({
  rows: 1,
  os: 0,
  page: 1,
  total: 1,
  documents: {
    facets: { docty: { count: 1 } },
    D40120973: {
      id: "40120973",
      last_modified_date: "2026-08-07T14:15:16Z",
      admreg: "Africa",
      authors: {
        "0": { author: " Ada Economist " },
        "1": { author: "Ben Researcher" },
        "2": { author: "Ada Economist" },
      },
      count: "Ethiopia",
      docna: { "0": { docna: " Inflation and economic growth\n" } },
      docty: "Policy Research Working Paper",
      docdt: "2026-08-06",
      abstracts: {
        "cdata!": " Inflation <b>falls</b> as productivity rises.\n",
      },
      doi: "https://doi.org/10.1234/Mixed.Case",
      pdfurl: "https://documents.worldbank.org/example/paper.pdf",
      url: "https://documents.worldbank.org/example/paper",
      guid: "https://documents.worldbank.org/curated/en/40120973",
      lang: "English",
    },
  },
});

test("builds the default World Bank Documents URL", () => {
  expect(WORLD_BANK_DOCUMENTS_API_URL).toBe("https://search.worldbank.org/api/v3/wds");
  expect(worldBankDocumentsUrl()).toBe("https://search.worldbank.org/api/v3/wds?format=json");
});

test("builds an encoded URL with every World Bank WDS filter", () => {
  expect(
    worldBankDocumentsUrl(" inflation & growth ", {
      docTypes: ["Policy Research Working Paper", "Economic Update"],
      languages: ["English", "French"],
      rows: 25,
      offset: 50,
      sortBy: "docdt",
      order: "desc",
      since: "2026-07-01",
      until: "2026-08-08",
      fields: ["id", "display_title", "docdt"],
      extraParams: { apilang: "English", custom: "a/b" },
    }),
  ).toBe(
    "https://search.worldbank.org/api/v3/wds?format=json&qterm=inflation+%26+growth&docty=Policy+Research+Working+Paper&docty=Economic+Update&lang_exact=English&lang_exact=French&rows=25&os=50&srt=docdt&order=desc&strdate=2026-07-01&enddate=2026-08-08&fl=id%2Cdisplay_title%2Cdocdt&apilang=English&custom=a%2Fb",
  );
});

test("rejects invalid World Bank rows and offsets", () => {
  expect(() => worldBankDocumentsUrl("", { rows: -1 })).toThrow(RangeError);
  expect(() => worldBankDocumentsUrl("", { offset: 1.5 })).toThrow(RangeError);
});

test("parses complete World Bank document metadata and skips the facets entry", () => {
  expect(parseWorldBankDocuments(completeResponse)).toEqual([
    {
      id: "world-bank|40120973|Inflation and economic growth",
      provider: "world-bank",
      kind: "analysis",
      title: "Inflation and economic growth",
      url: "https://documents.worldbank.org/example/paper",
      canonicalUrl: "https://doi.org/10.1234/mixed.case",
      source: "World Bank",
      publishedAt: "2026-08-06T00:00:00.000Z",
      publishedAtText: "2026-08-06",
      summary: "Inflation falls as productivity rises.",
      research: {
        authors: ["Ada Economist", "Ben Researcher"],
        institution: "World Bank",
        country: "Ethiopia",
        series: "Policy Research Working Paper",
        doi: "10.1234/mixed.case",
        externalId: "40120973",
        updatedAt: "2026-08-07T14:15:16.000Z",
        pdfUrl: "https://documents.worldbank.org/example/paper.pdf",
      },
    },
  ]);

  expect(parseWorldBankDocuments(JSON.stringify({ documents: { facets: { lang: {} } } }))).toEqual(
    [],
  );
});

test("uses display_title, skips invalid records, and deduplicates external ids", () => {
  const papers = parseWorldBankDocuments(
    JSON.stringify({
      documents: {
        facets: {},
        metadata: { display_title: "Not a document" },
        invalidTitle: { id: "D0", url: "https://documents.worldbank.org/d0" },
        invalidUrl: { id: "D1", display_title: "Bad URL", url: "javascript:alert(1)" },
        valid: {
          id: "D2",
          display_title: " Display title wins\n",
          docna: { "0": { docna: "Nested fallback" } },
          url: "https://documents.worldbank.org/d2",
        },
        duplicate: {
          id: "D2",
          display_title: "Duplicate",
          url: "https://documents.worldbank.org/d2-copy",
        },
      },
    }),
  );

  expect(papers).toHaveLength(1);
  expect(papers[0]).toMatchObject({
    title: "Display title wins",
    url: "https://documents.worldbank.org/d2",
    research: { institution: "World Bank", externalId: "D2" },
  });
});

test("throws when candidate documents contain no valid records", () => {
  expect(() =>
    parseWorldBankDocuments(
      JSON.stringify({
        documents: {
          facets: {},
          D1: { id: "D1", display_title: "Missing landing URL" },
          D2: { id: "D2", url: "https://documents.worldbank.org/d2" },
        },
      }),
    ),
  ).toThrow("World Bank Documents response contained no valid records");
  expect(() => parseWorldBankDocuments(JSON.stringify({}))).toThrow(
    "unexpected World Bank Documents response shape",
  );
});

test("truncates parsed documents at the requested limit and short-circuits limit zero", () => {
  const body = JSON.stringify({
    documents: {
      A: {
        id: "A",
        display_title: "First",
        url: "https://documents.worldbank.org/a",
      },
      B: {
        id: "B",
        display_title: "Second",
        url: "https://documents.worldbank.org/b",
      },
    },
  });

  expect(parseWorldBankDocuments(body, 1).map((paper) => paper.title)).toEqual(["First"]);
  expect(parseWorldBankDocuments("not JSON", 0)).toEqual([]);
});

test("fetches through the injected transport with limit-derived rows and a custom user agent", async () => {
  const requested: string[] = [];
  const requestedUserAgents: (string | null)[] = [];
  const papers = await fetchWorldBankDocuments("labor market", {
    docTypes: ["Policy Research Working Paper"],
    languages: ["English", "French"],
    limit: 2,
    offset: 4,
    sortBy: "docdt",
    order: "desc",
    since: "2026-07-01",
    until: "2026-08-08",
    userAgent: "world-bank-test-agent/1.0",
    fetch: async (input, init) => {
      requested.push(inputUrl(input));
      requestedUserAgents.push(new Headers(init?.headers).get("user-agent"));
      return new Response(completeResponse);
    },
  });

  expect(papers).toHaveLength(1);
  expect(requested).toHaveLength(1);
  const url = new URL(requested[0]!);
  expect(url.searchParams.get("format")).toBe("json");
  expect(url.searchParams.get("qterm")).toBe("labor market");
  expect(url.searchParams.getAll("docty")).toEqual(["Policy Research Working Paper"]);
  expect(url.searchParams.getAll("lang_exact")).toEqual(["English", "French"]);
  expect(url.searchParams.get("rows")).toBe("2");
  expect(url.searchParams.get("os")).toBe("4");
  expect(url.searchParams.get("strdate")).toBe("2026-07-01");
  expect(url.searchParams.get("enddate")).toBe("2026-08-08");
  expect(requestedUserAgents).toEqual(["world-bank-test-agent/1.0"]);
});

test("does not call the injected transport when the fetch limit is zero", async () => {
  let calls = 0;
  const papers = await fetchWorldBankDocuments("unused", {
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });

  expect(papers).toEqual([]);
  expect(calls).toBe(0);
});

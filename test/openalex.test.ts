import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/http.js";
import {
  fetchOpenAlexWorks,
  OPENALEX_INITIAL_CURSOR,
  OPENALEX_MAX_PER_PAGE,
  openAlexWorksUrl,
  parseOpenAlexWorks,
} from "../src/sources/openalex.js";

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw error;
  }
  throw new Error("Expected XnewsFetchError");
}

const completeWork = {
  id: "https://openalex.org/W123456789",
  ids: {
    openalex: "https://openalex.org/W123456789",
    doi: "http://dx.doi.org/10.1234/Mixed.Case",
  },
  doi: "https://doi.org/10.1234/Mixed.Case",
  display_name: "Monetary policy transmission",
  type: "report",
  publication_date: "2026-04-03",
  updated_date: "2026-04-05T13:14:15.123Z",
  abstract_inverted_index: {
    policy: [2],
    Monetary: [0],
    matters: [3],
    analysis: [1],
    ignored: ["bad", -1],
  },
  authorships: [
    {
      author: { id: "https://openalex.org/A1", display_name: "Ada Economist" },
      institutions: [
        {
          id: "https://openalex.org/I1",
          display_name: "Policy Institute",
          country_code: "US",
        },
      ],
      countries: ["US"],
    },
    {
      author: { id: "https://openalex.org/A2", display_name: "Ben Researcher" },
      institutions: [
        { id: "https://openalex.org/I1", display_name: "Policy Institute" },
        {
          id: "https://openalex.org/I2",
          display_name: "Economic University",
          country_code: "GB",
        },
      ],
    },
  ],
  topics: [
    { id: "https://openalex.org/T1", display_name: "Monetary Economics", score: 0.9 },
    { id: "https://openalex.org/T2", display_name: "Central Banking", score: 0.7 },
  ],
  primary_location: {
    landing_page_url: "https://publisher.example/papers/transmission#abstract",
    pdf_url: "https://publisher.example/papers/transmission.pdf",
    source: { id: "https://openalex.org/S1", display_name: "Economic Papers" },
    license: "CC-BY",
    version: "publishedVersion",
  },
  best_oa_location: {
    landing_page_url: "https://repository.example/transmission",
    pdf_url: "https://repository.example/transmission.pdf",
    source: null,
    license_id: "https://openalex.org/licenses/cc-by",
  },
  locations: [
    {
      landing_page_url: "https://publisher.example/papers/transmission#abstract",
      source: { display_name: "Economic Papers" },
    },
  ],
  biblio: { issue: "17" },
};

const completeResponse = JSON.stringify({
  meta: {
    count: 321,
    per_page: 100,
    next_cursor: "next-page-token==",
  },
  results: [completeWork],
  group_by: [],
});

function responseWithAbstract(abstractInvertedIndex: Record<string, unknown>): string {
  return JSON.stringify({
    meta: { count: 1, per_page: 1 },
    results: [
      {
        id: "https://openalex.org/W999",
        display_name: "Budgeted abstract",
        abstract_inverted_index: abstractInvertedIndex,
      },
    ],
  });
}

test("builds encoded cursor URLs with structured filters and capped page size", () => {
  const built = new URL(
    openAlexWorksUrl("inflation & growth", {
      apiKey: "key + secret",
      filters: {
        type: ["report", "article"],
        from_publication_date: "2025-01-01",
        is_oa: true,
      },
      sort: "publication_date:desc",
      cursor: "cursor+/= value",
      perPage: 10_000,
    }),
  );

  expect(built.origin + built.pathname).toBe("https://api.openalex.org/works");
  expect(built.searchParams.get("api_key")).toBe("key + secret");
  expect(built.searchParams.get("search")).toBe("inflation & growth");
  expect(built.searchParams.get("filter")).toBe(
    "type:report|article,from_publication_date:2025-01-01,is_oa:true",
  );
  expect(built.searchParams.get("sort")).toBe("publication_date:desc");
  expect(built.searchParams.get("cursor")).toBe("cursor+/= value");
  expect(built.searchParams.get("per_page")).toBe(String(OPENALEX_MAX_PER_PAGE));

  const initial = new URL(openAlexWorksUrl("", { apiKey: "key" }));
  expect(initial.searchParams.has("search")).toBe(false);
  expect(initial.searchParams.get("cursor")).toBe(OPENALEX_INITIAL_CURSOR);
});

test("parses OpenAlex works, inverted abstracts, and normalized research metadata", () => {
  const page = parseOpenAlexWorks(completeResponse);

  expect(page).toMatchObject({
    count: 321,
    nextCursor: "next-page-token==",
    perPage: 100,
  });
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    id: "openalex|W123456789|Monetary policy transmission",
    provider: "openalex",
    kind: "analysis",
    title: "Monetary policy transmission",
    url: "https://publisher.example/papers/transmission",
    canonicalUrl: "https://doi.org/10.1234/mixed.case",
    source: "Economic Papers",
    publishedAt: "2026-04-03T00:00:00.000Z",
    publishedAtText: "2026-04-03",
    summary: "Monetary analysis policy matters",
    tags: ["report", "Monetary Economics", "Central Banking"],
    research: {
      externalId: "W123456789",
      doi: "10.1234/mixed.case",
      authors: ["Ada Economist", "Ben Researcher"],
      institution: "Policy Institute; Economic University",
      country: "US; GB",
      series: "Economic Papers",
      issue: "17",
      categories: ["Monetary Economics", "Central Banking"],
      version: "publishedVersion",
      updatedAt: "2026-04-05T13:14:15.123Z",
      pdfUrl: "https://publisher.example/papers/transmission.pdf",
      licenseUrl: "https://openalex.org/licenses/cc-by",
    },
  });
});

test("rejects result arrays beyond the declared OpenAlex page maximum before record parsing", () => {
  const results: unknown[] = Array.from({ length: OPENALEX_MAX_PER_PAGE + 1 }, () => null);
  results[0] = {
    id: "https://openalex.org/W999",
    display_name: "Oversized page",
    abstract_inverted_index: { ["x".repeat(1_000_001)]: [0] },
  };

  expect(() =>
    parseOpenAlexWorks(JSON.stringify({ meta: { count: results.length }, results })),
  ).toThrow("OpenAlex Works response exceeded maximum page size");
});

test("bounds inverted-abstract token, position, and output amplification", () => {
  const budgetError = "OpenAlex Works abstract exceeded parser limits";
  const tooManyTokens = Object.fromEntries(
    Array.from({ length: 10_001 }, (_, index) => [`token${index}`, [index]] as const),
  );

  expect(() => parseOpenAlexWorks(responseWithAbstract(tooManyTokens))).toThrow(budgetError);
  expect(() =>
    parseOpenAlexWorks(responseWithAbstract({ repeated: Array.from({ length: 50_001 }, () => 0) })),
  ).toThrow(budgetError);
  expect(() => parseOpenAlexWorks(responseWithAbstract({ sparse: [50_000] }))).toThrow(budgetError);
  expect(() => parseOpenAlexWorks(responseWithAbstract({ ["x".repeat(1_000_001)]: [0] }))).toThrow(
    budgetError,
  );
});

test("stops record parsing at the requested limit before later abstract work", () => {
  const page = parseOpenAlexWorks(
    JSON.stringify({
      meta: { count: 2, per_page: 2, next_cursor: "next" },
      results: [
        { id: "https://openalex.org/W1", display_name: "First" },
        {
          id: "https://openalex.org/W2",
          display_name: "Second",
          abstract_inverted_index: { ["x".repeat(1_000_001)]: [0] },
        },
      ],
    }),
    1,
  );

  expect(page).toMatchObject({
    count: 2,
    nextCursor: "next",
    perPage: 2,
    items: [{ title: "First" }],
  });
});

test("skips malformed works without inferring a source from affiliation evidence", () => {
  const page = parseOpenAlexWorks(
    JSON.stringify({
      meta: { count: 4, per_page: 4 },
      results: [
        null,
        { id: "https://openalex.org/W1" },
        { id: "not-an-openalex-id", display_name: "Invalid identity" },
        {
          id: "https://openalex.org/W2",
          display_name: "Affiliation is evidence, not issuer identity",
          authorships: [
            {
              raw_author_name: "A. Author",
              institutions: [],
              raw_affiliation_strings: ["Example Central Bank, Research Division"],
            },
          ],
          primary_location: { source: null },
        },
      ],
    }),
  );

  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    source: "OpenAlex",
    url: "https://openalex.org/W2",
    research: {
      externalId: "W2",
      authors: ["A. Author"],
      institution: "Example Central Bank, Research Division",
    },
  });
});

test("distinguishes empty OpenAlex results from invalid endpoint schemas", () => {
  expect(
    parseOpenAlexWorks(JSON.stringify({ meta: { count: 0, per_page: 25 }, results: [] })),
  ).toEqual({
    items: [],
    count: 0,
    perPage: 25,
  });

  expect(() => parseOpenAlexWorks(JSON.stringify({ results: [] }))).toThrow(
    "unexpected OpenAlex Works response shape",
  );
  expect(() => parseOpenAlexWorks(JSON.stringify({ meta: [], results: [] }))).toThrow(
    "unexpected OpenAlex Works response shape",
  );
  expect(() => parseOpenAlexWorks(JSON.stringify({ meta: {}, results: {} }))).toThrow(
    "unexpected OpenAlex Works response shape",
  );
  expect(() =>
    parseOpenAlexWorks(JSON.stringify({ meta: {}, results: [{ id: "https://openalex.org/W1" }] })),
  ).toThrow("OpenAlex Works response contained no valid records");
});

test("uses injected fetch and follows a 301 OpenAlex work alias", async () => {
  const requested: string[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = inputUrl(input);
    requested.push(url);
    if (requested.length === 1) {
      return new Response(null, {
        status: 301,
        headers: {
          location: "https://api.openalex.org/works/W9002?api_key=alias-key",
        },
      });
    }
    return new Response(
      JSON.stringify({
        meta: { count: 1, per_page: 1, next_cursor: "alias-next" },
        results: [
          {
            id: "https://openalex.org/W9002",
            display_name: "Surviving merged work",
            primary_location: {
              landing_page_url: "https://repository.example/surviving-work",
              raw_source_name: "Repository evidence",
            },
          },
        ],
      }),
    );
  };

  const page = await fetchOpenAlexWorks("merged work", {
    apiKey: "alias-key",
    perPage: 1,
    fetch,
  });

  expect(requested).toHaveLength(2);
  expect(new URL(requested[0]!).searchParams.get("search")).toBe("merged work");
  expect(requested[1]).toBe("https://api.openalex.org/works/W9002?api_key=alias-key");
  expect(page.items[0]).toMatchObject({
    title: "Surviving merged work",
    source: "Repository evidence",
    research: { externalId: "W9002" },
  });
  expect(page.nextCursor).toBe("alias-next");
});

test("returns immediately for a zero limit after validating the API key", async () => {
  let calls = 0;
  const page = await fetchOpenAlexWorks("unused", {
    apiKey: "valid-key",
    limit: 0,
    fetch: async () => {
      calls += 1;
      return new Response(completeResponse);
    },
  });

  expect(calls).toBe(0);
  expect(page).toEqual({ items: [], perPage: 0 });
});

test("rejects blank keys before I/O and redacts keys from transport failures", async () => {
  let calls = 0;
  const missingKey = await captureXnewsError(
    fetchOpenAlexWorks("policy", {
      apiKey: "   ",
      fetch: async () => {
        calls += 1;
        return new Response(completeResponse);
      },
    }),
  );
  expect(missingKey).toMatchObject({ code: "config", url: "https://api.openalex.org/works" });
  expect(calls).toBe(0);

  const secret = "do-not-disclose-this-key";
  const transportFailure = await captureXnewsError(
    fetchOpenAlexWorks("policy", {
      apiKey: secret,
      fetch: async () => new Response("failure", { status: 503 }),
    }),
  );
  expect(transportFailure.code).toBe("http_status");
  expect(transportFailure.url).not.toContain(secret);
  expect(transportFailure.message).not.toContain(secret);
  expect(transportFailure.url).toContain("api_key=%3Credacted%3E");
});

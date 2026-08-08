import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import {
  OPEN_LIBRARY_MAX_LIMIT,
  OPEN_LIBRARY_SEARCH_FIELDS,
  openLibrarySearchUrl,
  openLibrarySource,
  parseOpenLibraryWorks,
} from "../src/sources/openlibrary.js";

const normalPayload = JSON.stringify({
  numFound: 3,
  docs: [
    {
      key: "/works/OL123W",
      title: "A Catalogued Book",
      subtitle: "The Complete Record",
      author_name: ["Ada Author", "Bea Writer"],
      publisher: ["Example Press"],
      language: ["eng"],
      first_publish_year: 1965,
      number_of_pages_median: 412,
      isbn: ["978-0-306-40615-7", "0-306-40615-2"],
      oclc: ["123456"],
      lccn: ["65001234"],
      ebook_access: "borrowable",
      public_scan_b: false,
    },
  ],
});

const scalarAndInvalidPayload = JSON.stringify({
  numFound: 1,
  docs: [
    {
      key: "/works/OL893456W",
      title: "Dune",
      author_name: "Frank Herbert",
      publisher: "Ace",
      language: "eng",
      first_publish_year: "1965",
      number_of_pages_median: "412",
      isbn: ["9780306406158"],
    },
  ],
});

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

function parseFailure(body: string): Promise<XnewsFetchError> {
  return captureXnewsError(Promise.resolve().then(() => parseOpenLibraryWorks(body)));
}

function minimalDoc(key: string, title: string, extra: Record<string, unknown> = {}) {
  return { key, title, ...extra };
}

test("parses a normal record with identifiers and complete works-lane shape", () => {
  const requestUrl = "https://openlibrary.org/search.json?title=catalogued";
  const page = parseOpenLibraryWorks(normalPayload, { page: 2, limit: 2, requestUrl });

  expect(page).toEqual({
    items: [
      {
        provider: "open-library",
        sourceId: "/works/OL123W",
        title: "A Catalogued Book",
        subtitle: "The Complete Record",
        authors: ["Ada Author", "Bea Writer"],
        publisher: "Example Press",
        publishedYear: 1965,
        language: "eng",
        pageCount: 412,
        identity: {
          isbn13: "9780306406157",
          isbn10: "0306406152",
          oclc: "123456",
          lccn: "65001234",
          openLibraryId: "/works/OL123W",
          origin: "record",
          confidence: 1,
        },
        availability: "borrow",
        url: "https://openlibrary.org/works/OL123W",
        warnings: [],
        provenance: [{ provider: "open-library", url: "https://openlibrary.org/works/OL123W" }],
      },
    ],
    page: 2,
    hasMore: false,
    totalCount: 3,
    warnings: [],
    requestUrls: [requestUrl],
  });
});

test("maps positive availability signals without guessing from missing metadata", () => {
  const page = parseOpenLibraryWorks(
    JSON.stringify({
      numFound: 3,
      docs: [
        minimalDoc("/works/OL1W", "Public Scan", { public_scan_b: true }),
        minimalDoc("/works/OL2W", "Borrowable", { ebook_access: "printdisabled" }),
        minimalDoc("/works/OL3W", "Catalog Only"),
      ],
    }),
    { limit: 3 },
  );

  expect(page.items.map((item) => item.availability)).toEqual([
    "public-domain",
    "borrow",
    "metadata-only",
  ]);
  expect(page.warnings).toEqual([]);
});

test("builds a constrained search URL with requested fields and capped pagination", () => {
  const url = new URL(
    openLibrarySearchUrl({
      title: " Dune ",
      author: " Frank Herbert ",
      isbn: " 9780441172719 ",
      query: " science fiction ",
      page: 3,
      limit: OPEN_LIBRARY_MAX_LIMIT + 1,
    }),
  );

  expect(url.origin).toBe("https://openlibrary.org");
  expect(url.pathname).toBe("/search.json");
  expect(url.searchParams.get("title")).toBe("Dune");
  expect(url.searchParams.get("author")).toBe("Frank Herbert");
  expect(url.searchParams.get("isbn")).toBe("9780441172719");
  expect(url.searchParams.get("q")).toBe("science fiction");
  expect(url.searchParams.get("fields")).toBe(OPEN_LIBRARY_SEARCH_FIELDS.join(","));
  expect(url.searchParams.get("page")).toBe("3");
  expect(url.searchParams.get("limit")).toBe(String(OPEN_LIBRARY_MAX_LIMIT));
});

test("rejects docs with the concrete wrong object shape as config", async () => {
  const failure = await parseFailure('{"numFound":12,"docs":{}}');
  expect(failure.code).toBe("config");
});

test("rejects a bare JSON array payload as config", async () => {
  const failure = await parseFailure("[]");
  expect(failure.code).toBe("config");
});

test("classifies a non-JSON blocked page as config", async () => {
  const failure = await parseFailure("<html>blocked</html>");
  expect(failure.code).toBe("config");
});

test("rejects a missing or invalid non-negative numFound", async () => {
  for (const body of [
    JSON.stringify({ docs: [] }),
    JSON.stringify({ numFound: -1, docs: [] }),
    JSON.stringify({ numFound: "12", docs: [] }),
  ]) {
    const failure = await parseFailure(body);
    expect(failure.code).toBe("config");
  }
});

test("rejects an empty docs page while numFound says results remain", async () => {
  const failure = await parseFailure('{"numFound":12,"docs":[]}');
  expect(failure.code).toBe("config");
});

test("preserves an explicit no-match response as an empty page", () => {
  expect(parseOpenLibraryWorks('{"numFound":0,"docs":[]}')).toEqual({
    items: [],
    page: 1,
    hasMore: false,
    totalCount: 0,
    warnings: [],
    requestUrls: [],
  });
});

test("rejects a non-empty docs payload that yields no valid records", async () => {
  const failure = await parseFailure(
    JSON.stringify({ numFound: 1, docs: [{ author_name: ["Nobody"] }] }),
  );
  expect(failure.code).toBe("config");
  expect(failure.message).toContain("no valid records");
});

test("rejects DOI-only and empty searches before any request", async () => {
  let calls = 0;
  const source = openLibrarySource({
    fetch: async () => {
      calls += 1;
      return new Response(normalPayload);
    },
  });

  const doiOnly = await captureXnewsError(source.search({ doi: "10.1000/example" }));
  const empty = await captureXnewsError(source.search({}));

  expect(doiOnly.code).toBe("config");
  expect(empty.code).toBe("config");
  expect(calls).toBe(0);
});

test("computes final-page hasMore from page size and raw doc count", () => {
  const docs = Array.from({ length: 5 }, (_, index) =>
    minimalDoc(`/works/OL${index + 1}W`, `Book ${index + 1}`),
  );
  const page = parseOpenLibraryWorks(JSON.stringify({ numFound: 25, docs }), {
    page: 3,
    limit: 10,
  });

  expect(page.items).toHaveLength(5);
  expect(page.hasMore).toBe(false);
});

test("accepts documented scalar variants for multi-valued text fields", () => {
  const record = parseOpenLibraryWorks(scalarAndInvalidPayload).items[0];

  expect(record?.authors).toEqual(["Frank Herbert"]);
  expect(record?.publisher).toBe("Ace");
  expect(record?.language).toBe("eng");
});

test("reports uncoercible numeric fields and invalid ISBNs on the record and page", () => {
  const page = parseOpenLibraryWorks(scalarAndInvalidPayload);
  const record = page.items[0];

  expect(record).not.toHaveProperty("publishedYear");
  expect(record).not.toHaveProperty("pageCount");
  expect(record?.identity).not.toHaveProperty("isbn13");
  expect(record?.warnings).toEqual(page.warnings);
  expect(page.warnings).toHaveLength(3);
  expect(page.warnings.some((warning) => warning.includes("first_publish_year"))).toBe(true);
  expect(page.warnings.some((warning) => warning.includes("number_of_pages_median"))).toBe(true);
  expect(
    page.warnings.some((warning) => warning.includes("isbn") && warning.includes("OL893456W")),
  ).toBe(true);
});

test("limit zero returns an empty page without a predicted URL or request", async () => {
  let calls = 0;
  const source = openLibrarySource({
    fetch: async () => {
      calls += 1;
      return new Response(normalPayload);
    },
  });

  expect(source.requestUrls({ query: "dune", limit: 0 })).toEqual([]);
  expect(source.search({ query: "dune", limit: 0 })).resolves.toEqual({
    items: [],
    page: 1,
    hasMore: false,
    warnings: [],
    requestUrls: [],
  });
  expect(calls).toBe(0);
});

test("rejects negative and non-integer limits and pages as config before requesting", async () => {
  let calls = 0;
  const source = openLibrarySource({
    fetch: async () => {
      calls += 1;
      return new Response(normalPayload);
    },
  });

  for (const query of [
    { query: "dune", limit: -1 },
    { query: "dune", limit: 1.5 },
    { query: "dune", page: 0 },
    { query: "dune", page: 1.5 },
  ]) {
    const failure = await captureXnewsError(source.search(query));
    expect(failure.code).toBe("config");
  }
  expect(calls).toBe(0);
});

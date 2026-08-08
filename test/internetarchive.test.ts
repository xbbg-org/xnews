import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import {
  INTERNET_ARCHIVE_MAX_ROWS,
  INTERNET_ARCHIVE_SEARCH_FIELDS,
  internetArchiveSearchUrl,
  internetArchiveSource,
  parseInternetArchiveWorks,
} from "../src/sources/internetarchive.js";

const searchFixture = JSON.stringify({
  responseHeader: { status: 0, QTime: 12 },
  response: {
    numFound: 10,
    start: 3,
    docs: [
      {
        identifier: "borrowed-book",
        title: "A Borrowed Book",
        creator: "Ada Author",
        year: 2017,
        publisher: "Example Press",
        language: ["eng", "fre"],
        isbn: ["978-0-306-40615-7"],
        "oclc-id": ["123456"],
        lccn: "2017000001",
        item_size: 4096,
        imagecount: 321,
        addeddate: "2017-09-16T21:33:33Z",
        collection: ["internetarchivebooks", "inlibrary"],
        licenseurl: "https://creativecommons.org/licenses/by-nc-sa/3.0/",
        format: ["Metadata", "Archive BitTorrent", "EPUB"],
      },
      {
        identifier: "public-domain-book",
        title: "A Public Domain Book",
        creator: ["Bea Writer", "Cal Editor"],
        publicdate: "2018-01-02T03:04:05Z",
        collection: ["opensource"],
        licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/",
        format: ["PDF", "Item Tile"],
      },
      {
        identifier: "rights-unstated-book",
        title: "Rights Unstated",
        creator: ["Dee Researcher"],
        format: ["Metadata", "DjVuTXT", "Djvu XML", "OCR Page Index"],
      },
      {
        identifier: "missing-title",
        creator: "Nobody",
      },
    ],
  },
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

function recordWith(metadata: Record<string, unknown>) {
  return parseInternetArchiveWorks(
    JSON.stringify({
      response: {
        numFound: 1,
        start: 0,
        docs: [{ identifier: "x", title: "T", ...metadata }],
      },
    }),
  ).items[0];
}

test("asserts redistributable availability only for recognized rights URLs", () => {
  expect(
    recordWith({ licenseurl: "https://rightsstatements.org/vocab/InC/1.0/" })?.availability,
  ).toBe("unknown");
  expect(recordWith({ licenseurl: "https://example.com/mark/restricted/" })?.availability).toBe(
    "unknown",
  );
  expect(
    recordWith({ licenseurl: "https://rightsstatements.org/vocab/NoC-US/1.0/" })?.availability,
  ).toBe("public-domain");
  expect(
    recordWith({ licenseurl: "https://creativecommons.org/licenses/by/4.0/" })?.availability,
  ).toBe("open-access");
});

test("does not fabricate addedAt from a bibliographic publication date", () => {
  expect(recordWith({ date: "1925" })).not.toHaveProperty("addedAt");
});

test("strictly validates and ISO-normalizes catalog ingest instants", () => {
  const impossible = recordWith({ addeddate: "2021-02-31" });
  expect(impossible).not.toHaveProperty("addedAt");
  expect(impossible?.warnings).toContain(
    'internet-archive x: ignored invalid addeddate "2021-02-31"',
  );
  expect(recordWith({ publicdate: "2021-03-01T01:02:03-05:00" })?.addedAt).toBe(
    "2021-03-01T06:02:03.000Z",
  );
});

test("warns when a structured ISBN fails checksum normalization", () => {
  const record = recordWith({ isbn: "978-0-306-40615-8" });

  expect(record?.identity).not.toHaveProperty("isbn13");
  expect(record?.warnings).toContain(
    'internet-archive x: ignored invalid isbn "978-0-306-40615-8"',
  );
});

test("parses creator variants, identifiers, formats, rights, and pagination", () => {
  const page = parseInternetArchiveWorks(searchFixture, {
    page: 2,
    requestUrl: "https://archive.org/advancedsearch.php?q=books",
  });

  expect(page.page).toBe(2);
  expect(page.totalCount).toBe(10);
  expect(page.hasMore).toBe(true);
  expect(page.items).toHaveLength(3);
  expect(page.requestUrls).toEqual(["https://archive.org/advancedsearch.php?q=books"]);
  expect(page.warnings).toEqual([
    "internet-archive: skipped a result without an identifier or title",
  ]);

  const borrowed = page.items[0];
  expect(borrowed?.authors).toEqual(["Ada Author"]);
  expect(borrowed?.availability).toBe("borrow");
  expect(borrowed?.format).toBe("epub");
  expect(borrowed?.identity).toMatchObject({
    isbn13: "9780306406157",
    oclc: "123456",
    lccn: "2017000001",
    origin: "record",
    confidence: 1,
  });
  expect(borrowed?.pageCount).toBe(321);
  expect(borrowed?.sizeBytes).toBe(4096);

  const publicDomain = page.items[1];
  expect(publicDomain?.authors).toEqual(["Bea Writer", "Cal Editor"]);
  expect(publicDomain?.availability).toBe("public-domain");
  expect(publicDomain?.format).toBe("pdf");

  const unknown = page.items[2];
  expect(unknown?.availability).toBe("unknown");
  expect(unknown).not.toHaveProperty("format");
});

test("builds constrained advanced-search URLs with repeated fields and capped rows", () => {
  const queries = [
    { query: "economic history" },
    { title: 'The "Quoted" Book' },
    { author: "Ursula Le Guin" },
    { isbn: "9780060850524" },
  ];

  for (const query of queries) {
    const url = new URL(internetArchiveSearchUrl(query));
    expect(url.origin).toBe("https://archive.org");
    expect(url.pathname).toBe("/advancedsearch.php");
    expect(url.searchParams.get("q")).toContain("mediatype:texts");
    expect(url.searchParams.getAll("fl[]")).toEqual([...INTERNET_ARCHIVE_SEARCH_FIELDS]);
    expect(url.searchParams.get("output")).toBe("json");
  }

  const titleUrl = new URL(
    internetArchiveSearchUrl({
      title: 'The "Quoted" Book',
      page: 4,
      limit: INTERNET_ARCHIVE_MAX_ROWS + 50,
    }),
  );
  expect(titleUrl.searchParams.get("q")).toBe(
    'title:("The \\"Quoted\\" Book") AND mediatype:texts',
  );
  expect(titleUrl.searchParams.get("page")).toBe("4");
  expect(titleUrl.searchParams.get("rows")).toBe(String(INTERNET_ARCHIVE_MAX_ROWS));
});

test("malformed payloads throw a config XnewsFetchError", async () => {
  const failure = await captureXnewsError(
    Promise.resolve().then(() =>
      parseInternetArchiveWorks(JSON.stringify({ response: { docs: null } })),
    ),
  );
  expect(failure.code).toBe("config");
  expect(() =>
    parseInternetArchiveWorks(
      JSON.stringify({
        response: { numFound: 1, start: 0, docs: [{ creator: "Nobody" }] },
      }),
    ),
  ).toThrow("internet-archive: advanced-search response contained no valid records");
});

test("rejects empty docs when the response claims unread results", async () => {
  const failure = await captureXnewsError(
    Promise.resolve().then(() =>
      parseInternetArchiveWorks('{"response":{"numFound":4,"start":0,"docs":[]}}'),
    ),
  );

  expect(failure.code).toBe("config");
});

test("rejects an empty works query before dialing", async () => {
  let calls = 0;
  const source = internetArchiveSource({
    fetch: async () => {
      calls += 1;
      return new Response(searchFixture);
    },
  });

  const failure = await captureXnewsError(source.search({}));
  expect(failure.code).toBe("config");
  expect(calls).toBe(0);
});

test("returns an empty no-request page when limit is zero", async () => {
  let calls = 0;
  const source = internetArchiveSource({
    fetch: async () => {
      calls += 1;
      return new Response(searchFixture);
    },
  });

  expect(source.requestUrls({ title: "T", limit: 0 })).toEqual([]);
  expect(await source.search({ title: "T", limit: 0 })).toEqual({
    items: [],
    page: 1,
    hasMore: false,
    warnings: [],
    requestUrls: [],
  });
  expect(calls).toBe(0);
});

test("rejects invalid page and limit values as config errors before dialing", async () => {
  let calls = 0;
  const source = internetArchiveSource({
    fetch: async () => {
      calls += 1;
      return new Response(searchFixture);
    },
  });

  for (const query of [
    { title: "T", limit: -1 },
    { title: "T", limit: 1.5 },
    { title: "T", page: -1 },
    { title: "T", page: 1.5 },
    { title: "T", limit: 0, page: -1 },
  ]) {
    const failure = await captureXnewsError(source.search(query));
    expect(failure.code).toBe("config");
  }
  expect(calls).toBe(0);
});

/** Builds a one-doc payload carrying just the format tokens under test. */
function formatOf(...format: string[]): string | undefined {
  const page = parseInternetArchiveWorks(
    JSON.stringify({
      response: {
        numFound: 1,
        start: 0,
        docs: [{ identifier: "x", title: "T", format }],
      },
    }),
  );
  return page.items[0]?.format;
}

test("maps the prose format tokens the API actually emits", () => {
  expect(formatOf("Metadata", "EPUB")).toBe("epub");
  expect(formatOf("Image Container PDF")).toBe("pdf");
  expect(formatOf("Additional Text PDF")).toBe("pdf");
  expect(formatOf("Word Document")).toBe("doc");
  expect(formatOf("OpenDocument Text Document")).toBe("odt");
  expect(formatOf("Comic Book RAR")).toBe("cbr");
});

test("prefers the reflowable format when an item carries several", () => {
  expect(formatOf("Text PDF", "EPUB", "DjVu")).toBe("epub");
  expect(formatOf("Text PDF", "DjVu")).toBe("pdf");
  // Preference is by usefulness, not by position in the source array.
  expect(formatOf("DjVu", "MOBI")).toBe("mobi");
});

test("never reports a DRM-wrapped variant as its base format", () => {
  // Lending items carry these constantly; calling them `pdf`/`epub` would
  // promise a file no plain reader can open.
  expect(formatOf("ACS Encrypted PDF")).toBeUndefined();
  expect(formatOf("LCP Encrypted EPUB")).toBeUndefined();
  expect(formatOf("Adobe Encrypted PDF")).toBeUndefined();
  // A clean copy alongside the wrapped one still counts.
  expect(formatOf("ACS Encrypted PDF", "EPUB")).toBe("epub");
});

test("OCR sidecars are not a stated format", () => {
  // Every scanned item carries these; mapping them would report `txt` for
  // most of the corpus and hide that no primary artifact was stated.
  expect(formatOf("Metadata", "DjVuTXT", "Djvu XML", "OCR Page Index")).toBeUndefined();
  expect(formatOf("Archive BitTorrent", "Item Tile")).toBeUndefined();
});

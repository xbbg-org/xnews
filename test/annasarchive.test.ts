import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/http.js";
import {
  annasArchiveRecordUrl,
  annasArchiveSearchUrl,
  annasArchiveSource,
  parseAnnasArchiveRecords,
} from "../src/sources/annasarchive.js";

const MIRROR = "https://anna.example";
const DUNE_MD5 = "0123456789abcdef0123456789abcdef";
const SECOND_MD5 = "fedcba9876543210fedcba9876543210";

const RESULTS_HTML = `<!doctype html>
<html>
  <head>
    <script><a href="/md5/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"><div><img></div></a></script>
    <style>.font-semibold { color: red; }</style>
  </head>
  <body>
    <p>Results 1-2 (500+ total)</p>
    <section>
      <a href="/md5/${DUNE_MD5}" class="custom-a block mr-2 cover-link">
        <div><img src="/covers/dune.jpg" alt="Dune Messiah"></div>
      </a>
      <div class="text-[9px] text-gray-500 font-mono">lgli/[Dune Chronicles 02] Herbert, Frank - Dune Messiah [48873] (r1.1) [EN] ISBN 9780141439518</div>
      <a href="/md5/${DUNE_MD5}" class="font-semibold text-lg">Dune Messiah</a>
      <a href="/search?q=Frank%20Herbert"><span class="icon-[mdi--user-edit]"></span> Frank Herbert</a>
      <a href="/search?q=ePubLibre"><span class="icon-[mdi--company]"></span> ePubLibre, 1969</a>
      <div class="text-sm text-gray-600 mt-2 mb-2">Dune Messiah continues...</div>
      <div class="metadata">English [en] &middot; EPUB &middot; 1.9MB &middot; 1969 &middot; 📕 Book (fiction) &middot; 🚀/lgli/lgrs/zlib</div>
    </section>
    <section>
      <a href="/md5/${SECOND_MD5}" class="custom-a block mr-2 cover-link">
        <div><img src="/covers/left-hand.jpg" alt="The Left Hand of Darkness"></div>
      </a>
      <div class="text-[9px] text-gray-500 font-mono">zlib/Le Guin - Left Hand [12345] invalid ISBN 9780141439519</div>
      <a href="/md5/${SECOND_MD5}" class="font-semibold text-lg">The Left Hand of Darkness</a>
      <a href="/search?q=Ursula%20K.%20Le%20Guin"><span class="icon-[mdi--user-edit]"></span> Ursula K. Le Guin</a>
      <a href="/search?q=Ace"><span class="icon-[mdi--company]"></span> Ace Books, 1969</a>
      <div>A science-fiction classic.</div>
      <div>English [en] &#183; PDF &#183; 640KB &#183; 1969 &#183; 📕 Book (fiction)</div>
    </section>
  </body>
</html>`;

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}

function recordBlock(md5: string, title: string, metadata?: string): string {
  return `<section>
    <a href="/md5/${md5}"><img src="/cover.jpg" alt="${title}"></a>
    <a href="/md5/${md5}">${title}</a>
    ${metadata === undefined ? "" : `<div>${metadata}</div>`}
  </section>`;
}

async function captureXnewsError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

test("parses semantic record blocks into normalized works", () => {
  const page = parseAnnasArchiveRecords(RESULTS_HTML, { baseUrl: MIRROR });

  expect(page.items).toHaveLength(2);
  expect(page.totalCount).toBeUndefined();
  expect(page.hasMore).toBe(true);
  expect(page.warnings).toEqual([]);

  const dune = page.items[0]!;
  expect(dune.sourceId).toBe(DUNE_MD5);
  expect(dune.identity.md5).toBe(DUNE_MD5);
  expect(dune.title).toBe("Dune Messiah");
  expect(dune.authors).toEqual(["Frank Herbert"]);
  expect(dune.publisher).toBe("ePubLibre");
  expect(dune.publishedYear).toBe(1969);
  expect(dune.language).toBe("en");
  expect(dune.format).toBe("epub");
  expect(dune.sizeBytes).toBe(Math.round(1.9 * 1024 ** 2));
  expect(dune.identity.isbn13).toBe("9780141439518");
  expect(dune.availability).toBe("unknown");
  expect(dune.url).toBe(`${MIRROR}/md5/${DUNE_MD5}`);

  const second = page.items[1]!;
  expect(second.sourceId).toBe(SECOND_MD5);
  expect(second.title).toBe("The Left Hand of Darkness");
  expect(second.authors).toEqual(["Ursula K. Le Guin"]);
  // A checksum-invalid run is silently not an ISBN. Catalogs print LCCNs and
  // hyphenated ids beside real ISBNs, so warning per candidate would flag most
  // of every result page for nothing actionable.
  expect(second.identity.isbn13).toBeUndefined();
  expect(second.warnings).toEqual([]);
});

test("ignores script and style markup when finding record boundaries", () => {
  const page = parseAnnasArchiveRecords(RESULTS_HTML, { baseUrl: MIRROR });

  expect(page.items.map((item) => item.sourceId)).toEqual([DUNE_MD5, SECOND_MD5]);
});

test("keeps a cover boundary when its quoted attribute contains greater-than", () => {
  const html = RESULTS_HTML.replace(
    `<a href="/md5/${SECOND_MD5}" class="custom-a block mr-2 cover-link">
        <div><img src="/covers/left-hand.jpg" alt="The Left Hand of Darkness"></div>
      </a>`,
    `<a title="score > 0" href="/md5/${SECOND_MD5}"><img src="/covers/left-hand.jpg" alt="The Left Hand of Darkness"></a>`,
  );

  const page = parseAnnasArchiveRecords(html, { baseUrl: MIRROR });

  expect(page.items.map((item) => item.sourceId)).toEqual([DUNE_MD5, SECOND_MD5]);
  expect(page.items[0]?.authors).toEqual(["Frank Herbert"]);
  expect(page.items[1]?.authors).toEqual(["Ursula K. Le Guin"]);
});

test("throws config when the result span and cover-boundary count disagree", async () => {
  const html = RESULTS_HTML.replace(
    `<a href="/md5/${SECOND_MD5}" class="custom-a block mr-2 cover-link">`,
    `<a href="/book/${SECOND_MD5}" class="custom-a block mr-2 cover-link">`,
  );
  const error = await captureXnewsError(
    Promise.resolve().then(() => parseAnnasArchiveRecords(html, { baseUrl: MIRROR })),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("result summary");
});

test("throws config when summary-like markup uses an unrecognized format", async () => {
  const records = Array.from({ length: 10 }, (_, index) => {
    const md5 = index.toString(16).padStart(32, "0");
    return recordBlock(md5, `Book ${index + 1}`);
  }).join("\n");
  const html = `<html><body><p>Showing 1–10 of 100 results</p>${records}</body></html>`;
  const error = await captureXnewsError(
    Promise.resolve().then(() => parseAnnasArchiveRecords(html, { baseUrl: MIRROR })),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("result-count summary");
});

test("parses near-normal metadata labels, casing, and IEC sizes", () => {
  const html = `<html><body>
    <p>Results 1-1 (1 total)</p>
    ${recordBlock(DUNE_MD5, "Dune Messiah", "English (en) · epub · 1.9 MiB · Published 1969")}
  </body></html>`;

  const page = parseAnnasArchiveRecords(html, { baseUrl: MIRROR });

  expect(page.items[0]?.language).toBe("en");
  expect(page.items[0]?.format).toBe("epub");
  expect(page.items[0]?.sizeBytes).toBe(Math.round(1.9 * 1024 ** 2));
  expect(page.items[0]?.publishedYear).toBe(1969);
  expect(page.warnings).toEqual([]);
});

test("warns once when a metadata line yields no expected fields", () => {
  const html = `<html><body>
    <p>Results 1-1 (1 total)</p>
    ${recordBlock(DUNE_MD5, "Dune Messiah", "Retail release · Digital library")}
  </body></html>`;

  const page = parseAnnasArchiveRecords(html, { baseUrl: MIRROR });

  expect(page.warnings).toEqual([
    "annas-archive: metadata line yielded no recognized language, format, size, or publication year",
  ]);
});

test("rejects a soft 404 that mentions no files found", async () => {
  const error = await captureXnewsError(
    Promise.resolve().then(() =>
      parseAnnasArchiveRecords(
        "<html><body><h1>404</h1><p>No files found at this URL</p></body></html>",
        { baseUrl: MIRROR },
      ),
    ),
  );

  expect(error.code).toBe("config");
});

test("throws config instead of reporting zero matches for a garbage page", async () => {
  const error = await captureXnewsError(
    Promise.resolve().then(() =>
      parseAnnasArchiveRecords("<html><body><p>Access denied</p></body></html>", {
        baseUrl: MIRROR,
      }),
    ),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("layout may have changed");
});

test("returns an empty page for an explicit no-results response", () => {
  const page = parseAnnasArchiveRecords(
    "<html><body><h1>No results found</h1><p>Try another search.</p></body></html>",
    { baseUrl: MIRROR },
  );

  expect(page.items).toEqual([]);
  expect(page.hasMore).toBe(false);
});

test("URL builders require a caller-supplied usable HTTPS mirror", () => {
  expect(new URL(annasArchiveSearchUrl("dune", { baseUrl: MIRROR, page: 2 })).href).toBe(
    `${MIRROR}/search?q=dune&page=2`,
  );
  expect(annasArchiveRecordUrl(DUNE_MD5.toUpperCase(), { baseUrl: MIRROR })).toBe(
    `${MIRROR}/md5/${DUNE_MD5}`,
  );
  for (const baseUrl of ["", "   ", "http://anna.example", "ftp://anna.example", "not a url"]) {
    expect(() => annasArchiveSearchUrl("dune", { baseUrl })).toThrow(XnewsFetchError);
  }
});

test("an empty mirror pool fails closed from search", async () => {
  const error = await captureXnewsError(
    annasArchiveSource({ mirrors: [] }).search({ query: "dune" }),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("Anna's Archive requires at least one mirror origin");
});

test("a throwing mirror falls through and attributes records to the answer", async () => {
  const dialed: string[] = [];
  const source = annasArchiveSource({
    mirrors: ["https://down.example", "https://up.example"],
    fetch: (input) => {
      const url = inputUrl(input);
      dialed.push(new URL(url).origin);
      if (url.startsWith("https://down.example")) return Promise.reject(new Error("connect fail"));
      return Promise.resolve(htmlResponse(RESULTS_HTML));
    },
  });

  const page = await source.search({ query: "dune" });

  expect(dialed).toEqual(["https://down.example", "https://up.example"]);
  expect(page.items).toHaveLength(2);
  expect(page.warnings.some((warning) => warning.includes("down.example"))).toBe(true);
  expect(page.items[0]?.url.startsWith("https://up.example")).toBe(true);
  expect(page.items[0]?.provenance[0]?.url.startsWith("https://up.example")).toBe(true);
});

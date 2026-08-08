import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/http.js";
import {
  fetchLibgenBooks,
  libgenAbsoluteUrl,
  libgenBookToWorkRecord,
  libgenSearchUrl,
  libgenSource,
  LIBGEN_MAX_PER_PAGE,
  parseByteSize,
  parseLibgenBooks,
  parseLibgenDownloads,
  parsePageCount,
  parseTitleCell,
  resolveLibgenDownloads,
  searchLibgenBooks,
} from "../src/sources/libgen.js";
import { searchWorks } from "../src/works.js";

const MIRROR = "https://mirror.example";

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

function htmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "text/html" } });
}

/** Classic nine-column result table with a header row and mirror links. */
function resultTable(rows: string): string {
  return `<html><body><table class="c">
    <tr><th>ID</th><th>Author(s)</th><th>Title</th><th>Publisher</th><th>Year</th>
        <th>Pages</th><th>Language</th><th>Size</th><th>Extension</th>
        <th>Mirrors</th><th>Edit</th></tr>
    ${rows}
  </table></body></html>`;
}

const AUSTEN_ROW = `<tr>
  <td>1234567</td>
  <td><a href="/index.php?req=Jane+Austen&columns[]=a">Austen, Jane</a></td>
  <td><a href="/file.php?id=1234567" title="Pride and Prejudice">Pride and Prejudice</a>
      <font color="#900">2nd ed, 9780141439518, 0141439513</font></td>
  <td>Penguin Classics</td>
  <td>2007</td>
  <td>480[12]</td>
  <td>English</td>
  <td>1005 Kb</td>
  <td>epub</td>
  <td><a href="/ads.php?md5=A1B2C3D4E5F60718293A4B5C6D7E8F90">[1]</a></td>
  <td><a href="/edit.php?id=1234567">edit</a></td>
</tr>`;

test("parses a classic result row into coerced fields", () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });

  expect(page.warnings).toEqual([]);
  expect(page.items).toHaveLength(1);
  const book = page.items[0];
  expect(book?.id).toBe("1234567");
  expect(book?.title).toBe("Pride and Prejudice");
  expect(book?.authors).toEqual(["Austen, Jane"]);
  expect(book?.publisher).toBe("Penguin Classics");
  expect(book?.year).toBe(2007);
  expect(book?.pages).toBe(480);
  expect(book?.language).toBe("English");
  expect(book?.extension).toBe("epub");
  expect(book?.edition).toBe("2");
  // 1005 KiB, as the mirror displays it.
  expect(book?.sizeBytes).toBe(1_029_120);
  expect(book?.md5).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
  expect(book?.detailUrl).toBe(`${MIRROR}/file.php?id=1234567`);
  expect(book?.mirrorUrls).toEqual([`${MIRROR}/ads.php?md5=A1B2C3D4E5F60718293A4B5C6D7E8F90`]);
});

test("extracts and validates ISBNs the python wrappers discard", () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });

  // Both forms present, checksum-valid, and the catalog id is not mistaken
  // for an ISBN-10 despite being a nine-digit run.
  expect(page.items[0]?.isbns).toEqual(["9780141439518", "0141439513"]);
});

test("keeps raw display strings alongside coerced values", () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });

  expect(page.items[0]?.raw.size).toBe("1005 Kb");
  expect(page.items[0]?.raw.pages).toBe("480[12]");
  expect(page.items[0]?.raw.year).toBe("2007");
});

test("warns instead of silently zeroing an uncoercible numeric cell", () => {
  const row = AUSTEN_ROW.replace("<td>1005 Kb</td>", "<td>huge</td>").replace(
    "<td>2007</td>",
    "<td>n.d.</td>",
  );
  const page = parseLibgenBooks(resultTable(row), { baseUrl: MIRROR });

  const book = page.items[0];
  expect(book?.sizeBytes).toBeUndefined();
  expect(book?.year).toBeUndefined();
  expect(book?.raw.size).toBe("huge");
  expect(page.warnings).toContain('libgen 1234567: unparseable size "huge"');
  expect(page.warnings).toContain('libgen 1234567: unparseable year "n.d."');
});

test("maps columns from the header, not from fixed positions", () => {
  // Same data, columns reordered and renamed the way a fork does it.
  const html = `<html><body><table id="tablelibgen">
    <tr><th>Title</th><th>Author</th><th>Ext</th><th>File size</th><th>Year</th><th>Download</th></tr>
    <tr>
      <td><a href="/file.php?id=99">Dune</a></td>
      <td>Herbert, Frank</td>
      <td>PDF</td>
      <td>2 MB</td>
      <td>1965</td>
      <td><a href="/ads.php?md5=0123456789abcdef0123456789abcdef">get</a></td>
    </tr>
  </table></body></html>`;
  const page = parseLibgenBooks(html, { baseUrl: MIRROR });

  expect(page.warnings).toEqual([]);
  const book = page.items[0];
  expect(book?.title).toBe("Dune");
  expect(book?.authors).toEqual(["Herbert, Frank"]);
  expect(book?.extension).toBe("pdf");
  expect(book?.sizeBytes).toBe(2_097_152);
  expect(book?.year).toBe(1965);
  expect(book?.id).toBe("0123456789abcdef0123456789abcdef");
});

test("rejects a present header that cannot be mapped confidently", async () => {
  const row = `<tr>
    <td>Dune</td><td>Frank Herbert</td><td>Ace</td><td>1965</td><td>English</td>
    <td>412</td><td>2 MB</td><td>EPUB</td>
    <td><a href="/ads.php?md5=0123456789abcdef0123456789abcdef">md5-link</a></td>
  </tr>`;

  for (const headerCell of ["th", "td"]) {
    const header = [
      "Book",
      "Writer",
      "Publisher",
      "Published",
      "Language",
      "Extent",
      "Bytes",
      "Filetype",
      "Links",
    ]
      .map((label) => `<${headerCell}>${label}</${headerCell}>`)
      .join("");
    const error = await captureXnewsError(
      Promise.resolve().then(() =>
        parseLibgenBooks(`<html><body><table><tr>${header}</tr>${row}</table></body></html>`, {
          baseUrl: MIRROR,
        }),
      ),
    );

    expect(error.code).toBe("config");
    expect(error.message).toContain("Book");
    expect(error.message).toContain("Writer");
    expect(error.message).toContain("Filetype");
  }
});

test("falls back to the positional layout and says so", () => {
  const html = `<html><body><table class="c">
    <tr>
      <td>77</td><td>Orwell, George</td>
      <td><a href="/file.php?id=77">1984</a></td>
      <td>Secker</td><td>1949</td><td>328</td><td>English</td><td>500 Kb</td><td>epub</td>
      <td><a href="/ads.php?md5=ffffffffffffffffffffffffffffffff">[1]</a></td>
    </tr>
  </table></body></html>`;
  const page = parseLibgenBooks(html, { baseUrl: MIRROR });

  expect(page.warnings).toContain(
    "libgen: no recognizable header row; fell back to the classic positional column layout",
  );
  expect(page.items[0]?.title).toBe("1984");
  expect(page.items[0]?.year).toBe(1949);
});

test("throws rather than reporting zero matches when the layout is gone", async () => {
  const error = await captureXnewsError(
    Promise.resolve().then(() =>
      parseLibgenBooks("<html><body><p>Access denied</p></body></html>", { baseUrl: MIRROR }),
    ),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("no recognizable result table");
});

test("treats an explicit empty result as empty, not as a layout break", () => {
  const page = parseLibgenBooks("<html><body><h1>Nothing found</h1></body></html>", {
    baseUrl: MIRROR,
  });

  expect(page.items).toEqual([]);
  expect(page.hasMore).toBe(false);

  const pageWithLayoutTable = parseLibgenBooks(
    `<html><body><h1>Nothing found</h1>
      <table>
        <tr><td>Username</td><td>Password</td><td>Action</td></tr>
        <tr><td></td><td></td><td>Sign in</td></tr>
      </table>
    </body></html>`,
    { baseUrl: MIRROR },
  );
  expect(pageWithLayoutTable.items).toEqual([]);
  expect(pageWithLayoutTable.warnings).toEqual([]);
});

test("rejects a selected table that yields no usable records", async () => {
  const html = `<html><body>
    <p>Access denied</p>
    <table>
      <tr><th>Title</th><th>Author</th><th>Publisher</th><th>Language</th><th>Links</th></tr>
      <tr><td>Sign in</td><td>Username</td><td>Password</td><td>English</td><td>Continue</td></tr>
    </table>
  </body></html>`;
  const error = await captureXnewsError(
    Promise.resolve().then(() => parseLibgenBooks(html, { baseUrl: MIRROR })),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("yielded no usable records");
});

test("does not mistake a soft-404 message for an empty search result", async () => {
  for (const message of ["No files found at this URL", "No files were found at this URL"]) {
    const error = await captureXnewsError(
      Promise.resolve().then(() =>
        parseLibgenBooks(`<html><body><p>${message}</p></body></html>`, { baseUrl: MIRROR }),
      ),
    );

    expect(error.code).toBe("config");
    expect(error.message).toContain("no recognizable result table");
  }
});

test("parseTitleCell separates title, series, edition, and ISBNs", () => {
  // 978-0-441-01359-3 is a real, checksum-valid ISBN-13; the parser rejects
  // anything whose check digit does not verify.
  const cell = `<a href="/file.php?id=5">Dune Messiah</a>
    <a href="/index.php?req=dune&column=series">Dune Chronicles</a>
    <i>3rd ed.</i> 978-0-441-01359-3`;
  const parsed = parseTitleCell(cell);

  expect(parsed.title).toBe("Dune Messiah");
  expect(parsed.series).toBe("Dune Chronicles");
  expect(parsed.edition).toBe("3");
  expect(parsed.isbns).toEqual(["9780441013593"]);
});

test("rejects an ISBN whose check digit does not verify", () => {
  const parsed = parseTitleCell(`<a href="/file.php?id=5">Dune</a> 978-0-441-01359-0`);

  expect(parsed.isbns).toEqual([]);
});

test("parseByteSize reads the units mirrors display", () => {
  expect(parseByteSize("1005 Kb")).toBe(1_029_120);
  expect(parseByteSize("1.4 MB")).toBe(1_468_006);
  expect(parseByteSize("1 005 KiB")).toBe(1_029_120);
  expect(parseByteSize("512 bytes")).toBe(512);
  expect(parseByteSize("3 GB")).toBe(3_221_225_472);
  expect(parseByteSize("unknown")).toBeUndefined();
  expect(parseByteSize("")).toBeUndefined();
});

test("parsePageCount handles the secondary-count form", () => {
  expect(parsePageCount("410")).toBe(410);
  expect(parsePageCount("410[12]")).toBe(410);
  expect(parsePageCount("0")).toBeUndefined();
  expect(parsePageCount("n/a")).toBeUndefined();
});

test("search urls carry no origin of their own", () => {
  const url = libgenSearchUrl("pride and prejudice", { baseUrl: MIRROR, layout: "index" });
  const parsed = new URL(url);

  expect(parsed.origin).toBe(MIRROR);
  expect(parsed.pathname).toBe("/index.php");
  expect(parsed.searchParams.get("req")).toBe("pride and prejudice");
  expect(parsed.searchParams.getAll("columns[]")).toEqual(["t", "a", "s", "y", "p", "i"]);
  expect(parsed.searchParams.getAll("topics[]")).toEqual(["l"]);
  expect(parsed.searchParams.get("res")).toBe("25");
});

test("classic layout routes fiction to its own endpoint", () => {
  const url = new URL(
    libgenSearchUrl("dune", { baseUrl: MIRROR, layout: "classic", topics: ["fiction"] }),
  );

  expect(url.pathname).toBe("/fiction/");
  expect(url.searchParams.get("q")).toBe("dune");
});

test("classic sources reject multiple topics before network I/O", async () => {
  let fetchCalls = 0;
  const source = libgenSource({
    mirrors: [MIRROR],
    layout: "classic",
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve(htmlResponse("<html><body><h1>Nothing found</h1></body></html>"));
    },
  });

  const error = await captureXnewsError(source.search({ query: "dune" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("one topic");
  expect(fetchCalls).toBe(0);
});

test("classic layout scopes the query to one column", () => {
  const url = new URL(
    libgenSearchUrl("austen", { baseUrl: MIRROR, layout: "classic", searchField: "author" }),
  );

  expect(url.pathname).toBe("/search.php");
  expect(url.searchParams.get("column")).toBe("author");
  expect(url.searchParams.get("req")).toBe("austen");
});

test("a mirror base with a path prefix is preserved", () => {
  const url = new URL(libgenSearchUrl("dune", { baseUrl: "https://host.example/lg" }));

  expect(url.pathname).toBe("/lg/index.php");
});

test("extraParams override a differently spelled mirror parameter", () => {
  const url = new URL(
    libgenSearchUrl("dune", { baseUrl: MIRROR, extraParams: { res: "50", mode: "last" } }),
  );

  expect(url.searchParams.get("res")).toBe("50");
  expect(url.searchParams.get("mode")).toBe("last");
});

test("missing or unusable mirror base fails closed as config", () => {
  for (const baseUrl of ["", "   ", "ftp://host.example", "not a url"]) {
    expect(() => libgenSearchUrl("dune", { baseUrl })).toThrow(XnewsFetchError);
  }
});

test("short queries and bad paging are rejected before any request", () => {
  expect(() => libgenSearchUrl("ab", { baseUrl: MIRROR })).toThrow(/at least 3 characters/);
  expect(() => libgenSearchUrl("dune", { baseUrl: MIRROR, page: 0 })).toThrow(/positive integer/);
  expect(() =>
    libgenSearchUrl("dune", { baseUrl: MIRROR, perPage: LIBGEN_MAX_PER_PAGE + 1 }),
  ).toThrow(/between 1 and 100/);
});

test("libgenAbsoluteUrl refuses non-http links", () => {
  expect(libgenAbsoluteUrl("/ads.php?md5=abc", { baseUrl: MIRROR })).toBe(
    `${MIRROR}/ads.php?md5=abc`,
  );
  expect(libgenAbsoluteUrl("magnet:?xt=urn:btih:abc", { baseUrl: MIRROR })).toBeUndefined();
  expect(
    libgenAbsoluteUrl("http://libgenfrialc7tguyjywa36vtrdcplwpxaw43h6o63dmmwhvavo5rqqd.onion/x", {
      baseUrl: MIRROR,
    }),
  ).toBe("http://libgenfrialc7tguyjywa36vtrdcplwpxaw43h6o63dmmwhvavo5rqqd.onion/x");
});

test("fetch sends a browser-shaped user agent to the caller's mirror", async () => {
  const seen: { url?: string; userAgent?: string } = {};
  await fetchLibgenBooks("pride and prejudice", {
    baseUrl: MIRROR,
    fetch: (input, init) => {
      seen.url = inputUrl(input);
      const userAgent = new Headers(init?.headers).get("User-Agent");
      if (userAgent !== null) seen.userAgent = userAgent;
      return Promise.resolve(htmlResponse(resultTable(AUSTEN_ROW)));
    },
  });

  expect(seen.url).toContain(`${MIRROR}/index.php`);
  expect(seen.userAgent).toBe("Mozilla/5.0 (compatible; xnews)");
});

test("post-parse filters match exactly by default and loosely on request", async () => {
  const fetchTable = () => Promise.resolve(htmlResponse(resultTable(AUSTEN_ROW)));

  const exact = await fetchLibgenBooks("pride", {
    baseUrl: MIRROR,
    fetch: fetchTable,
    filters: { year: "2007", extension: "epub" },
  });
  expect(exact.items).toHaveLength(1);

  const missed = await fetchLibgenBooks("pride", {
    baseUrl: MIRROR,
    fetch: fetchTable,
    filters: { extension: "EPUB" },
  });
  expect(missed.items).toEqual([]);

  const loose = await fetchLibgenBooks("pride", {
    baseUrl: MIRROR,
    fetch: fetchTable,
    filters: { extension: "EPUB", year: "200" },
    exactMatch: false,
  });
  expect(loose.items).toHaveLength(1);
});

test("pagination walks pages and stops when a page is not full", async () => {
  const pages: string[] = [];
  const page = await searchLibgenBooks("pride", {
    baseUrl: MIRROR,
    perPage: 2,
    maxPages: 5,
    fetch: (input) => {
      const url = new URL(inputUrl(input));
      pages.push(url.searchParams.get("page") ?? "1");
      // Two full pages, then a short one.
      const rows = pages.length < 3 ? AUSTEN_ROW.repeat(2) : AUSTEN_ROW;
      return Promise.resolve(htmlResponse(resultTable(rows)));
    },
  });

  expect(pages).toEqual(["1", "2", "3"]);
  expect(page.items).toHaveLength(5);
  expect(page.hasMore).toBe(false);
});

test("pagination stops once limit is satisfied", async () => {
  let calls = 0;
  const page = await searchLibgenBooks("pride", {
    baseUrl: MIRROR,
    perPage: 2,
    maxPages: 10,
    limit: 3,
    fetch: () => {
      calls += 1;
      return Promise.resolve(htmlResponse(resultTable(AUSTEN_ROW.repeat(2))));
    },
  });

  expect(page.items).toHaveLength(3);
  expect(page.hasMore).toBe(true);
  expect(calls).toBe(2);
});

test("records reach the works lane with unknown availability", () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });
  const record = libgenBookToWorkRecord(page.items[0]!, { baseUrl: MIRROR });

  expect(record.provider).toBe("libgen");
  expect(record.availability).toBe("unknown");
  expect(record.identity.isbn13).toBe("9780141439518");
  expect(record.identity.isbn10).toBe("0141439513");
  expect(record.identity.md5).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f90");
  expect(record.identity.origin).toBe("record");
  expect(record.identity.confidence).toBe(1);
  expect(record.format).toBe("epub");
  expect(record.pageCount).toBe(480);
  expect(record.provenance).toEqual([{ provider: "libgen", url: `${MIRROR}/file.php?id=1234567` }]);
});

test("source search maps a works query onto the right column", async () => {
  const urls: string[] = [];
  const source = libgenSource({
    mirrors: [MIRROR],
    fetch: (input) => {
      urls.push(inputUrl(input));
      return Promise.resolve(htmlResponse(resultTable(AUSTEN_ROW)));
    },
  });

  const byTitle = await source.search({ title: "Pride and Prejudice" });
  expect(byTitle.items).toHaveLength(1);
  expect(new URL(urls[0]!).searchParams.getAll("columns[]")).toEqual(["t"]);

  await source.search({ isbn: "9780141439518" });
  expect(new URL(urls[1]!).searchParams.getAll("columns[]")).toEqual(["i"]);

  await source.search({ author: "Austen" });
  expect(new URL(urls[2]!).searchParams.getAll("columns[]")).toEqual(["a"]);
});

test("source defaults to searching both book partitions", () => {
  const source = libgenSource({ mirrors: [MIRROR] });
  const url = new URL(source.requestUrls({ query: "dune" })[0]!);

  expect(url.searchParams.getAll("topics[]")).toEqual(["l", "f"]);
});

test("searchWorks reports an empty mirror pool as disabled, not as an error", async () => {
  const result = await searchWorks(libgenSource({ mirrors: [] }), { query: "dune" });

  expect(result.status).toBe("disabled");
  expect(result.error?.code).toBe("config");
  expect(result.items).toEqual([]);
  expect(result.warnings[0]).toContain("Library Genesis requires at least one mirror origin");
});

test("a failing mirror falls through to the next and says which", async () => {
  const dialed: string[] = [];
  const source = libgenSource({
    mirrors: ["https://down.example", "https://up.example"],
    fetch: (input) => {
      const url = inputUrl(input);
      dialed.push(new URL(url).origin);
      if (url.startsWith("https://down.example")) return Promise.reject(new Error("connect fail"));
      return Promise.resolve(htmlResponse(resultTable(AUSTEN_ROW)));
    },
  });

  const page = await source.search({ query: "pride and prejudice" });

  expect(dialed).toEqual(["https://down.example", "https://up.example"]);
  expect(page.items).toHaveLength(1);
  expect(page.warnings.some((warning) => warning.includes("down.example"))).toBe(true);
  // Records are attributed to the mirror that actually answered.
  expect(page.items[0]?.url.startsWith("https://up.example")).toBe(true);
});

test("an empty result from a live mirror does not fall through", async () => {
  const dialed: string[] = [];
  const source = libgenSource({
    mirrors: ["https://first.example", "https://second.example"],
    fetch: (input) => {
      dialed.push(new URL(inputUrl(input)).origin);
      return Promise.resolve(htmlResponse("<html><body><h1>Nothing found</h1></body></html>"));
    },
  });

  const page = await source.search({ query: "dune" });

  expect(dialed).toEqual(["https://first.example"]);
  expect(page.items).toEqual([]);
});

test("searchWorks surfaces a blocked mirror as an error", async () => {
  const source = libgenSource({
    mirrors: [MIRROR],
    fetch: () => Promise.resolve(htmlResponse("<html><body>go away</body></html>")),
  });
  const result = await searchWorks(source, { query: "dune" });

  expect(result.status).toBe("disabled");
  expect(result.error?.message).toContain("no recognizable result table");
});

test("download resolution is a separate explicit call", async () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });
  const book = page.items[0]!;
  const mirrorPage = `<html><body>
    <a href="/get.php?md5=a1b2c3d4e5f60718293a4b5c6d7e8f90&key=x">GET</a>
    <a href="https://cf.example/file.epub">Cloudflare</a>
    <a href="https://ipfs.example/file.epub">IPFS.io</a>
    <a href="/faq.php">Help</a>
  </body></html>`;

  const links = await resolveLibgenDownloads(book, {
    baseUrl: MIRROR,
    fetch: () => Promise.resolve(htmlResponse(mirrorPage)),
  });

  expect(links["GET"]).toBe(`${MIRROR}/get.php?md5=a1b2c3d4e5f60718293a4b5c6d7e8f90&key=x`);
  expect(links["Cloudflare"]).toBe("https://cf.example/file.epub");
  expect(links["IPFS.io"]).toBe("https://ipfs.example/file.epub");
  expect(links["Help"]).toBeUndefined();
});

test("download resolution refuses a row with no mirror links", async () => {
  const rowWithoutMirrors = AUSTEN_ROW.replace(
    '<td><a href="/ads.php?md5=A1B2C3D4E5F60718293A4B5C6D7E8F90">[1]</a></td>',
    "<td></td>",
  );
  const page = parseLibgenBooks(resultTable(rowWithoutMirrors), { baseUrl: MIRROR });
  const error = await captureXnewsError(
    resolveLibgenDownloads(page.items[0]!, { baseUrl: MIRROR, fetch: () => Promise.reject() }),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("exposed no mirror links");
});

test("download resolution rejects a blocked mirror page with no file links", async () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });
  const book = page.items[0]!;
  const error = await captureXnewsError(
    resolveLibgenDownloads(book, {
      baseUrl: MIRROR,
      fetch: () =>
        Promise.resolve(
          htmlResponse("<html><body><h1>Just a moment...</h1><form>Sign in</form></body></html>"),
        ),
    }),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("no recognized file links");
  expect(error.url).toBe(book.mirrorUrls[0]!);
});

test("download resolution preserves an explicit no-links state", async () => {
  const page = parseLibgenBooks(resultTable(AUSTEN_ROW), { baseUrl: MIRROR });
  const links = await resolveLibgenDownloads(page.items[0]!, {
    baseUrl: MIRROR,
    fetch: () =>
      Promise.resolve(htmlResponse("<html><body><p>No download links available</p></body></html>")),
  });

  expect(links).toEqual({});
});

test("parseLibgenDownloads ignores navigation links", () => {
  const links = parseLibgenDownloads(
    `<a href="/index.php">Home</a><a href="https://x.example/f.pdf">GET</a>`,
    { baseUrl: MIRROR },
  );

  expect(Object.keys(links)).toEqual(["GET"]);
});

test("upload-info columns become ISO instants", () => {
  const html = `<html><body><table class="c">
    <tr><th>ID</th><th>Author</th><th>Title</th><th>Ext</th><th>Added</th><th>Modified</th><th>Mirrors</th></tr>
    <tr>
      <td>5</td><td>A. Author</td><td><a href="/file.php?id=5">Book</a></td><td>pdf</td>
      <td>2024-03-04 05:06:07</td><td>2024-05-06</td>
      <td><a href="/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">[1]</a></td>
    </tr>
  </table></body></html>`;
  const page = parseLibgenBooks(html, { baseUrl: MIRROR });

  expect(page.items[0]?.addedAt).toBe("2024-03-04T05:06:07.000Z");
  expect(page.items[0]?.modifiedAt).toBe("2024-05-06T00:00:00.000Z");
});

test("unparseable upload-info dates produce warnings", () => {
  const html = `<html><body><table class="c">
    <tr><th>ID</th><th>Author</th><th>Title</th><th>Ext</th><th>Added</th><th>Modified</th><th>Mirrors</th></tr>
    <tr>
      <td>5</td><td>A. Author</td><td><a href="/file.php?id=5">Book</a></td><td>pdf</td>
      <td>yesterday</td><td>2024-99-99</td>
      <td><a href="/ads.php?md5=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">[1]</a></td>
    </tr>
  </table></body></html>`;
  const page = parseLibgenBooks(html, { baseUrl: MIRROR });

  expect(page.items[0]?.addedAt).toBeUndefined();
  expect(page.items[0]?.modifiedAt).toBeUndefined();
  expect(page.warnings).toContain('libgen 5: unparseable added date "yesterday"');
  expect(page.warnings).toContain('libgen 5: unparseable modified date "2024-99-99"');
});

/**
 * The libgen.li `index.php` layout, reproduced from live markup. Its first
 * header cell names four sort keys at once and its title anchor carries a
 * `title` attribute containing a `<br>` — both broke the parser in ways no
 * synthetic fixture had exercised.
 */
const INDEX_LAYOUT_TABLE = `<html><body><table class="table table-striped" id="tablelibgen">
  <tr>
    <th scope="col" class="first_col"><nobr>
      ID <a href="/index.php?order=f_id">&#8597</a>
      Time add. <a href="/index.php?order=time_added">&#8597</a>
      Title <a href="/index.php?order=title">&#8597</a>
      Series <a href="/index.php?order=series">&#8597</a></nobr></th>
    <th scope="col"><nobr>Author(s) <a href="/index.php?order=author">&#8597</a></nobr></th>
    <th scope="col"><nobr>Publisher <a href="/index.php?order=publisher">&#8597</a></nobr></th>
    <th scope="col"><nobr>Year <a href="/index.php?order=year">&#8597</a></nobr></th>
    <th scope="col">Language</th>
    <th scope="col">Pages</th>
    <th scope="col"><nobr>Size <a href="/index.php?order=size">&#8597</a></nobr></th>
    <th scope="col"><nobr>Ext. <a href="/index.php?order=ext">&#8597</a></nobr></th>
    <th scope="col">Mirrors</th>
  </tr>
  <tr>
    <td><b>Dune Messiah 1</b><br><a data-toggle="tooltip" data-html="true" title="Add/Edit : 2021-06-18/2021-06-18; ID: 5957886<br>Dune Messiah_001" href="edition.php?id=5694795">Dune Messiah <i></i></a><br><a data-html="true" title="Add/Edit : 2021-06-18/2021-06-18; ID: 5957886<br>Dune Messiah_001" href="edition.php?id=5694795"><i><font color="green"> 9780441015610; 0441015611</font></a></i></td>
    <td>Herbert, Frank</td>
    <td>Ace Books</td>
    <td>2008</td>
    <td>English</td>
    <td>0</td>
    <td>188 kB</td>
    <td>epub</td>
    <td><a title="libgen" href="/ads.php?md5=d00d7473ebf5afdcf677b188427a479a"><span class="badge">1</span></a></td>
  </tr>
</table></body></html>`;

test("a composite header cell resolves to the column it carries", () => {
  const page = parseLibgenBooks(INDEX_LAYOUT_TABLE, { baseUrl: MIRROR });

  // No positional fallback: the header was understood.
  expect(page.warnings).not.toContain(
    "libgen: no recognizable header row; fell back to the classic positional column layout",
  );
  const book = page.items[0];
  expect(book?.authors).toEqual(["Herbert, Frank"]);
  expect(book?.publisher).toBe("Ace Books");
  expect(book?.year).toBe(2008);
  expect(book?.language).toBe("English");
  expect(book?.extension).toBe("epub");
  // Mirrors label binary units as "kB"; parseByteSize reads them as displayed.
  expect(book?.sizeBytes).toBe(192_512);
});

test("a > inside an attribute value does not leak into the title", () => {
  const page = parseLibgenBooks(INDEX_LAYOUT_TABLE, { baseUrl: MIRROR });

  expect(page.items[0]?.title).toBe("Dune Messiah");
  expect(page.items[0]?.isbns).toEqual(["9780441015610", "0441015611"]);
});

test("a zero page count is absent, not a coercion warning", () => {
  const page = parseLibgenBooks(INDEX_LAYOUT_TABLE, { baseUrl: MIRROR });

  expect(page.items[0]?.pages).toBeUndefined();
  expect(page.warnings.filter((warning) => warning.includes("page count"))).toEqual([]);
});

test("known zero page-count sentinels are absent without a warning", () => {
  // libgen.li writes `0` and `0 / 604` ("none stated / present in file").
  for (const cell of ["0", "0 / 604"]) {
    const row = AUSTEN_ROW.replace("<td>480[12]</td>", `<td>${cell}</td>`);
    const page = parseLibgenBooks(resultTable(row), { baseUrl: MIRROR });

    expect(page.items[0]?.pages).toBeUndefined();
    expect(page.warnings.filter((warning) => warning.includes("page count"))).toEqual([]);
  }
});

test("a page cell with no leading number is still reported", () => {
  const row = AUSTEN_ROW.replace("<td>480[12]</td>", "<td>N/A</td>");
  const page = parseLibgenBooks(resultTable(row), { baseUrl: MIRROR });

  expect(page.warnings.some((warning) => warning.includes("page count"))).toBe(true);
});

test("a malformed leading-zero page cell is reported", () => {
  const row = AUSTEN_ROW.replace("<td>480[12]</td>", "<td>0oops</td>");
  const page = parseLibgenBooks(resultTable(row), { baseUrl: MIRROR });

  expect(page.items[0]?.pages).toBeUndefined();
  expect(page.warnings).toContain('libgen 1234567: unparseable page count "0oops"');
});

test("download links qualify on their target, not their label", () => {
  // A mirror page carries a `Mirrors` heading and sort links whose labels pass
  // any sensible whitelist while pointing at search URLs.
  const links = parseLibgenDownloads(
    `<html><body>
      <a href="/index.php?req=dune">Mirrors</a>
      <a href="/index.php?sort=title">Mirror list</a>
      <a href="/faq.php">GET help</a>
      <a href="/get.php?md5=a1b2c3d4e5f60718293a4b5c6d7e8f90&key=k">GET</a>
      <a href="https://cf.example/file.epub">Cloudflare</a>
    </body></html>`,
    { baseUrl: MIRROR },
  );

  expect(Object.keys(links).toSorted()).toEqual(["Cloudflare", "GET"]);
  expect(links["GET"]).toBe(`${MIRROR}/get.php?md5=a1b2c3d4e5f60718293a4b5c6d7e8f90&key=k`);
});

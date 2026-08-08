import { expect, test } from "bun:test";
import {
  dispositionFileName,
  downloadFile,
  downloadWork,
  resolveWorkFiles,
} from "../src/download.js";
import { XnewsFetchError } from "../src/errors.js";
import type { WorkRecord } from "../src/types.js";

const MD5 = "d00d7473ebf5afdcf677b188427a479a";

function record(overrides: Partial<WorkRecord> = {}): WorkRecord {
  return {
    provider: "libgen",
    sourceId: "1",
    title: "Dune Messiah",
    authors: ["Herbert, Frank"],
    identity: { md5: MD5, origin: "record", confidence: 1 },
    availability: "unknown",
    url: "https://mirror.example/edition.php?id=1",
    warnings: [],
    provenance: [{ provider: "libgen", url: "https://mirror.example/edition.php?id=1" }],
    ...overrides,
  };
}

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
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

test("libgen resolution reads the single-use key off the mirror page", async () => {
  const dialed: string[] = [];
  const files = await resolveWorkFiles(record(), {
    fetch: (input) => {
      dialed.push(inputUrl(input));
      return Promise.resolve(
        new Response(
          `<a href="setlang.php?md5=${MD5}&lang=ru">ru</a>
           <a href="get.php?md5=${MD5}&key=TOKEN123">GET</a>`,
          { headers: { "Content-Type": "text/html" } },
        ),
      );
    },
  });

  // The key is minted per page load, so it cannot be built from the md5.
  expect(dialed[0]).toBe(`https://mirror.example/ads.php?md5=${MD5}`);
  expect(files).toHaveLength(1);
  expect(files[0]?.url).toBe(`https://mirror.example/get.php?md5=${MD5}&key=TOKEN123`);
  expect(files[0]?.label).toBe("GET");
});

test("a record with no content hash resolves to nothing rather than guessing a URL", async () => {
  const files = await resolveWorkFiles(record({ identity: { origin: "record", confidence: 1 } }), {
    fetch: () => Promise.reject(new Error("must not dial")),
  });

  expect(files).toEqual([]);
});

test("open-library hosts no files", async () => {
  const files = await resolveWorkFiles(record({ provider: "open-library" }), {
    fetch: () => Promise.reject(new Error("must not dial")),
  });

  expect(files).toEqual([]);
});

test("internet archive lists downloadable files, best format first", async () => {
  const manifest = JSON.stringify({
    files: [
      { name: "book_meta.xml", format: "Metadata" },
      { name: "book.pdf", format: "Text PDF", size: "24029904" },
      { name: "book.epub", format: "EPUB", size: "1367280" },
      { name: "book_djvu.txt", format: "DjVuTXT", size: "519422" },
      { name: "book_archive.torrent", format: "Archive BitTorrent" },
    ],
  });
  const files = await resolveWorkFiles(
    record({ provider: "internet-archive", sourceId: "dune-item" }),
    { fetch: () => Promise.resolve(new Response(manifest)) },
  );

  expect(files.map((file) => file.format)).toEqual(["epub", "pdf", "txt"]);
  expect(files[0]?.url).toBe("https://archive.org/download/dune-item/book.epub");
  expect(files[0]?.sizeBytes).toBe(1_367_280);
  expect(files.some((file) => file.fileName?.endsWith(".xml"))).toBe(false);
});

test("anna's archive uses the member API when a key is supplied", async () => {
  const dialed: string[] = [];
  const files = await resolveWorkFiles(
    record({ provider: "annas-archive", url: `https://aa.example/md5/${MD5}` }),
    {
      annasArchiveKey: "secret-key",
      fetch: (input) => {
        dialed.push(inputUrl(input));
        return Promise.resolve(
          new Response(JSON.stringify({ download_url: "https://cdn.example/file.epub" })),
        );
      },
    },
  );

  expect(dialed[0]).toContain("/dyn/api/fast_download.json");
  expect(files[0]?.url).toBe("https://cdn.example/file.epub");
});

test("anna's archive surfaces the API's refusal instead of resolving to nothing", async () => {
  const error = await captureXnewsError(
    resolveWorkFiles(record({ provider: "annas-archive", url: `https://aa.example/md5/${MD5}` }), {
      annasArchiveKey: "bad",
      fetch: () =>
        Promise.resolve(new Response(JSON.stringify({ download_url: null, error: "Invalid key" }))),
    }),
  );

  expect(error.message).toContain("Invalid key");
});

test("bytes are returned undecoded", async () => {
  // A PNG header plus a high byte: text decoding would corrupt both.
  const payload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);
  const result = await downloadFile("https://cdn.example/file.bin", {
    fetch: () =>
      Promise.resolve(
        new Response(payload, { headers: { "Content-Type": "application/octet-stream" } }),
      ),
  });

  expect([...result.bytes]).toEqual([...payload]);
  expect(result.sizeBytes).toBe(10);
  expect(result.contentType).toBe("application/octet-stream");
});

test("downloadWork walks candidates and names every failure", async () => {
  let call = 0;
  const error = await captureXnewsError(
    downloadWork(record({ provider: "internet-archive", sourceId: "x" }), {
      fetch: () => {
        call += 1;
        if (call === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ files: [{ name: "a.epub" }, { name: "b.pdf" }] })),
          );
        }
        return Promise.resolve(new Response("nope", { status: 401 }));
      },
    }),
  );

  expect(error.message).toContain("a.epub");
  expect(error.message).toContain("b.pdf");
});

test("a record with no resolvable file is config, not a transport failure", async () => {
  const error = await captureXnewsError(downloadWork(record({ provider: "open-library" })));

  expect(error.code).toBe("config");
});

test("filenames come from the disposition header, preferring the encoded form", () => {
  expect(dispositionFileName(`attachment; filename="Dune Messiah.epub"`)).toBe("Dune Messiah.epub");
  expect(dispositionFileName("attachment; filename=plain.pdf")).toBe("plain.pdf");
  expect(
    dispositionFileName(`attachment; filename="fallback.pdf"; filename*=UTF-8''caf%C3%A9.pdf`),
  ).toBe("café.pdf");
  expect(dispositionFileName(undefined)).toBeUndefined();
});

test("a disposition filename cannot escape into a path", () => {
  expect(dispositionFileName(`attachment; filename="../../etc/passwd"`)).toBe(".._.._etc_passwd");
  expect(dispositionFileName(`attachment; filename="a/b\\c.epub"`)).toBe("a_b_c.epub");
});

test("the filename falls back to the URL basename", async () => {
  const result = await downloadFile("https://cdn.example/files/Dune%20Messiah.epub", {
    fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2]))),
  });

  expect(result.fileName).toBe("Dune Messiah.epub");
});

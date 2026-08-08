import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import { extractText } from "../src/extract.js";

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** Builds a stored-entry ZIP, which is what an EPUB reader must accept. */
function zip(files: Readonly<Record<string, string>>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const sum = crc32(data);

    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04_03_4b_50, true);
    header.setUint16(4, 20, true);
    header.setUint16(8, 0, true); // stored
    header.setUint32(14, sum, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, nameBytes.length, true);
    const headerBytes = new Uint8Array(header.buffer);
    local.push(headerBytes, nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02_01_4b_50, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(10, 0, true);
    entry.setUint32(16, sum, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);

    offset += headerBytes.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06_05_4b_50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const EPUB = zip({
  "META-INF/container.xml": `<?xml version="1.0"?><container><rootfiles>
     <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles></container>`,
  "OEBPS/content.opf": `<?xml version="1.0"?><package>
     <manifest>
       <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
       <item id="two" href="ch2.xhtml" media-type="application/xhtml+xml"/>
       <item id="one" href="ch1.xhtml" media-type="application/xhtml+xml"/>
       <item id="css" href="style.css" media-type="text/css"/>
     </manifest>
     <spine><itemref idref="one"/><itemref idref="two"/></spine>
   </package>`,
  // Manifest order is cover, two, one; spine order is one, two, and cover is
  // not in the spine at all.
  "OEBPS/cover.xhtml": `<html><body><p>COVER IMAGE PAGE</p></body></html>`,
  "OEBPS/ch1.xhtml": `<html><head><title>Chapter One</title><style>p{color:red}</style></head>
     <body><h1>Chapter One</h1><p>He woke &amp; rose.</p></body></html>`,
  "OEBPS/ch2.xhtml": `<html><head><title>Chapter Two</title></head><body><p>Then he left.</p></body></html>`,
  "OEBPS/style.css": `p { color: red }`,
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

test("epub sections follow the spine, not the archive or manifest order", async () => {
  const result = await extractText({ bytes: EPUB, fileName: "book.epub" });

  expect(result.format).toBe("epub");
  expect(result.sections.map((section) => section.title)).toEqual(["Chapter One", "Chapter Two"]);
  // The cover is in the manifest but not the spine, so it is not body text.
  expect(result.text).not.toContain("COVER IMAGE PAGE");
});

test("epub text is decoded, de-tagged, and excludes head content", async () => {
  const result = await extractText({ bytes: EPUB, fileName: "book.epub" });

  expect(result.text).toContain("He woke & rose.");
  expect(result.text).toContain("Then he left.");
  // <style> lives in <head>, which is not reading text.
  expect(result.text).not.toContain("color:red");
  expect(result.characterCount).toBe(result.text.length);
});

test("the container format is sniffed when no filename is given", async () => {
  const result = await extractText({ bytes: EPUB });

  expect(result.format).toBe("epub");
});

test("maxCharacters truncates the joined body", async () => {
  const result = await extractText({ bytes: EPUB, fileName: "book.epub" }, { maxCharacters: 12 });

  expect(result.text).toHaveLength(12);
});

test("plain text passes through", async () => {
  const result = await extractText({
    bytes: encoder.encode("line one\r\nline two\r\n"),
    fileName: "notes.txt",
  });

  expect(result.format).toBe("txt");
  expect(result.text).toBe("line one\nline two");
});

test("only formats with no bundled decoder are refused, and by name", async () => {
  const error = await captureXnewsError(
    extractText({ bytes: new Uint8Array([1, 2, 3]), fileName: "book.djvu" }),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("DjVu");
});

test("a scanned pdf with no OCR configured says so rather than reading as empty", async () => {
  // A structurally valid PDF that declares a page and carries no text.
  const scan = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Page/Parent 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[1 0 R]>>endobj\n%%EOF",
  );
  const error = await captureXnewsError(extractText({ bytes: scan, fileName: "scan.pdf" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("no text layer");
  expect(error.message).toContain("OCR");
});

test("an epub whose spine resolves to nothing throws rather than reading as empty", async () => {
  const broken = zip({
    "META-INF/container.xml": `<container><rootfiles><rootfile full-path="c.opf"/></rootfiles></container>`,
    "c.opf": `<package><manifest><item id="a" href="gone.xhtml"/></manifest>
       <spine><itemref idref="a"/></spine></package>`,
  });
  const error = await captureXnewsError(extractText({ bytes: broken, fileName: "b.epub" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("no readable documents");
});

test("an epub with no container falls back to the .opf entry and says so", async () => {
  const noContainer = zip({
    "book.opf": `<package><manifest><item id="a" href="ch.xhtml"/></manifest>
       <spine><itemref idref="a"/></spine></package>`,
    "ch.xhtml": `<html><body><p>Fallback worked.</p></body></html>`,
  });
  const result = await extractText({ bytes: noContainer, fileName: "b.epub" });

  expect(result.text).toContain("Fallback worked.");
  expect(result.warnings.some((warning) => warning.includes("no usable container.xml"))).toBe(true);
});

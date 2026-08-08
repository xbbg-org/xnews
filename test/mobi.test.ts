import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import { extractText } from "../src/extract.js";
import { decompressPalmDoc } from "../src/mobi.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface PdbFixtureOptions {
  readonly compression: number;
  readonly encryptionType: number;
  readonly textLength: number;
  readonly textRecords: readonly string[];
}

function pdb(options: PdbFixtureOptions): Uint8Array {
  const recordZero = new Uint8Array(84);
  const palmDoc = new DataView(recordZero.buffer);
  palmDoc.setUint16(0, options.compression);
  palmDoc.setUint32(4, options.textLength);
  palmDoc.setUint16(8, options.textRecords.length);
  palmDoc.setUint16(10, 4096);
  palmDoc.setUint16(12, options.encryptionType);
  recordZero.set(encoder.encode("MOBI"), 16);
  palmDoc.setUint32(20, 68);
  palmDoc.setUint32(24, 2);
  palmDoc.setUint32(28, 65001);
  palmDoc.setUint32(80, options.textRecords.length + 1);

  const records = [recordZero, ...options.textRecords.map((text) => encoder.encode(text))];
  const tableEnd = 78 + records.length * 8;
  const offsets: number[] = [];
  let offset = tableEnd;
  for (const record of records) {
    offsets.push(offset);
    offset += record.length;
  }

  const archive = new Uint8Array(offset);
  archive.set(encoder.encode("Synthetic book"), 0);
  archive.set(encoder.encode("BOOK"), 60);
  archive.set(encoder.encode("MOBI"), 64);
  const header = new DataView(archive.buffer);
  header.setUint16(76, records.length);
  for (const [index, recordOffset] of offsets.entries()) {
    header.setUint32(78 + index * 8, recordOffset);
    header.setUint32(78 + index * 8 + 4, index);
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const recordOffset = offsets[index];
    if (record === undefined || recordOffset === undefined) throw new Error("bad PDB fixture");
    archive.set(record, recordOffset);
  }
  return archive;
}

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

/** Builds a stored-entry ZIP, matching the EPUB fixture builder. */
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
    header.setUint16(8, 0, true);
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
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return output;
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

test("PalmDOC LZ77 handles every token form and overlapping back-references", () => {
  const compressed = new Uint8Array([3, 0x61, 0x62, 0x63, 0x64, 0x80, 0x13, 0xc1, 0]);

  expect(decoder.decode(decompressPalmDoc(compressed))).toBe("abcdcdcdcd A\0");
});

test("MOBI concatenates text records and truncates to the PalmDOC text length", async () => {
  const book = pdb({
    compression: 1,
    encryptionType: 0,
    textLength: encoder.encode("<p>First Second").length,
    textRecords: ["<p>First", " Second trailing bytes"],
  });

  const result = await extractText({ bytes: book, fileName: "book.mobi" });

  expect(result.format).toBe("mobi");
  expect(result.text).toBe("First Second");
  expect(result.sections).toEqual([{ href: "section-1", text: "First Second" }]);
});

test("AZW and AZW3 use the PalmDOC compatibility payload", async () => {
  const book = pdb({
    compression: 1,
    encryptionType: 0,
    textLength: encoder.encode("<p>Compatible</p>").length,
    textRecords: ["<p>Compatible</p>"],
  });

  for (const extension of ["azw", "azw3"] as const) {
    const result = await extractText({ bytes: book, fileName: `book.${extension}` });
    expect(result.format).toBe(extension);
    expect(result.text).toBe("Compatible");
  }
});

test("DRM-protected PalmDOC files are refused clearly", async () => {
  const book = pdb({
    compression: 1,
    encryptionType: 1,
    textLength: 1,
    textRecords: ["x"],
  });
  const error = await captureXnewsError(extractText({ bytes: book, fileName: "locked.azw" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("DRM");
});

test("HUFF/CDIC PalmDOC compression is refused clearly", async () => {
  const book = pdb({
    compression: 17480,
    encryptionType: 0,
    textLength: 1,
    textRecords: ["x"],
  });
  const error = await captureXnewsError(extractText({ bytes: book, fileName: "huff.mobi" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("HUFF/CDIC");
});

test("a non-PDB blob cannot be decoded as MOBI", async () => {
  const error = await captureXnewsError(
    extractText({ bytes: new Uint8Array([1, 2, 3]), fileName: "garbage.mobi" }),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("PDB");
});

test("CBZ exposes image pages in natural filename order without inventing text", async () => {
  const comic = zip({
    "page10.jpg": "ten",
    "page2.jpg": "two",
    "cover.png": "cover",
    "notes.txt": "not a page",
  });

  const result = await extractText({ bytes: comic, fileName: "comic.cbz" });

  expect(result.format).toBe("cbz");
  expect(result.sections.map((section) => section.href)).toEqual([
    "cover.png",
    "page2.jpg",
    "page10.jpg",
  ]);
  expect(result.sections.every((section) => section.text === "")).toBe(true);
  expect(result.text).toBe("");
  expect(result.warnings).toEqual(["CBZ archive holds 3 page images and no text layer"]);
});

test("CBR reports that RAR decompression is unavailable", async () => {
  const rar4 = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
  const error = await captureXnewsError(extractText({ bytes: rar4, fileName: "comic.cbr" }));

  expect(error.code).toBe("config");
  expect(error.message).toContain("RAR");
  expect(error.message).toContain("CBZ");
});

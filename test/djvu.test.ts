import { expect, test } from "bun:test";
import { extractDjvuText } from "../src/djvu.js";
import { XnewsFetchError } from "../src/errors.js";
import { extractText } from "../src/extract.js";

const encoder = new TextEncoder();
const MAGIC = new Uint8Array([0x41, 0x54, 0x26, 0x54]);

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function be24(value: number): Uint8Array {
  return new Uint8Array([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

function be32(value: number): Uint8Array {
  return new Uint8Array([
    Math.floor(value / 0x1000000) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

function chunk(id: string, data: Uint8Array): Uint8Array {
  return concatenate([
    encoder.encode(id),
    be32(data.length),
    data,
    ...(data.length % 2 === 0 ? [] : [new Uint8Array(1)]),
  ]);
}

function textChunk(text: string): Uint8Array {
  const bytes = encoder.encode(text);
  return chunk("TXTa", concatenate([be24(bytes.length), bytes]));
}

function pageForm(...chunks: readonly Uint8Array[]): Uint8Array {
  return chunk("FORM", concatenate([encoder.encode("DJVU"), ...chunks]));
}

function singlePage(...chunks: readonly Uint8Array[]): Uint8Array {
  return concatenate([MAGIC, pageForm(...chunks)]);
}

function bundled(...pages: readonly Uint8Array[]): Uint8Array {
  return concatenate([MAGIC, chunk("FORM", concatenate([encoder.encode("DJVM"), ...pages]))]);
}

function base64(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function captureError(promise: Promise<unknown>): Promise<XnewsFetchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof XnewsFetchError) return error;
    throw new Error("Expected XnewsFetchError", { cause: error });
  }
  throw new Error("Expected XnewsFetchError");
}

test("IFF odd-length chunks consume their pad byte before the next chunk", async () => {
  const result = await extractDjvuText(
    singlePage(chunk("JUNK", new Uint8Array([0x7f])), textChunk("found after odd chunk")),
  );

  expect(result.text).toBe("found after odd chunk");
});

test("TXTa decodes its declared UTF-8 bytes exactly", async () => {
  const result = await extractDjvuText(singlePage(textChunk("DjVu café 漢字")));

  expect(result.pages).toEqual([{ href: "page/1", text: "DjVu café 漢字" }]);
  expect(result.text).toBe("DjVu café 漢字");
});

test("bundled FORM:DJVM pages preserve component order", async () => {
  const result = await extractDjvuText(
    bundled(pageForm(textChunk("first page")), pageForm(textChunk("second page"))),
  );

  expect(result.pages.map((page) => [page.href, page.text])).toEqual([
    ["page/1", "first page"],
    ["page/2", "second page"],
  ]);
  expect(result.text).toBe("first page\n\nsecond page");
});

test("non-DjVu input throws a config error", async () => {
  const error = await captureError(extractDjvuText(encoder.encode("not a DjVu file")));

  expect(error.code).toBe("config");
  expect(error.message).toContain("DjVu");
});

test("a DjVu page without hidden text asks for OCR", async () => {
  const error = await captureError(extractDjvuText(singlePage(chunk("INFO", new Uint8Array(0)))));

  expect(error.code).toBe("config");
  expect(error.message).toContain("no text layer");
  expect(error.message).toContain("OCR");
});

test("magic-byte sniffing routes DjVu through extractText", async () => {
  const result = await extractText({ bytes: singlePage(textChunk("sniffed")) });

  expect(result.format).toBe("djvu");
  expect(result.text).toBe("sniffed");
});

test("TXTz decodes a genuine BZZ-compressed page from the DjVu v3 specification", async () => {
  // Page 60's complete 300-byte TXTz payload from https://www.sndjvu.org/DjVu3Spec.djvu.
  const compressed = base64(
    "//0CiD9SSiavtZparkS7u7THjxop7wZDifPsJFWKRdcM5ZaI+jhxVPoM2pezbgZFc098Ibp99ob9itfooQsDYM6wZXC/p7fu7/TowVdyjrzEZJxaNVdoGDCUJYQxKflIx7vb+EA6zjSxwMjvtS2FUhArwRCE9jm7My9YIX0ZpAala8u9gg5m3j8ADKsDHN4WwnrIaR0p1SzSYgNt4M0ZsXXVHD6lzYve3xylB9nN3osp7XjnnGXm4Eoy1Ell3MV9Cvvq0ktIdiXAvnx/0t2rRSlj9eT/m8wlxmP4VdmGc08Irgjc214lEte2+AII53GnPPDabb9qXnlzt3VdV2plDB3LzycOtFm1zrzVyHQYF59MMjGHNeSHLMdt2P99nIFMcVSCaH7Q2II0Vnt/",
  );
  const result = await extractDjvuText(singlePage(chunk("TXTz", compressed)));

  expect(result.text).toContain("Decoder for Z");
  expect(result.text).toContain("through mode");
});

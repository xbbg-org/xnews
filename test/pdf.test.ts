import { expect, test } from "bun:test";
import { XnewsFetchError } from "../src/errors.js";
import { extractPdfImages, extractPdfText } from "../src/pdf.js";

/** Byte-exact: the parser reads latin1, so UTF-8 would corrupt high bytes. */
function bytes(value: string): Uint8Array {
  const out = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) out[index] = value.charCodeAt(index) & 0xff;
  return out;
}

/** Assembles a PDF from object bodies; the scanner does not need a valid xref. */
function pdf(objects: readonly string[], trailer = "trailer<</Root 1 0 R>>"): Uint8Array {
  const body = objects.map((object, index) => `${index + 1} 0 obj\n${object}\nendobj\n`).join("");
  return bytes(`%PDF-1.4\n${body}${trailer}\n%%EOF`);
}

function contentStream(operators: string): string {
  return `<</Length ${operators.length}>>\nstream\n${operators}\nendstream`;
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

const ONE_PAGE = ["<</Type/Pages/Kids[2 0 R]>>", "<</Type/Page/Parent 1 0 R/Contents 3 0 R>>"];

test("reads a literal string out of a text object", async () => {
  const result = await extractPdfText(pdf([...ONE_PAGE, contentStream("BT (Hello World) Tj ET")]));

  expect(result.pages).toHaveLength(1);
  expect(result.text).toBe("Hello World");
});

test("decodes escapes and octal codes in literal strings", async () => {
  const file = pdf([...ONE_PAGE, contentStream(String.raw`BT (A\(B\) C\\D \101\102) Tj ET`)]);

  // \101 and \102 are octal for A and B.
  expect((await extractPdfText(file)).text).toBe("A(B) C\\D AB");
});

test("hex strings are read two nibbles per byte", async () => {
  const file = pdf([...ONE_PAGE, contentStream("BT <48656C6C6F> Tj ET")]);

  expect((await extractPdfText(file)).text).toBe("Hello");
});

test("a large negative kern inside TJ becomes a space", async () => {
  // -250 is a word gap; -10 is ordinary letter kerning and must not split.
  const file = pdf([...ONE_PAGE, contentStream("BT [(Hel) -10 (lo) -250 (World)] TJ ET")]);

  expect((await extractPdfText(file)).text).toBe("Hello World");
});

test("line-positioning operators break lines", async () => {
  const file = pdf([
    ...ONE_PAGE,
    contentStream("BT (first) Tj 0 -14 Td (second) Tj T* (third) Tj ET"),
  ]);

  expect((await extractPdfText(file)).text).toBe("first\nsecond\nthird");
});

test("a ToUnicode bfchar map remaps glyph codes", async () => {
  const cmap = "beginbfchar\n<0001> <0048>\n<0002> <0069>\nendbfchar";
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Contents 3 0 R/Resources<</Font<</F1 4 0 R>>>>>>",
    contentStream("BT /F1 12 Tf <00010002> Tj ET"),
    "<</Type/Font/Subtype/Type0/ToUnicode 5 0 R>>",
    `<</Length ${cmap.length}>>\nstream\n${cmap}\nendstream`,
  ]);

  // Without the CMap these codes would surface as control characters.
  expect((await extractPdfText(file)).text).toBe("Hi");
});

test("a bfrange maps a contiguous block of codes", async () => {
  const cmap = "beginbfrange\n<0041> <0043> <0061>\nendbfrange";
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Contents 3 0 R/Resources<</Font<</F1 4 0 R>>>>>>",
    contentStream("BT /F1 12 Tf (ABC) Tj ET"),
    "<</Type/Font/ToUnicode 5 0 R>>",
    `<</Length ${cmap.length}>>\nstream\n${cmap}\nendstream`,
  ]);

  expect((await extractPdfText(file)).text).toBe("abc");
});

test("pages come back in page-tree order, not file order", async () => {
  const file = pdf([
    "<</Type/Pages/Kids[3 0 R 2 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Contents 4 0 R>>",
    "<</Type/Page/Parent 1 0 R/Contents 5 0 R>>",
    contentStream("BT (second in tree) Tj ET"),
    contentStream("BT (first in tree) Tj ET"),
  ]);
  const result = await extractPdfText(file);

  expect(result.pages.map((entry) => entry.text)).toEqual(["first in tree", "second in tree"]);
});
test("resources are inherited from the parent page node", async () => {
  const cmap = "beginbfchar\n<01> <005A>\nendbfchar";
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R]/Resources<</Font<</F1 4 0 R>>>>>>",
    // The page itself states no /Resources.
    "<</Type/Page/Parent 1 0 R/Contents 3 0 R>>",
    contentStream("BT /F1 12 Tf <01> Tj ET"),
    "<</Type/Font/ToUnicode 5 0 R>>",
    `<</Length ${cmap.length}>>\nstream\n${cmap}\nendstream`,
  ]);

  expect((await extractPdfText(file)).text).toBe("Z");
});

test("a page carrying no text is reported, not silently dropped", async () => {
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R 3 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Contents 4 0 R>>",
    "<</Type/Page/Parent 1 0 R/Contents 5 0 R>>",
    contentStream("BT (only page with words) Tj ET"),
    contentStream("0 0 100 100 re f"),
  ]);
  const result = await extractPdfText(file);

  expect(result.pages).toHaveLength(1);
  expect(result.warnings.some((warning) => warning.includes("1 of 2 page(s)"))).toBe(true);
});

test("a scan throws instead of returning an empty string", async () => {
  const error = await captureXnewsError(
    extractPdfText(pdf(["<</Type/Pages/Kids[2 0 R]>>", "<</Type/Page/Parent 1 0 R>>"])),
  );

  expect(error.code).toBe("config");
  expect(error.message).toContain("no text layer");
  expect(error.message).toContain("OCR");
});

test("an encrypted pdf is refused rather than yielding ciphertext", async () => {
  const file = pdf(
    [...ONE_PAGE, contentStream("BT (x) Tj ET")],
    "trailer<</Encrypt 9 0 R/Root 1 0 R>>",
  );

  expect((await captureXnewsError(extractPdfText(file))).message).toContain("encrypted");
});

test("a non-pdf is rejected on its header", async () => {
  const error = await captureXnewsError(extractPdfText(bytes("PK\u0003\u0004nope")));

  expect(error.message).toContain("%PDF-");
});

test("page images come out in the encoding the pdf already stores", async () => {
  // A JPEG SOI stands in for the payload; the extractor copies bytes verbatim.
  const jpeg = "\u00ff\u00d8\u00ff\u00e0JFIF-BODY";
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Resources<</XObject<</Im0 3 0 R>>>>>>",
    `<</Subtype/Image/Width 1964/Height 3077/Filter/DCTDecode/Length ${jpeg.length}>>\nstream\n${jpeg}\nendstream`,
  ]);
  const { images, warnings } = await extractPdfImages(file);

  expect(warnings).toEqual([]);
  expect(images).toHaveLength(1);
  expect(images[0]?.mediaType).toBe("image/jpeg");
  expect(images[0]?.width).toBe(1964);
  expect(images[0]?.page).toBe(1);
  expect(Array.from((images[0]?.bytes ?? []).slice(0, 2))).toEqual([0xff, 0xd8]);
});

test("an image needing a codec is named rather than silently skipped", async () => {
  const file = pdf([
    "<</Type/Pages/Kids[2 0 R]>>",
    "<</Type/Page/Parent 1 0 R/Resources<</XObject<</Im0 3 0 R>>>>>>",
    "<</Subtype/Image/Width 10/Height 10/Filter/CCITTFaxDecode/Length 4>>\nstream\nabcd\nendstream",
  ]);
  const { images, warnings } = await extractPdfImages(file);

  expect(images).toEqual([]);
  expect(warnings[0]).toContain("CCITTFaxDecode");
});

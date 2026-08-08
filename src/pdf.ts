/**
 * PDF text extraction, dependency-free.
 *
 * This reads the text layer; it does not render and it does not OCR. The
 * strategy is deliberately structural rather than xref-driven: real files from
 * these catalogs have broken, hybrid, or stream-based cross-reference tables,
 * so objects are collected by scanning for `N G obj … endobj` and then
 * expanding every `/ObjStm` compressed object stream. Two of three sample
 * files from arXiv, BIS, and the Internet Archive carry 30+ object streams, so
 * skipping them would lose most of the document.
 *
 * Character mapping comes from each font's `/ToUnicode` CMap when present.
 * Without one, a simple font's bytes are read as WinAnsi and a composite font
 * is reported as lossy rather than silently emitting the wrong glyphs.
 */

import { XnewsFetchError } from "./errors.js";
import { inflateCapped, InflateLimitError } from "./inflate.js";

export interface PdfPageText {
  /** 1-based page number in document order. */
  readonly page: number;
  readonly text: string;
}

export interface PdfText {
  readonly pages: readonly PdfPageText[];
  readonly text: string;
  readonly warnings: readonly string[];
}

/** One embedded page image, in the encoding the PDF already stores. */
export interface PdfPageImage {
  /** 1-based page number in document order. */
  readonly page: number;
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly width?: number;
  readonly height?: number;
}

/** Bytes map 1:1 onto code units, so string offsets stay byte offsets. */
const latin1 = new TextDecoder("latin1");

/**
 * Extracts the text layer. Throws a `config`-coded `XnewsFetchError` when the
 * file is encrypted or carries no text at all, because an empty string is
 * indistinguishable from a blank document.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith("%PDF-")) {
    throw new XnewsFetchError("config", "Not a PDF: missing %PDF- header", { url: "" });
  }

  const warnings: string[] = [];
  const objects = collectObjects(bytes, raw);
  await expandObjectStreams(objects, warnings);

  if (isEncrypted(raw, objects)) {
    throw new XnewsFetchError("config", "PDF is encrypted; decryption is not implemented", {
      url: "",
    });
  }

  const pages = findPages(objects);
  if (pages.length === 0) {
    throw new XnewsFetchError("config", "PDF declares no page objects", { url: "" });
  }

  const fontCache = new Map<string, CharacterMap>();
  const out: PdfPageText[] = [];
  for (const [index, page] of pages.entries()) {
    const content = await pageContent(page, objects, warnings);
    if (content === undefined) continue;
    const fonts = await pageFonts(page, objects, fontCache, warnings);
    const text = renderTextOperators(content, fonts);
    if (text.trim() !== "") out.push({ page: index + 1, text });
  }

  if (out.length === 0) {
    throw new XnewsFetchError(
      "config",
      `PDF has no text layer across ${pages.length} page(s); it is most likely a scan and needs OCR`,
      { url: "" },
    );
  }
  if (out.length < pages.length) {
    warnings.push(`pdf: ${pages.length - out.length} of ${pages.length} page(s) carried no text`);
  }

  return { pages: out, text: out.map((entry) => entry.text).join("\n\n"), warnings };
}

/** One indirect object: its dictionary source and raw stream bytes. */
interface PdfObject {
  readonly dictionary: string;
  readonly stream?: Uint8Array;
}

/**
 * Collects every `N G obj … endobj`. Scanning beats following the xref table:
 * a rebuilt, hybrid, or damaged table is common and this cannot be misled by
 * one.
 */
function collectObjects(bytes: Uint8Array, raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  for (const match of raw.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const number = Number(match[1]);
    const start = (match.index ?? 0) + match[0].length;
    const end = raw.indexOf("endobj", start);
    if (end === -1) continue;
    const body = raw.slice(start, end);

    const streamAt = body.indexOf("stream");
    if (streamAt === -1) {
      objects.set(number, { dictionary: body });
      continue;
    }
    // `stream` is followed by CRLF or LF, never CR alone.
    let dataStart = start + streamAt + "stream".length;
    if (raw[dataStart] === "\r") dataStart += 1;
    if (raw[dataStart] === "\n") dataStart += 1;

    const dictionary = body.slice(0, streamAt);
    const declared = declaredLength(dictionary, objects, raw);
    const dataEnd =
      declared !== undefined && dataStart + declared <= end
        ? dataStart + declared
        : findEndstream(raw, dataStart, end);
    objects.set(number, { dictionary, stream: bytes.subarray(dataStart, dataEnd) });
  }
  return objects;
}

/** `/Length` may itself be an indirect reference resolved later in the file. */
function declaredLength(
  dictionary: string,
  objects: ReadonlyMap<number, PdfObject>,
  raw: string,
): number | undefined {
  const direct = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dictionary)?.[1];
  if (direct !== undefined) return Number(direct);
  const reference = /\/Length\s+(\d+)\s+\d+\s+R/.exec(dictionary)?.[1];
  if (reference === undefined) return undefined;
  const resolved = objects.get(Number(reference))?.dictionary;
  if (resolved !== undefined) return Number(/(-?\d+)/.exec(resolved)?.[1] ?? Number.NaN);
  // Forward reference: read it straight out of the file.
  const pattern = new RegExp(String.raw`\b${reference}\s+\d+\s+obj\s*(\d+)`);
  const found = pattern.exec(raw)?.[1];
  return found === undefined ? undefined : Number(found);
}

function findEndstream(raw: string, from: number, limit: number): number {
  const at = raw.indexOf("endstream", from);
  if (at === -1 || at > limit) return limit;
  let end = at;
  if (raw[end - 1] === "\n") end -= 1;
  if (raw[end - 1] === "\r") end -= 1;
  return end;
}

/**
 * PDF 1.5+ packs most non-stream objects into `/ObjStm` streams. Their
 * contents are invisible to a plain `obj` scan, so they are unpacked here and
 * merged into the same table.
 */
async function expandObjectStreams(
  objects: Map<number, PdfObject>,
  warnings: string[],
): Promise<void> {
  // Snapshot: unpacked objects are added to `objects` inside this loop.
  const packed = Array.from(objects.values());
  for (const object of packed) {
    if (!/\/Type\s*\/ObjStm/.test(object.dictionary) || object.stream === undefined) continue;
    const count = Number(/\/N\s+(\d+)/.exec(object.dictionary)?.[1] ?? "0");
    const first = Number(/\/First\s+(\d+)/.exec(object.dictionary)?.[1] ?? "0");
    if (count === 0) continue;

    let decoded: Uint8Array;
    try {
      decoded = await decodeStream(object);
    } catch (error) {
      warnings.push(
        `pdf: could not inflate an object stream (${error instanceof Error ? error.message : "unknown"})`,
      );
      continue;
    }
    const text = latin1.decode(decoded);
    const header = text.slice(0, first).trim().split(/\s+/);
    for (let index = 0; index < count; index += 1) {
      const number = Number(header[index * 2]);
      const offset = Number(header[index * 2 + 1]);
      if (!Number.isFinite(number) || !Number.isFinite(offset)) continue;
      const nextOffset = index + 1 < count ? Number(header[(index + 1) * 2 + 1]) : undefined;
      const body = text.slice(
        first + offset,
        nextOffset === undefined ? text.length : first + nextOffset,
      );
      // A scanned object wins over a packed one only if it has a stream.
      if (!objects.has(number)) objects.set(number, { dictionary: body });
    }
  }
}

/** `/Encrypt` in a trailer means every string and stream is enciphered. */
function isEncrypted(raw: string, objects: ReadonlyMap<number, PdfObject>): boolean {
  if (/trailer[\s\S]{0,600}?\/Encrypt\b/.test(raw)) return true;
  for (const object of objects.values()) {
    if (/\/Type\s*\/XRef/.test(object.dictionary) && /\/Encrypt\b/.test(object.dictionary)) {
      return true;
    }
  }
  return false;
}

/**
 * Pages in document order. The page tree is walked from `/Type /Pages` roots
 * so `/Kids` order is preserved; a file with no walkable tree falls back to
 * scan order, which matches the file layout of every linearized producer.
 */
function findPages(objects: ReadonlyMap<number, PdfObject>): readonly number[] {
  const pageNumbers = [...objects]
    .filter(([, object]) => /\/Type\s*\/Page\b(?!s)/.test(object.dictionary))
    .map(([number]) => number);
  const pages = new Set(pageNumbers);
  if (pages.size === 0) return [];

  const roots = [...objects]
    .filter(
      ([, object]) =>
        /\/Type\s*\/Pages\b/.test(object.dictionary) && !/\/Parent\b/.test(object.dictionary),
    )
    .map(([number]) => number);

  const ordered: number[] = [];
  const seen = new Set<number>();
  const walk = (number: number, depth: number): void => {
    if (depth > 64 || seen.has(number)) return;
    seen.add(number);
    const object = objects.get(number);
    if (object === undefined) return;
    if (pages.has(number)) {
      ordered.push(number);
      return;
    }
    const kids = /\/Kids\s*\[([\s\S]*?)\]/.exec(object.dictionary)?.[1] ?? "";
    for (const kid of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(kid[1]), depth + 1);
  };
  for (const root of roots) walk(root, 0);

  for (const number of pageNumbers) if (!ordered.includes(number)) ordered.push(number);
  return ordered;
}

/**
 * Extracts the page images a scanned PDF is made of, without rasterizing.
 *
 * A scan stores each page as one image XObject, and for the dominant encoding
 * (`/DCTDecode`) the stream bytes already *are* a JPEG file — a live sample of
 * an 83-page Internet Archive scan was 83 DCTDecode images, byte-identical to
 * valid JFIF once sliced out. That makes OCR reachable without a PDF renderer.
 * Encodings needing a real codec are reported by name instead of guessed at.
 */
export async function extractPdfImages(
  bytes: Uint8Array,
): Promise<{ readonly images: readonly PdfPageImage[]; readonly warnings: readonly string[] }> {
  const raw = latin1.decode(bytes);
  if (!raw.startsWith("%PDF-")) {
    throw new XnewsFetchError("config", "Not a PDF: missing %PDF- header", { url: "" });
  }
  const warnings: string[] = [];
  const objects = collectObjects(bytes, raw);
  await expandObjectStreams(objects, warnings);

  const images: PdfPageImage[] = [];
  const unsupported = new Set<string>();
  for (const [index, pageNumber] of findPages(objects).entries()) {
    const resources = resolveResources(pageNumber, objects) ?? "";
    const xobjects = /\/XObject\s*(<<[\s\S]*?>>|\d+\s+\d+\s+R)/.exec(resources)?.[1] ?? "";
    const dictionary = xobjects.startsWith("<<")
      ? xobjects
      : (objects.get(Number(/(\d+)\s+\d+\s+R/.exec(xobjects)?.[1]))?.dictionary ?? "");

    for (const reference of dictionary.matchAll(/\/[^\s/<>[\]()]+\s+(\d+)\s+\d+\s+R/g)) {
      const object = objects.get(Number(reference[1]));
      if (object?.stream === undefined || !/\/Subtype\s*\/Image/.test(object.dictionary)) continue;
      const mediaType = imageMediaType(object.dictionary);
      if (mediaType === undefined) {
        unsupported.add(/\/(\w+)Decode\b/.exec(object.dictionary)?.[1] ?? "unfiltered");
        continue;
      }
      const width = Number(/\/Width\s+(\d+)/.exec(object.dictionary)?.[1] ?? Number.NaN);
      const height = Number(/\/Height\s+(\d+)/.exec(object.dictionary)?.[1] ?? Number.NaN);
      images.push({
        page: index + 1,
        bytes: object.stream,
        mediaType,
        ...(Number.isFinite(width) ? { width } : {}),
        ...(Number.isFinite(height) ? { height } : {}),
      });
    }
  }

  for (const filter of unsupported) {
    warnings.push(`pdf: skipped page image(s) encoded with /${filter}Decode, which needs a codec`);
  }
  return { images, warnings };
}

/**
 * Only encodings whose stream bytes are already a standalone image file are
 * usable without a codec. `/FlateDecode` yields a raw bitmap that would have
 * to be re-encoded, and CCITT/JBIG2 need real decoders.
 */
function imageMediaType(dictionary: string): string | undefined {
  if (/\/DCTDecode\b/.test(dictionary)) return "image/jpeg";
  if (/\/JPXDecode\b/.test(dictionary)) return "image/jp2";
  return undefined;
}

async function pageContent(
  pageNumber: number,
  objects: ReadonlyMap<number, PdfObject>,
  warnings: string[],
): Promise<string | undefined> {
  const page = objects.get(pageNumber);
  if (page === undefined) return undefined;
  const contents = /\/Contents\s*(\[[\s\S]*?\]|\d+\s+\d+\s+R)/.exec(page.dictionary)?.[1];
  if (contents === undefined) return undefined;

  const parts: string[] = [];
  for (const reference of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
    const object = objects.get(Number(reference[1]));
    if (object?.stream === undefined) continue;
    try {
      parts.push(latin1.decode(await decodeStream(object)));
    } catch (error) {
      warnings.push(
        `pdf: page ${pageNumber} content stream failed to decode (${error instanceof Error ? error.message : "unknown"})`,
      );
    }
  }
  return parts.length === 0 ? undefined : parts.join("\n");
}

/**
 * A page's fonts by resource name. `composite` comes from `/Subtype /Type0`,
 * not from the code values: a composite font addresses glyphs with two-byte
 * codes even when those codes are small, so inferring it from the map's keys
 * misreads `<0001>` as two single-byte codes.
 */
interface FontMap {
  readonly codes: ReadonlyMap<number, string>;
  readonly composite: boolean;
}
type CharacterMap = ReadonlyMap<string, FontMap>;

async function pageFonts(
  pageNumber: number,
  objects: ReadonlyMap<number, PdfObject>,
  cache: Map<string, CharacterMap>,
  warnings: string[],
): Promise<CharacterMap> {
  const cached = cache.get(String(pageNumber));
  if (cached !== undefined) return cached;

  const resources = resolveResources(pageNumber, objects);
  const fontBlock = /\/Font\s*(<<[\s\S]*?>>|\d+\s+\d+\s+R)/.exec(resources ?? "")?.[1] ?? "";
  const inlineDictionary = fontBlock.startsWith("<<")
    ? fontBlock
    : (objects.get(Number(/(\d+)\s+\d+\s+R/.exec(fontBlock)?.[1]))?.dictionary ?? "");

  const map = new Map<string, FontMap>();
  for (const entry of inlineDictionary.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const name = entry[1];
    const font = objects.get(Number(entry[2]));
    if (name === undefined || font === undefined) continue;
    map.set(name, await fontCharacterMap(font, objects, warnings));
  }
  cache.set(String(pageNumber), map);
  return map;
}

/** `/Resources` is inheritable, so an absent one is looked up through parents. */
function resolveResources(
  pageNumber: number,
  objects: ReadonlyMap<number, PdfObject>,
): string | undefined {
  let current: number | undefined = pageNumber;
  for (let depth = 0; depth < 32 && current !== undefined; depth += 1) {
    const object: PdfObject | undefined = objects.get(current);
    if (object === undefined) return undefined;
    const direct = /\/Resources\s*(<<[\s\S]*?>>)/.exec(object.dictionary)?.[1];
    if (direct !== undefined) return direct;
    const reference = /\/Resources\s+(\d+)\s+\d+\s+R/.exec(object.dictionary)?.[1];
    if (reference !== undefined) return objects.get(Number(reference))?.dictionary;
    current = Number(/\/Parent\s+(\d+)\s+\d+\s+R/.exec(object.dictionary)?.[1] ?? Number.NaN);
    if (!Number.isFinite(current)) return undefined;
  }
  return undefined;
}

async function fontCharacterMap(
  font: PdfObject,
  objects: ReadonlyMap<number, PdfObject>,
  warnings: string[],
): Promise<FontMap> {
  const composite = /\/Subtype\s*\/Type0\b/.test(font.dictionary);
  const toUnicode = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(font.dictionary)?.[1];
  if (toUnicode !== undefined) {
    const stream = objects.get(Number(toUnicode));
    if (stream?.stream !== undefined) {
      try {
        return { codes: parseToUnicode(latin1.decode(await decodeStream(stream))), composite };
      } catch (error) {
        warnings.push(
          `pdf: a ToUnicode CMap failed to decode (${error instanceof Error ? error.message : "unknown"})`,
        );
      }
    }
  }
  if (composite) {
    warnings.push(
      "pdf: a composite font states no ToUnicode CMap; its glyph codes cannot be mapped to characters",
    );
  }
  return { codes: new Map(), composite };
}

/** `beginbfchar`/`beginbfrange` sections of a ToUnicode CMap. */
function parseToUnicode(cmap: string): ReadonlyMap<number, string> {
  const map = new Map<number, string>();

  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? "").matchAll(/<([\da-f]+)>\s*<([\da-f]*)>/gi)) {
      const code = Number.parseInt(pair[1] ?? "", 16);
      const value = utf16beToString(pair[2] ?? "");
      if (Number.isFinite(code) && value !== "") map.set(code, value);
    }
  }

  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? "";
    // `<lo> <hi> [<a> <b> …]` enumerates one destination per code.
    for (const entry of body.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*\[([\s\S]*?)\]/gi)) {
      const low = Number.parseInt(entry[1] ?? "", 16);
      let offset = 0;
      for (const item of (entry[3] ?? "").matchAll(/<([\da-f]*)>/gi)) {
        const value = utf16beToString(item[1] ?? "");
        if (value !== "") map.set(low + offset, value);
        offset += 1;
      }
    }
    // `<lo> <hi> <start>` walks the destination alongside the code.
    for (const entry of body.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
      const low = Number.parseInt(entry[1] ?? "", 16);
      const high = Number.parseInt(entry[2] ?? "", 16);
      const startHex = entry[3] ?? "";
      const start = Number.parseInt(startHex, 16);
      if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(start)) continue;
      // Surrogate pairs increment the low unit only.
      const width = startHex.length > 4 ? 2 : 1;
      for (let code = low; code <= high && code - low < 65_536; code += 1) {
        const value =
          width === 1
            ? String.fromCodePoint(start + (code - low))
            : utf16beToString((start + (code - low)).toString(16).padStart(startHex.length, "0"));
        if (value !== "") map.set(code, value);
      }
    }
  }
  return map;
}

function utf16beToString(hex: string): string {
  let out = "";
  for (let index = 0; index + 3 < hex.length + 1; index += 4) {
    const unit = Number.parseInt(hex.slice(index, index + 4), 16);
    if (Number.isFinite(unit)) out += String.fromCharCode(unit);
  }
  return out;
}

/**
 * Walks the content stream's text operators.
 *
 * Only the operators that place characters matter: `Tf` selects the font whose
 * map decodes subsequent strings, `Tj`/`'`/`"`/`TJ` emit them, and the
 * positioning operators are read purely to decide where lines break. Kerning
 * numbers inside `TJ` are how most producers encode a space, so a large
 * negative adjustment becomes one.
 */
function renderTextOperators(content: string, fonts: CharacterMap): string {
  const lines: string[] = [];
  let line = "";
  let font: FontMap | undefined;

  const flush = (): void => {
    const trimmed = line.replaceAll(/[ \t]+/g, " ").trim();
    if (trimmed !== "") lines.push(trimmed);
    line = "";
  };

  for (const block of content.matchAll(/BT\b([\s\S]*?)\bET\b/g)) {
    const body = block[1] ?? "";
    for (const token of body.matchAll(
      /\/([^\s/<>[\]()]+)\s+[\d.]+\s+Tf|\[((?:[^\]\\]|\\.)*)\]\s*TJ|(\((?:[^()\\]|\\.|\([^()]*\))*\)|<[\da-fA-F\s]*>)\s*(Tj|'|")|(T\*|Td|TD|TL)/g,
    )) {
      if (token[1] !== undefined) {
        font = fonts.get(token[1]);
        continue;
      }
      if (token[2] !== undefined) {
        for (const item of token[2].matchAll(
          /(\((?:[^()\\]|\\.)*\)|<[\da-fA-F\s]*>)|(-?[\d.]+)/g,
        )) {
          if (item[1] !== undefined) line += decodeShownString(item[1], font);
          else if (Number(item[2]) < -100) line += " ";
        }
        continue;
      }
      if (token[3] !== undefined) {
        if (token[4] !== "Tj") flush();
        line += decodeShownString(token[3], font);
        continue;
      }
      if (token[5] !== undefined) flush();
    }
    flush();
  }

  return lines.join("\n");
}

/** `(literal)` with escapes, or `<hex>`. */
function decodeShownString(token: string, font: FontMap | undefined): string {
  const composite = font?.composite ?? false;
  const codes: number[] = [];
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replaceAll(/\s+/g, "");
    const width = composite ? 4 : 2;
    for (let index = 0; index < hex.length; index += width) {
      const value = Number.parseInt(hex.slice(index, index + width).padEnd(width, "0"), 16);
      if (Number.isFinite(value)) codes.push(value);
    }
  } else {
    const body = token.slice(1, -1);
    for (let index = 0; index < body.length; index += 1) {
      const character = body[index] ?? "";
      if (character !== "\\") {
        codes.push(character.charCodeAt(0));
        continue;
      }
      const next = body[index + 1] ?? "";
      index += 1;
      const simple = ESCAPES[next];
      if (simple !== undefined) {
        codes.push(simple);
        continue;
      }
      if (/[0-7]/.test(next)) {
        let octal = next;
        while (octal.length < 3 && /[0-7]/.test(body[index + 1] ?? "")) {
          octal += body[index + 1];
          index += 1;
        }
        codes.push(Number.parseInt(octal, 8));
        continue;
      }
      // A backslash-newline is a line continuation and emits nothing.
      if (next !== "\n" && next !== "\r") codes.push(next.charCodeAt(0));
    }
    if (composite) {
      const wide: number[] = [];
      for (let index = 0; index + 1 < codes.length; index += 2) {
        wide.push(((codes[index] ?? 0) << 8) | (codes[index + 1] ?? 0));
      }
      return mapCodes(wide, font?.codes);
    }
  }
  return mapCodes(codes, font?.codes);
}

const ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  b: 0x08,
  f: 0x0c,
  "(": 0x28,
  ")": 0x29,
  "\\": 0x5c,
};

/**
 * Without a ToUnicode map a simple font's codes are read as WinAnsi, which
 * agrees with Latin-1 for every printable code except the 0x80–0x9f block.
 */
function mapCodes(codes: readonly number[], font: ReadonlyMap<number, string> | undefined): string {
  let out = "";
  for (const code of codes) {
    const mapped = font?.get(code);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += WINANSI_HIGH[code] ?? String.fromCharCode(code);
  }
  return out;
}

/** The 0x80–0x9f range where WinAnsi and Latin-1 disagree. */
const WINANSI_HIGH: Readonly<Record<number, string>> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

/**
 * Applies the stream's filter chain. FlateDecode is effectively universal for
 * text content; image codecs are irrelevant here because an image carries no
 * text layer.
 */
async function decodeStream(object: PdfObject): Promise<Uint8Array> {
  if (object.stream === undefined) return new Uint8Array();
  const filters = [...object.dictionary.matchAll(/\/(\w+)Decode\b/g)].map((match) => match[1]);
  let bytes = object.stream;

  for (const filter of filters) {
    if (filter === "Flate") bytes = await inflate(bytes);
    else if (filter === "ASCIIHex") bytes = asciiHexDecode(bytes);
    else if (filter === "ASCII85") bytes = ascii85Decode(bytes);
    else if (filter === "RunLength") bytes = runLengthDecode(bytes);
    else {
      // DCT, JPX, CCITTFax and friends are image codecs; the caller only
      // reaches this for a content or CMap stream, so stop rather than guess.
      throw new Error(`unsupported filter /${filter}Decode`);
    }
  }

  const predictor = Number(/\/Predictor\s+(\d+)/.exec(object.dictionary)?.[1] ?? "1");
  if (predictor >= 10) {
    const columns = Number(/\/Columns\s+(\d+)/.exec(object.dictionary)?.[1] ?? "1");
    const colors = Number(/\/Colors\s+(\d+)/.exec(object.dictionary)?.[1] ?? "1");
    const bits = Number(/\/BitsPerComponent\s+(\d+)/.exec(object.dictionary)?.[1] ?? "8");
    bytes = undoPngPredictor(bytes, columns, colors, bits);
  }
  return bytes;
}

/**
 * Ceiling on one decoded stream. Content streams, object streams and CMaps run
 * in the tens of kilobytes to low megabytes even for a thousand-page book, so
 * this only ever stops a file whose stream declares far more than it can be
 * carrying — and the caller records that as a warning against the object.
 */
const MAX_STREAM_BYTES = 64 * 1024 * 1024;

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const label = "pdf: stream";
  // Most producers emit a zlib header; a few emit a raw deflate stream.
  try {
    return await inflateCapped(bytes, "deflate", MAX_STREAM_BYTES, label);
  } catch (error) {
    // A stream that already blew the ceiling under one framing will blow it
    // under the other; only a framing mismatch is worth a second attempt.
    if (error instanceof InflateLimitError) throw error;
    return await inflateCapped(bytes, "deflate-raw", MAX_STREAM_BYTES, label);
  }
}

function asciiHexDecode(bytes: Uint8Array): Uint8Array {
  const hex = latin1.decode(bytes).replaceAll(/\s/g, "").replace(/>.*$/s, "");
  const even = hex.length % 2 === 0 ? hex : `${hex}0`;
  const out = new Uint8Array(even.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(even.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

function ascii85Decode(bytes: Uint8Array): Uint8Array {
  const body = latin1.decode(bytes).replaceAll(/\s/g, "").replace(/^<~/, "").replace(/~>.*$/s, "");
  const out: number[] = [];
  let group: number[] = [];
  for (const character of body) {
    if (character === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(character.charCodeAt(0) - 33);
    if (group.length === 5) {
      let value = 0;
      for (const digit of group) value = value * 85 + digit;
      out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
      group = [];
    }
  }
  if (group.length > 0) {
    const missing = 5 - group.length;
    for (let index = 0; index < missing; index += 1) group.push(84);
    let value = 0;
    for (const digit of group) value = value * 85 + digit;
    const full = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
    out.push(...full.slice(0, 4 - missing));
  }
  return Uint8Array.from(out);
}

function runLengthDecode(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  let index = 0;
  while (index < bytes.length) {
    const length = bytes[index] ?? 128;
    index += 1;
    if (length === 128) break;
    if (length < 128) {
      for (let count = 0; count <= length; count += 1) out.push(bytes[index + count] ?? 0);
      index += length + 1;
    } else {
      const value = bytes[index] ?? 0;
      for (let count = 0; count < 257 - length; count += 1) out.push(value);
      index += 1;
    }
  }
  return Uint8Array.from(out);
}

/** PNG predictors prefix each row with a filter type byte. */
function undoPngPredictor(
  bytes: Uint8Array,
  columns: number,
  colors: number,
  bits: number,
): Uint8Array {
  const sample = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLength = Math.ceil((columns * colors * bits) / 8);
  const stride = rowLength + 1;
  const rows = Math.floor(bytes.length / stride);
  const out = new Uint8Array(rows * rowLength);

  let previous = new Uint8Array(rowLength);
  for (let row = 0; row < rows; row += 1) {
    const type = bytes[row * stride] ?? 0;
    const current = bytes.subarray(row * stride + 1, row * stride + 1 + rowLength);
    const decoded = new Uint8Array(rowLength);
    for (let index = 0; index < rowLength; index += 1) {
      const value = current[index] ?? 0;
      const left = index >= sample ? (decoded[index - sample] ?? 0) : 0;
      const up = previous[index] ?? 0;
      const upLeft = index >= sample ? (previous[index - sample] ?? 0) : 0;
      decoded[index] = pngUnfilter(type, value, left, up, upLeft);
    }
    out.set(decoded, row * rowLength);
    previous = decoded;
  }
  return out;
}

function pngUnfilter(
  type: number,
  value: number,
  left: number,
  up: number,
  upLeft: number,
): number {
  switch (type) {
    case 1: {
      return (value + left) & 0xff;
    }
    case 2: {
      return (value + up) & 0xff;
    }
    case 3: {
      return (value + Math.floor((left + up) / 2)) & 0xff;
    }
    case 4: {
      const estimate = left + up - upLeft;
      const dLeft = Math.abs(estimate - left);
      const dUp = Math.abs(estimate - up);
      const dUpLeft = Math.abs(estimate - upLeft);
      const nearest = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      return (value + nearest) & 0xff;
    }
    default: {
      return value;
    }
  }
}

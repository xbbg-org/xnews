/**
 * Text extraction from downloaded files.
 *
 * `downloadWork` answers with bytes; this turns those bytes into readable
 * text. EPUB is the interesting case and needs no dependency: it is a ZIP
 * whose `META-INF/container.xml` names an OPF package document, whose spine
 * lists the content documents in reading order. Reading the spine rather than
 * globbing the archive is what keeps chapters in order and keeps navigation,
 * cover, and notes files out of the body text.
 *
 * Formats that genuinely need a decoder this package does not carry are
 * rejected by name rather than silently returning nothing, so callers can
 * route them elsewhere.
 */

import { extractDjvuText } from "./djvu.js";
import { XnewsFetchError } from "./errors.js";
import { extractCbz, extractMobi, rejectCbr } from "./mobi.js";
import { ocrImages, type OcrOptions } from "./ocr.js";
import { extractPdfImages, extractPdfText } from "./pdf.js";
import { cleanText, decodeEntities, elementPattern, stripTags } from "./text.js";
import { readZipEntries, type ZipEntry } from "./zip.js";

/** One content document, in reading order. */
export interface ExtractedSection {
  /** Archive-relative path of the source document. */
  readonly href: string;
  readonly title?: string;
  readonly text: string;
}

export interface ExtractedText {
  /** Every section joined in reading order. */
  readonly text: string;
  /** Container the text came out of. */
  readonly format: "epub" | "html" | "txt" | "pdf" | "djvu" | "mobi" | "azw" | "azw3" | "cbz";
  readonly sections: readonly ExtractedSection[];
  readonly characterCount: number;
  readonly warnings: readonly string[];
}

export interface ExtractOptions {
  /**
   * Container format. Inferred from the file name when omitted; supply it
   * when the bytes came from somewhere without one.
   */
  readonly format?: string;
  /** Stop after this many characters of body text. */
  readonly maxCharacters?: number;
  /**
   * OCR server to fall back to when a PDF carries no text layer. Without it,
   * a scan throws instead, because returning nothing would be indistinguishable
   * from an empty document.
   */
  readonly ocr?: OcrOptions;
}

/**
 * Extracts readable text. Throws a `config`-coded `XnewsFetchError` naming the
 * format when no decoder applies, rather than returning empty text that a
 * caller cannot distinguish from a genuinely empty book.
 */
export async function extractText(
  source: { readonly bytes: Uint8Array; readonly fileName?: string },
  options: ExtractOptions = {},
): Promise<ExtractedText> {
  const format = (
    options.format ??
    extensionOf(source.fileName) ??
    sniff(source.bytes)
  )?.toLowerCase();

  switch (format) {
    case "epub": {
      return extractEpub(source.bytes, options);
    }
    case "pdf": {
      return extractPdf(source.bytes, options);
    }
    // `.djv` is the 8.3-era spelling and is still in circulation.
    case "djv":
    case "djvu": {
      const djvu = await extractDjvuText(source.bytes);
      return page("djvu", djvu.pages, limit(djvu.text, options.maxCharacters), djvu.warnings);
    }
    case "mobi": {
      return extractMobi(source.bytes, "mobi", options.maxCharacters, source.fileName);
    }
    case "azw": {
      return extractMobi(source.bytes, "azw", options.maxCharacters, source.fileName);
    }
    case "azw3": {
      return extractMobi(source.bytes, "azw3", options.maxCharacters, source.fileName);
    }
    case "cbz": {
      return extractCbz(source.bytes, source.fileName);
    }
    case "cbr": {
      return rejectCbr(source.bytes, source.fileName);
    }
    case "html":
    case "htm":
    case "xhtml": {
      const text = limit(cleanText(stripTags(utf8(source.bytes))), options.maxCharacters);
      return page("html", [{ href: source.fileName ?? "", text }], text, []);
    }
    case "txt":
    case "text": {
      const text = limit(utf8(source.bytes).replaceAll("\r\n", "\n").trim(), options.maxCharacters);
      return page("txt", [{ href: source.fileName ?? "", text }], text, []);
    }
    default: {
      throw new XnewsFetchError(
        "config",
        `Cannot extract text: unrecognized format ${JSON.stringify(format ?? "unknown")}`,
        { url: source.fileName ?? "" },
      );
    }
  }
}

/**
 * A PDF is either digital-born, in which case it has a text layer, or a scan,
 * in which case its pages are images and only OCR can read it. The text layer
 * is always tried first: it is exact, instant, and free.
 */
async function extractPdf(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractedText> {
  try {
    const pdf = await extractPdfText(bytes);
    const sections = pdf.pages.map((entry) => ({
      href: `page/${entry.page}`,
      title: `Page ${entry.page}`,
      text: entry.text,
    }));
    const text = limit(pdf.pages.map((entry) => entry.text).join("\n\n"), options.maxCharacters);
    return page("pdf", sections, text, pdf.warnings);
  } catch (error) {
    const noTextLayer = error instanceof XnewsFetchError && error.message.includes("no text layer");
    if (!noTextLayer || options.ocr === undefined) throw error;

    const { images, warnings } = await extractPdfImages(bytes);
    if (images.length === 0) {
      throw new XnewsFetchError(
        "config",
        `PDF has no text layer and no extractable page images${warnings.length === 0 ? "" : `: ${warnings.join("; ")}`}`,
        { url: "" },
      );
    }
    const read = await ocrImages(images, options.ocr);
    const sections = read.pages.map((entry) => ({
      href: `page/${entry.page}`,
      title: `Page ${entry.page}`,
      text: entry.text,
    }));
    const text = limit(read.text, options.maxCharacters);
    return page("pdf", sections, text, [
      `pdf: no text layer; ${images.length} page image(s) read by OCR model ${read.model}`,
      ...warnings,
      ...read.warnings,
    ]);
  }
}
async function extractEpub(archive: Uint8Array, options: ExtractOptions): Promise<ExtractedText> {
  const entries = await readZipEntries(archive, "EPUB");
  const byName = new Map(entries.map((entry) => [normalizePath(entry.name), entry]));
  const warnings: string[] = [];
  const opfPath = findOpfPath(byName, warnings);
  const opf = byName.get(opfPath);
  if (opf === undefined) {
    throw new XnewsFetchError("config", `EPUB package document ${opfPath} is missing`, { url: "" });
  }
  const opfText = utf8(opf.bytes);
  const base = opfPath.includes("/") ? opfPath.replace(/\/[^/]*$/, "") : "";

  const manifest = readManifest(opfText);
  const order = readSpine(opfText);
  if (order.length === 0) warnings.push("epub: spine listed no documents; reading manifest order");
  const hrefs =
    order.length > 0
      ? order.map((id) => manifest[id]).filter((href): href is string => href !== undefined)
      : Object.values(manifest);

  const sections: ExtractedSection[] = [];
  let total = 0;
  for (const href of hrefs) {
    const resolved = normalizePath(base === "" ? href : `${base}/${href}`);
    const entry = byName.get(resolved) ?? byName.get(normalizePath(href));
    if (entry === undefined) {
      warnings.push(`epub: spine document ${href} is not in the archive`);
      continue;
    }
    if (!/\.(?:x?html?|xml)$/i.test(entry.name)) continue;
    const markup = utf8(entry.bytes);
    const text = cleanText(stripTags(bodyOf(markup)));
    if (text === "") continue;
    const title = documentTitle(markup);
    sections.push({ href: resolved, ...(title === undefined ? {} : { title }), text });
    total += text.length;
    if (options.maxCharacters !== undefined && total >= options.maxCharacters) break;
  }

  if (sections.length === 0) {
    throw new XnewsFetchError(
      "config",
      `EPUB yielded no readable documents from ${hrefs.length} spine entr${hrefs.length === 1 ? "y" : "ies"}`,
      { url: "" },
    );
  }

  const text = limit(sections.map((section) => section.text).join("\n\n"), options.maxCharacters);
  return page("epub", sections, text, warnings);
}

/** OCF requires the container at a fixed path; the OPF path is inside it. */
function findOpfPath(byName: ReadonlyMap<string, ZipEntry>, warnings: string[]): string {
  const container = byName.get("META-INF/container.xml");
  const declared =
    container === undefined
      ? undefined
      : /<rootfile\b[^>]*full-path=["']([^"']+)["']/i.exec(utf8(container.bytes))?.[1];
  if (declared !== undefined) return normalizePath(decodeEntities(declared));

  // Some writers omit or misplace the container; the package document is
  // still discoverable by extension.
  const guess = [...byName.keys()].find((name) => name.toLowerCase().endsWith(".opf"));
  if (guess === undefined) {
    throw new XnewsFetchError("config", "EPUB has no META-INF/container.xml and no .opf entry", {
      url: "",
    });
  }
  warnings.push(`epub: no usable container.xml; using ${guess}`);
  return guess;
}

function readManifest(opf: string): Record<string, string> {
  const manifest: Record<string, string> = {};
  for (const match of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attributes = match[1] ?? "";
    const id = /\bid=["']([^"']+)["']/i.exec(attributes)?.[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(attributes)?.[1];
    if (id !== undefined && href !== undefined) manifest[id] = decodeEntities(href);
  }
  return manifest;
}

function readSpine(opf: string): readonly string[] {
  const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf)?.[1] ?? "";
  return [...spine.matchAll(/<itemref\b([^>]*)\/?>/gi)]
    .map((match) => /\bidref=["']([^"']+)["']/i.exec(match[1] ?? "")?.[1])
    .filter((id): id is string => id !== undefined);
}

/** Body only: head carries styles and metadata that are not reading text. */
function bodyOf(markup: string): string {
  return elementPattern("body").exec(markup)?.[2] ?? markup;
}

function documentTitle(markup: string): string | undefined {
  const raw = elementPattern("title").exec(markup)?.[2];
  const title = raw === undefined ? "" : cleanText(raw);
  return title === "" ? undefined : title;
}

/** Collapses `.` and `..` so a spine href resolves to an archive entry. */
function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const segment of value.replaceAll("\\", "/").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

const utf8Decoder = new TextDecoder("utf-8");

function utf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

function extensionOf(fileName: string | undefined): string | undefined {
  return fileName === undefined ? undefined : /\.([a-z\d]+)$/i.exec(fileName)?.[1];
}

/** Magic bytes, for callers that hand over bytes with no name. */
function sniff(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "pdf";
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x41 &&
    bytes[1] === 0x54 &&
    bytes[2] === 0x26 &&
    bytes[3] === 0x54
  ) {
    return "djvu";
  }
  // EPUB and CBZ share ZIP magic; without a filename, retain the EPUB default.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "epub";
  if (
    bytes.length >= 68 &&
    bytes[60] === 0x42 &&
    bytes[61] === 0x4f &&
    bytes[62] === 0x4f &&
    bytes[63] === 0x4b &&
    bytes[64] === 0x4d &&
    bytes[65] === 0x4f &&
    bytes[66] === 0x42 &&
    bytes[67] === 0x49
  ) {
    return "mobi";
  }
  if (
    bytes.length >= 7 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21 &&
    bytes[4] === 0x1a &&
    bytes[5] === 0x07 &&
    (bytes[6] === 0 || (bytes[6] === 1 && bytes.length >= 8 && bytes[7] === 0))
  ) {
    return "cbr";
  }
  return undefined;
}

function limit(value: string, maxCharacters: number | undefined): string {
  return maxCharacters === undefined || value.length <= maxCharacters
    ? value
    : value.slice(0, maxCharacters);
}

function page(
  format: ExtractedText["format"],
  sections: readonly ExtractedSection[],
  text: string,
  warnings: readonly string[],
): ExtractedText {
  return { text, format, sections, characterCount: text.length, warnings };
}

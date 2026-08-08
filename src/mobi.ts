import { XnewsFetchError } from "./errors.js";
import type { ExtractedSection, ExtractedText } from "./extract.js";
import { cleanText, stripTags } from "./text.js";
import { readZipEntries, type ZipEntry } from "./zip.js";

export type MobiFormat = "mobi" | "azw" | "azw3";

const PDB_HEADER_SIZE = 78;
const RECORD_INFO_SIZE = 8;
const BOOK_MAGIC = [0x42, 0x4f, 0x4f, 0x4b];
const MOBI_MAGIC = [0x4d, 0x4f, 0x42, 0x49];
const RAR4_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00];
const RAR5_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00];
const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif)$/i;
const NATURAL_NAME_ORDER = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const windows1252 = createWindows1252Decoder();

interface MobiHeader {
  readonly headerLength: number;
  readonly mobiType: number;
  readonly textEncoding: number;
  readonly firstNonBookIndex?: number;
}

interface DecoderWithWarning {
  readonly decoder: TextDecoder;
  readonly warning?: string;
}

interface DecodedPayload {
  readonly text: string;
  readonly warnings: readonly string[];
}

/** Decodes one PalmDOC-compressed text record. */
export function decompressPalmDoc(input: Uint8Array, expectedSize = 4096): Uint8Array {
  let output = new Uint8Array(Math.max(64, expectedSize));
  let outputLength = 0;

  const reserve = (additional: number): void => {
    const needed = outputLength + additional;
    if (needed <= output.length) return;
    let capacity = output.length;
    while (capacity < needed) capacity *= 2;
    const grown = new Uint8Array(capacity);
    grown.set(output);
    output = grown;
  };

  for (let cursor = 0; cursor < input.length; cursor += 1) {
    const byte = input[cursor];
    if (byte === undefined) throw configError("PalmDOC input ended unexpectedly");

    if (byte === 0) {
      reserve(1);
      output[outputLength] = 0;
      outputLength += 1;
      continue;
    }

    if (byte <= 8) {
      if (cursor + byte >= input.length) {
        throw configError("PalmDOC literal run is truncated");
      }
      reserve(byte);
      for (let copied = 0; copied < byte; copied += 1) {
        cursor += 1;
        const literal = input[cursor];
        if (literal === undefined) throw configError("PalmDOC literal run is truncated");
        output[outputLength] = literal;
        outputLength += 1;
      }
      continue;
    }

    if (byte <= 0x7f) {
      reserve(1);
      output[outputLength] = byte;
      outputLength += 1;
      continue;
    }

    if (byte <= 0xbf) {
      cursor += 1;
      const following = input[cursor];
      if (following === undefined) throw configError("PalmDOC back-reference is truncated");
      const value = ((byte << 8) | following) & 0x3fff;
      const distance = value >> 3;
      const length = (value & 7) + 3;
      if (distance === 0 || distance > outputLength) {
        throw configError(`PalmDOC back-reference has invalid distance ${distance}`);
      }
      reserve(length);
      for (let copied = 0; copied < length; copied += 1) {
        const source = output[outputLength - distance];
        if (source === undefined) {
          throw configError(`PalmDOC back-reference has invalid distance ${distance}`);
        }
        output[outputLength] = source;
        outputLength += 1;
      }
      continue;
    }

    reserve(2);
    output[outputLength] = 0x20;
    output[outputLength + 1] = byte ^ 0x80;
    outputLength += 2;
  }

  return output.slice(0, outputLength);
}

export function extractMobi(
  archive: Uint8Array,
  format: MobiFormat,
  maxCharacters: number | undefined,
  fileName: string | undefined,
): ExtractedText {
  const records = readPdbRecords(archive, fileName);
  const recordZero = records[0];
  if (recordZero === undefined || recordZero.length < 16) {
    throw configError(`${format.toUpperCase()} has no complete PalmDOC header`, fileName);
  }

  const header = new DataView(recordZero.buffer, recordZero.byteOffset, recordZero.byteLength);
  const compression = header.getUint16(0);
  const textLength = header.getUint32(4);
  const textRecordCount = header.getUint16(8);
  const recordSize = header.getUint16(10);
  const encryptionType = header.getUint16(12);

  if (encryptionType !== 0) {
    throw configError(
      `${format.toUpperCase()} uses DRM encryption type ${encryptionType}; DRM-protected books cannot be decoded`,
      fileName,
    );
  }
  if (compression === 17480) {
    throw configError(`${format.toUpperCase()} uses unsupported HUFF/CDIC compression`, fileName);
  }
  if (compression !== 1 && compression !== 2) {
    throw configError(
      `${format.toUpperCase()} uses unsupported PalmDOC compression ${compression}`,
      fileName,
    );
  }
  if (textRecordCount === 0 || textRecordCount >= records.length) {
    throw configError(
      `${format.toUpperCase()} declares ${textRecordCount} text records but the PDB contains ${records.length - 1}`,
      fileName,
    );
  }
  if (recordSize === 0) {
    throw configError(`${format.toUpperCase()} declares a zero PalmDOC record size`, fileName);
  }

  // KF8-only books put their HTML in a second MOBI header. Reading the first
  // header covers the common AZW3 compatibility payload.
  const mobiHeader = readMobiHeader(recordZero, fileName);
  const chunks: Uint8Array[] = [];
  let decompressedLength = 0;
  for (let index = 1; index <= textRecordCount; index += 1) {
    const record = records[index];
    if (record === undefined) {
      throw configError(`${format.toUpperCase()} is missing text record ${index}`, fileName);
    }
    const chunk = compression === 1 ? record : decompressPalmDoc(record, recordSize);
    chunks.push(chunk);
    decompressedLength += chunk.length;
  }

  if (textLength === 0 || decompressedLength < textLength) {
    throw configError(
      `${format.toUpperCase()} declares ${textLength} text bytes but its records yielded ${decompressedLength}`,
      fileName,
    );
  }

  const payload = new Uint8Array(textLength);
  let payloadOffset = 0;
  for (const chunk of chunks) {
    const remaining = textLength - payloadOffset;
    if (remaining === 0) break;
    const copied = Math.min(remaining, chunk.length);
    payload.set(chunk.subarray(0, copied), payloadOffset);
    payloadOffset += copied;
  }

  const decoded = decodePayload(payload, mobiHeader?.textEncoding ?? 1252, format, fileName);
  const sections: ExtractedSection[] = [];
  for (const part of decoded.text.split(/<mbp:pagebreak\b[^>]*>/gi)) {
    const text = cleanText(stripTags(part));
    if (text === "") continue;
    sections.push({ href: `section-${sections.length + 1}`, text });
  }
  if (sections.length === 0) {
    throw configError(`${format.toUpperCase()} yielded no readable text`, fileName);
  }

  const joined = sections.map((section) => section.text).join("\n\n");
  const text =
    maxCharacters === undefined || joined.length <= maxCharacters
      ? joined
      : joined.slice(0, maxCharacters);
  return {
    text,
    format,
    sections,
    characterCount: text.length,
    warnings: decoded.warnings,
  };
}

export async function extractCbz(
  archive: Uint8Array,
  fileName: string | undefined,
): Promise<ExtractedText> {
  let entries: readonly ZipEntry[];
  try {
    entries = await readZipEntries(archive, "CBZ");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw configError(`Cannot decode CBZ: ${reason}`, fileName);
  }

  const images = entries
    .filter((entry) => IMAGE_EXTENSION.test(entry.name))
    .toSorted((left, right) => {
      const natural = NATURAL_NAME_ORDER.compare(left.name, right.name);
      return natural !== 0 ? natural : left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    });
  const sections = images.map((entry) => ({ href: entry.name, text: "" }));
  const count = sections.length;
  return {
    text: "",
    format: "cbz",
    sections,
    characterCount: 0,
    warnings: [`CBZ archive holds ${count} page image${count === 1 ? "" : "s"} and no text layer`],
  };
}

export function rejectCbr(archive: Uint8Array, fileName: string | undefined): never {
  if (!matches(archive, 0, RAR4_MAGIC) && !matches(archive, 0, RAR5_MAGIC)) {
    throw configError("CBR has no RAR4 or RAR5 signature", fileName);
  }
  throw configError(
    "CBR uses RAR compression, which is not implemented; convert the file to CBZ",
    fileName,
  );
}

function readPdbRecords(archive: Uint8Array, fileName: string | undefined): readonly Uint8Array[] {
  if (archive.length < PDB_HEADER_SIZE) {
    throw configError("MOBI/AZW file is too short to contain a PDB header", fileName);
  }
  if ((archive[0] ?? 0) === 0) {
    throw configError("MOBI/AZW PDB database name is missing", fileName);
  }
  if (!matches(archive, 60, BOOK_MAGIC) || !matches(archive, 64, MOBI_MAGIC)) {
    throw configError("MOBI/AZW file is not a BOOK/MOBI Palm database", fileName);
  }

  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const recordCount = view.getUint16(76);
  const tableEnd = PDB_HEADER_SIZE + recordCount * RECORD_INFO_SIZE;
  if (recordCount === 0 || tableEnd > archive.length) {
    throw configError("MOBI/AZW PDB record table is missing or truncated", fileName);
  }

  const offsets: number[] = [];
  for (let index = 0; index < recordCount; index += 1) {
    const offset = view.getUint32(PDB_HEADER_SIZE + index * RECORD_INFO_SIZE);
    const previous = offsets[index - 1];
    if (
      offset < tableEnd ||
      offset > archive.length ||
      (previous !== undefined && offset <= previous)
    ) {
      throw configError(`MOBI/AZW PDB record ${index} has an invalid offset`, fileName);
    }
    offsets.push(offset);
  }

  return offsets.map((offset, index) =>
    archive.subarray(offset, offsets[index + 1] ?? archive.length),
  );
}

function readMobiHeader(
  recordZero: Uint8Array,
  fileName: string | undefined,
): MobiHeader | undefined {
  if (!matches(recordZero, 16, MOBI_MAGIC)) return undefined;
  if (recordZero.length < 32) throw configError("MOBI header is truncated", fileName);

  const view = new DataView(recordZero.buffer, recordZero.byteOffset, recordZero.byteLength);
  const headerLength = view.getUint32(20);
  if (headerLength < 16 || 16 + headerLength > recordZero.length) {
    throw configError("MOBI header length exceeds record 0", fileName);
  }

  const mobiType = view.getUint32(24);
  const textEncoding = view.getUint32(28);
  const firstNonBookIndex = headerLength >= 68 ? view.getUint32(80) : undefined;
  return {
    headerLength,
    mobiType,
    textEncoding,
    ...(firstNonBookIndex === undefined ? {} : { firstNonBookIndex }),
  };
}

function decodePayload(
  payload: Uint8Array,
  textEncoding: number,
  format: MobiFormat,
  fileName: string | undefined,
): DecodedPayload {
  try {
    if (textEncoding === 65001) return { text: utf8Decoder.decode(payload), warnings: [] };
    if (textEncoding === 1252) {
      return {
        text: windows1252.decoder.decode(payload),
        warnings: windows1252.warning === undefined ? [] : [windows1252.warning],
      };
    }
    throw configError(
      `${format.toUpperCase()} declares unsupported text encoding ${textEncoding}`,
      fileName,
    );
  } catch (error) {
    if (error instanceof XnewsFetchError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw configError(`${format.toUpperCase()} text decoding failed: ${reason}`, fileName);
  }
}

function createWindows1252Decoder(): DecoderWithWarning {
  try {
    return { decoder: new TextDecoder("windows-1252", { fatal: true }) };
  } catch {
    return {
      decoder: new TextDecoder("latin1", { fatal: true }),
      warning:
        "MOBI: windows-1252 TextDecoder unavailable; decoded the compatibility payload as latin1",
    };
  }
}

function matches(bytes: Uint8Array, offset: number, magic: readonly number[]): boolean {
  if (offset + magic.length > bytes.length) return false;
  for (let index = 0; index < magic.length; index += 1) {
    const expected = magic[index];
    if (expected === undefined || bytes[offset + index] !== expected) return false;
  }
  return true;
}

function configError(message: string, fileName = ""): XnewsFetchError {
  return new XnewsFetchError("config", message, { url: fileName });
}

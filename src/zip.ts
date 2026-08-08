/**
 * Minimal ZIP reader for provider archive payloads (FFIEC CDR bulk files,
 * DTCC slice and cumulative files): end-of-central-directory scan,
 * central-directory walk, and stored or raw-deflate entry extraction via
 * the runtime's `DecompressionStream`. Deliberately not a general ZIP
 * implementation — encrypted and multi-disk archives and ZIP64
 * end-of-central-directory records are rejected loudly rather than
 * misread, because provider files are small, flat, single-disk archives.
 * Per-entry ZIP64 size fields are resolved, though: real sub-4GB writers
 * (the FFIEC CDR's among them) stamp `0xFFFFFFFF` sizes and park the true
 * values in a ZIP64 extended-information extra field.
 */

import { inflateCapped } from "./inflate.js";

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD fixed size (22) plus the maximum comment length (65535). */
const EOCD_SEARCH_WINDOW = 22 + 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const FLAG_ENCRYPTED = 0x0001;

/**
 * Ceiling on the total bytes one archive may inflate to. Provider bundles are
 * tens of megabytes; this is a memory bound, not a policy, and it exists
 * because a small archive can declare an enormous payload.
 */
export const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * Extracts every file entry of a ZIP archive; directories are skipped.
 * `archiveLabel` names the archive in error messages.
 */
export async function readZipEntries(
  archive: Uint8Array,
  archiveLabel = "ZIP archive",
): Promise<readonly ZipEntry[]> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findEndOfCentralDirectory(view, archiveLabel);
  const diskNumber = view.getUint16(eocd + 4, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (diskNumber !== 0) {
    throw new Error(`${archiveLabel}: multi-disk archives are not supported`);
  }
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error(`${archiveLabel}: ZIP64 archives are not supported`);
  }

  const entries: ZipEntry[] = [];
  let budget = MAX_ZIP_UNCOMPRESSED_BYTES;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.byteLength || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`${archiveLabel}: malformed central directory`);
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(archive.subarray(cursor + 46, cursor + 46 + nameLength));
    const { compressedSize, uncompressedSize, localOffset } = resolveEntrySizes(view, {
      archiveLabel,
      name,
      compressedRaw: view.getUint32(cursor + 20, true),
      uncompressedRaw: view.getUint32(cursor + 24, true),
      localOffsetRaw: view.getUint32(cursor + 42, true),
      extraStart: cursor + 46 + nameLength,
      extraLength,
    });
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new Error(`${archiveLabel}: entry ${JSON.stringify(name)} is encrypted`);
    }

    if (
      localOffset + 30 > archive.byteLength ||
      view.getUint32(localOffset, true) !== LOCAL_SIGNATURE
    ) {
      throw new Error(`${archiveLabel}: malformed local header for ${JSON.stringify(name)}`);
    }
    // Name and extra lengths must come from the local header: writers may
    // store different extra fields locally than in the central directory.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    if (compressed.byteLength !== compressedSize) {
      throw new Error(`${archiveLabel}: entry ${JSON.stringify(name)} is truncated`);
    }

    // A streamed entry parks its sizes in a data descriptor and leaves the
    // central-directory copy at zero; every other writer states the real
    // size there, and a stated size that the stream then contradicts means
    // the archive is damaged or lying about its payload.
    const entryLabel = `${archiveLabel}: entry ${JSON.stringify(name)}`;
    const declared = uncompressedSize === 0 && compressedSize > 0 ? undefined : uncompressedSize;
    if (declared !== undefined && declared > budget) {
      throw new Error(
        `${entryLabel} declares ${declared} bytes, past this archive's remaining ${budget} byte decompression budget`,
      );
    }

    if (method === METHOD_STORED) {
      if (declared !== undefined && declared !== compressedSize) {
        throw new Error(
          `${entryLabel} is stored but declares ${declared} bytes for ${compressedSize} bytes of data`,
        );
      }
      entries.push({ name, bytes: compressed });
      budget -= compressed.byteLength;
    } else if (method === METHOD_DEFLATED) {
      const bytes = await inflateCapped(compressed, "deflate-raw", declared ?? budget, entryLabel);
      if (declared !== undefined && bytes.byteLength !== declared) {
        throw new Error(
          `${entryLabel} declares ${declared} bytes but inflated to ${bytes.byteLength}`,
        );
      }
      entries.push({ name, bytes });
      budget -= bytes.byteLength;
    } else {
      throw new Error(`${entryLabel} uses unsupported compression method ${method}`);
    }
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView, archiveLabel: string): number {
  const stop = Math.max(0, view.byteLength - EOCD_SEARCH_WINDOW);
  for (let offset = view.byteLength - 22; offset >= stop; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error(`${archiveLabel}: end-of-central-directory record not found`);
}

const ZIP64_EXTRA_TAG = 0x0001;

interface EntrySizeFields {
  readonly archiveLabel: string;
  readonly name: string;
  readonly compressedRaw: number;
  readonly uncompressedRaw: number;
  readonly localOffsetRaw: number;
  readonly extraStart: number;
  readonly extraLength: number;
}

/**
 * Resolves an entry's uncompressed and compressed sizes and its local offset,
 * reading the ZIP64 extended-information extra field when a classic 32-bit
 * field is `0xFFFFFFFF`. The ZIP64 payload orders its values uncompressed
 * size, compressed size, local offset — each present only when the matching
 * classic field overflowed.
 */
function resolveEntrySizes(
  view: DataView,
  fields: EntrySizeFields,
): { compressedSize: number; uncompressedSize: number; localOffset: number } {
  let compressedSize = fields.compressedRaw;
  let uncompressedSize = fields.uncompressedRaw;
  let localOffset = fields.localOffsetRaw;
  const needsUncompressed = fields.uncompressedRaw === 0xffffffff;
  const needsCompressed = fields.compressedRaw === 0xffffffff;
  const needsOffset = fields.localOffsetRaw === 0xffffffff;
  if (!needsUncompressed && !needsCompressed && !needsOffset) {
    return { compressedSize, uncompressedSize, localOffset };
  }

  const entryLabel = `${fields.archiveLabel}: entry ${JSON.stringify(fields.name)}`;
  let cursor = fields.extraStart;
  const end = fields.extraStart + fields.extraLength;
  while (cursor + 4 <= end) {
    const tag = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    if (tag !== ZIP64_EXTRA_TAG) {
      cursor += 4 + size;
      continue;
    }

    let field = cursor + 4;
    const fieldEnd = Math.min(field + size, end);
    const readUint64 = (label: string): number => {
      if (field + 8 > fieldEnd) {
        throw new Error(`${entryLabel} has a truncated ZIP64 extra field`);
      }
      const value = view.getBigUint64(field, true);
      field += 8;
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${entryLabel} ${label} exceeds the safe integer range`);
      }
      return Number(value);
    };
    if (needsUncompressed) uncompressedSize = readUint64("uncompressed size");
    if (needsCompressed) compressedSize = readUint64("compressed size");
    if (needsOffset) localOffset = readUint64("local offset");
    return { compressedSize, uncompressedSize, localOffset };
  }
  throw new Error(`${entryLabel} declares ZIP64 sizes without a ZIP64 extra field`);
}

import { XnewsFetchError } from "./errors.js";
import type { ExtractedSection } from "./extract.js";

export interface DjvuText {
  readonly pages: readonly ExtractedSection[];
  readonly text: string;
  readonly warnings: readonly string[];
}

interface Chunk {
  readonly id: string;
  readonly dataStart: number;
  readonly dataEnd: number;
}

const DJVU_MAGIC = [0x41, 0x54, 0x26, 0x54];
const MAX_BZZ_BLOCK_SIZE = 0x400000;
const MAX_BZZ_OUTPUT_SIZE = 0x10000000;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

// DjVu Reference v3, Appendix 3, Table 9. States 251..255 are unreachable:
// Table 9 defines states 0..250 and no transition enters the remaining byte values.
const DELTA = new Uint16Array([
  0x8000, 0x8000, 0x8000, 0x6bbd, 0x6bbd, 0x5d45, 0x5d45, 0x51b9, 0x51b9, 0x4813, 0x4813, 0x3fd5,
  0x3fd5, 0x38b1, 0x38b1, 0x3275, 0x3275, 0x2cfd, 0x2cfd, 0x2825, 0x2825, 0x23ab, 0x23ab, 0x1f87,
  0x1f87, 0x1bbb, 0x1bbb, 0x1845, 0x1845, 0x1523, 0x1523, 0x1253, 0x1253, 0x0fcf, 0x0fcf, 0x0d95,
  0x0d95, 0x0b9d, 0x0b9d, 0x09e3, 0x09e3, 0x0861, 0x0861, 0x0711, 0x0711, 0x05f1, 0x05f1, 0x04f9,
  0x04f9, 0x0425, 0x0425, 0x0371, 0x0371, 0x02d9, 0x02d9, 0x0259, 0x0259, 0x01ed, 0x01ed, 0x0193,
  0x0193, 0x0149, 0x0149, 0x010b, 0x010b, 0x00d5, 0x00d5, 0x00a5, 0x00a5, 0x007b, 0x007b, 0x0057,
  0x0057, 0x003b, 0x003b, 0x0023, 0x0023, 0x0013, 0x0013, 0x0007, 0x0007, 0x0001, 0x0001, 0x5695,
  0x24ee, 0x8000, 0x0d30, 0x481a, 0x0481, 0x3579, 0x017a, 0x24ef, 0x007b, 0x1978, 0x0028, 0x10ca,
  0x000d, 0x0b5d, 0x0034, 0x078a, 0x00a0, 0x050f, 0x0117, 0x0358, 0x01ea, 0x0234, 0x0144, 0x0173,
  0x0234, 0x00f5, 0x0353, 0x00a1, 0x05c5, 0x011a, 0x03cf, 0x01aa, 0x0285, 0x0286, 0x01ab, 0x03d3,
  0x011a, 0x05c5, 0x00ba, 0x08ad, 0x007a, 0x0ccc, 0x01eb, 0x1302, 0x02e6, 0x1b81, 0x045e, 0x24ef,
  0x0690, 0x2865, 0x09de, 0x3987, 0x0dc8, 0x2c99, 0x10ca, 0x3b5f, 0x0b5d, 0x5695, 0x078a, 0x8000,
  0x050f, 0x24ee, 0x0358, 0x0d30, 0x0234, 0x0481, 0x0173, 0x017a, 0x00f5, 0x007b, 0x00a1, 0x0028,
  0x011a, 0x000d, 0x01aa, 0x0034, 0x0286, 0x00a0, 0x03d3, 0x0117, 0x05c5, 0x01ea, 0x08ad, 0x0144,
  0x0ccc, 0x0234, 0x1302, 0x0353, 0x1b81, 0x05c5, 0x24ef, 0x03cf, 0x2b74, 0x0285, 0x201d, 0x01ab,
  0x1715, 0x011a, 0x0fb7, 0x00ba, 0x0a67, 0x01eb, 0x06e7, 0x02e6, 0x0496, 0x045e, 0x030d, 0x0690,
  0x0206, 0x09de, 0x0155, 0x0dc8, 0x00e1, 0x2b74, 0x0094, 0x201d, 0x0188, 0x1715, 0x0252, 0x0fb7,
  0x0383, 0x0a67, 0x0547, 0x06e7, 0x07e2, 0x0496, 0x0bc0, 0x030d, 0x1178, 0x0206, 0x19da, 0x0155,
  0x24ef, 0x00e1, 0x320e, 0x0094, 0x432a, 0x0188, 0x447d, 0x0252, 0x5ece, 0x0383, 0x8000, 0x0547,
  0x481a, 0x07e2, 0x3579, 0x0bc0, 0x24ef, 0x1178, 0x1978, 0x19da, 0x2865, 0x24ef, 0x3987, 0x320e,
  0x2c99, 0x432a, 0x3b5f, 0x447d, 0x5695, 0x5ece, 0x8000, 0x8000, 0x5695, 0x481a, 0x481a, 0x8000,
  0x8000, 0x8000, 0x8000, 0x8000,
]);

const THRESHOLD = new Uint16Array([
  0x0000, 0x0000, 0x0000, 0x10a5, 0x10a5, 0x1f28, 0x1f28, 0x2bd3, 0x2bd3, 0x36e3, 0x36e3, 0x408c,
  0x408c, 0x48fd, 0x48fd, 0x505d, 0x505d, 0x56d0, 0x56d0, 0x5c71, 0x5c71, 0x615b, 0x615b, 0x65a5,
  0x65a5, 0x6962, 0x6962, 0x6ca2, 0x6ca2, 0x6f74, 0x6f74, 0x71e6, 0x71e6, 0x7404, 0x7404, 0x75d6,
  0x75d6, 0x7768, 0x7768, 0x78c2, 0x78c2, 0x79ea, 0x79ea, 0x7ae7, 0x7ae7, 0x7bbe, 0x7bbe, 0x7c75,
  0x7c75, 0x7d0f, 0x7d0f, 0x7d91, 0x7d91, 0x7dfe, 0x7dfe, 0x7e5a, 0x7e5a, 0x7ea6, 0x7ea6, 0x7ee6,
  0x7ee6, 0x7f1a, 0x7f1a, 0x7f45, 0x7f45, 0x7f6b, 0x7f6b, 0x7f8d, 0x7f8d, 0x7faa, 0x7faa, 0x7fc3,
  0x7fc3, 0x7fd7, 0x7fd7, 0x7fe7, 0x7fe7, 0x7ff2, 0x7ff2, 0x7ffa, 0x7ffa, 0x7fff, 0x7fff, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
]);

const UP = new Uint8Array([
  84, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75,
  76, 77, 78, 79, 80, 81, 82, 81, 82, 9, 86, 5, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 82, 99, 76,
  101, 70, 103, 66, 105, 106, 107, 66, 109, 60, 111, 56, 69, 114, 65, 116, 61, 118, 57, 120, 53,
  122, 49, 124, 43, 72, 39, 60, 33, 56, 29, 52, 23, 48, 23, 42, 137, 38, 21, 140, 15, 142, 9, 144,
  141, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 70, 157, 66, 81, 62, 75, 58, 69, 54, 65,
  50, 167, 44, 65, 40, 59, 34, 55, 30, 175, 24, 177, 178, 179, 180, 181, 182, 183, 184, 69, 186, 59,
  188, 55, 190, 51, 192, 47, 194, 41, 196, 37, 198, 199, 72, 201, 62, 203, 58, 205, 54, 207, 50,
  209, 46, 211, 40, 213, 36, 215, 30, 217, 26, 219, 20, 71, 14, 61, 14, 57, 8, 53, 228, 49, 230, 45,
  232, 39, 234, 35, 138, 29, 24, 25, 240, 19, 22, 13, 16, 13, 10, 7, 244, 249, 10, 89, 230, 0, 0, 0,
  0, 0,
]);

const DOWN = new Uint8Array([
  145, 4, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72,
  73, 74, 75, 76, 77, 78, 79, 80, 85, 226, 6, 176, 143, 138, 141, 112, 135, 104, 133, 100, 129, 98,
  127, 72, 125, 102, 123, 60, 121, 110, 119, 108, 117, 54, 115, 48, 113, 134, 59, 132, 55, 130, 51,
  128, 47, 126, 41, 62, 37, 66, 31, 54, 25, 50, 131, 46, 17, 40, 15, 136, 7, 32, 139, 172, 9, 170,
  85, 168, 248, 166, 247, 164, 197, 162, 95, 160, 173, 158, 165, 156, 161, 60, 159, 56, 71, 52, 163,
  48, 59, 42, 171, 38, 169, 32, 53, 26, 47, 174, 193, 18, 191, 222, 189, 218, 187, 216, 185, 214,
  61, 212, 53, 210, 49, 208, 45, 206, 39, 204, 195, 202, 31, 200, 243, 64, 239, 56, 237, 52, 235,
  48, 233, 44, 231, 38, 229, 34, 227, 28, 225, 22, 223, 16, 221, 220, 63, 8, 55, 224, 51, 2, 47, 87,
  43, 246, 37, 244, 33, 238, 27, 236, 21, 16, 15, 8, 241, 242, 7, 10, 245, 2, 1, 83, 250, 2, 143,
  246, 0, 0, 0, 0, 0,
]);

class ZPrimeDecoder {
  private readonly states = new Uint8Array(262);
  private readonly input: Uint8Array;
  private bitOffset = 16;
  private a = 0;
  private c: number;

  constructor(input: Uint8Array) {
    this.input = input;
    this.c = ((input[0] ?? 0xff) << 8) | (input[1] ?? 0xff);
  }

  decode(context: number): number {
    const state = this.states[context];
    if (state === undefined) throw configError(`DjVu BZZ uses invalid context ${context}`);
    const delta = DELTA[state];
    const threshold = THRESHOLD[state];
    const up = UP[state];
    const down = DOWN[state];
    if (delta === undefined || threshold === undefined || up === undefined || down === undefined) {
      throw configError(`DjVu Z′-Coder uses invalid probability state ${state}`);
    }

    let z = this.a + delta;
    const d = 0x6000 + ((z + this.a) >> 2);
    if (z > d) z = d;

    let bit: number;
    // Equality belongs to the MPS interval; taking the other branch would overflow C.
    if (this.c >= z) {
      bit = state & 1;
      // MPS adaptation occurs only when its interval reaches the renormalization range.
      if (z >= 0x8000 && this.a >= threshold) this.states[context] = up;
      this.a = z;
    } else {
      bit = 1 - (state & 1);
      this.a = (this.a + 0x10000 - z) & 0xffff;
      this.c = (this.c + 0x10000 - z) & 0xffff;
      this.states[context] = down;
    }
    this.renormalize();
    return bit;
  }

  decodePassThrough(): number {
    const z = 0x8000 + ((this.a * 3) >> 3);
    let bit: number;
    if (this.c >= z) {
      bit = 0;
      this.a = z;
    } else {
      bit = 1;
      this.a = (this.a + 0x10000 - z) & 0xffff;
      this.c = (this.c + 0x10000 - z) & 0xffff;
    }
    this.renormalize();
    return bit;
  }

  private renormalize(): void {
    while (this.a >= 0x8000) {
      this.a = (this.a * 2) & 0xffff;
      this.c = ((this.c * 2) | this.nextBit()) & 0xffff;
    }
  }

  private nextBit(): number {
    const byte = this.input[Math.floor(this.bitOffset / 8)] ?? 0xff;
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return bit;
  }
}

function decodeRaw(decoder: ZPrimeDecoder, width: number): number {
  let value = 1;
  const limit = 2 ** width;
  while (value < limit) value = value * 2 + decoder.decodePassThrough();
  return value - limit;
}

function decodeBinary(decoder: ZPrimeDecoder, contextOffset: number, width: number): number {
  let value = 1;
  const limit = 2 ** width;
  while (value < limit) value = value * 2 + decoder.decode(contextOffset + value - 1);
  return value - limit;
}

function decodeMtfIndex(decoder: ZPrimeDecoder, previous: number): number {
  const shortContext = previous <= 2 ? previous : 2;
  if (decoder.decode(shortContext) === 1) return 0;
  if (decoder.decode(shortContext + 3) === 1) return 1;
  if (decoder.decode(6) === 1) return 2 + decodeBinary(decoder, 7, 1);
  if (decoder.decode(8) === 1) return 4 + decodeBinary(decoder, 9, 2);
  if (decoder.decode(12) === 1) return 8 + decodeBinary(decoder, 13, 3);
  if (decoder.decode(20) === 1) return 16 + decodeBinary(decoder, 21, 4);
  if (decoder.decode(36) === 1) return 32 + decodeBinary(decoder, 37, 5);
  if (decoder.decode(68) === 1) return 64 + decodeBinary(decoder, 69, 6);
  if (decoder.decode(132) === 1) return 128 + decodeBinary(decoder, 133, 7);
  return 256;
}

function decodeBzzBlock(decoder: ZPrimeDecoder, blockSize: number): Uint8Array {
  const fshift = decoder.decodePassThrough() === 0 ? 0 : decoder.decodePassThrough() + 1;
  const mtf = new Uint8Array(256);
  for (let index = 0; index < mtf.length; index += 1) mtf[index] = index;

  const frequencies = new Uint32Array(4);
  const transformed = new Uint8Array(blockSize);
  let previous = 3;
  let markerPosition = -1;
  let frequencyAdd = 4;

  for (let index = 0; index < blockSize; index += 1) {
    const mtfIndex = decodeMtfIndex(decoder, previous);
    previous = mtfIndex;
    if (mtfIndex === 256) {
      if (markerPosition !== -1) {
        throw configError(`DjVu BZZ block has end markers at ${markerPosition} and ${index}`);
      }
      transformed[index] = 0;
      markerPosition = index;
      continue;
    }

    const symbol = mtf[mtfIndex];
    if (symbol === undefined) throw configError(`DjVu BZZ uses invalid MTF index ${mtfIndex}`);
    transformed[index] = symbol;

    frequencyAdd += Math.floor(frequencyAdd / 2 ** fshift);
    if (frequencyAdd > 0x10000000) {
      // Appendix 4's quasi-MTF model drops 24 low bits when bit 28 overflows.
      frequencyAdd = Math.floor(frequencyAdd / 0x1000000);
      for (let rank = 0; rank < frequencies.length; rank += 1) {
        const frequency = frequencies[rank];
        if (frequency === undefined) throw configError("DjVu BZZ frequency table is incomplete");
        frequencies[rank] = Math.floor(frequency / 0x1000000);
      }
    }

    const oldFrequency = mtfIndex < 4 ? frequencies[mtfIndex] : 0;
    if (oldFrequency === undefined) throw configError("DjVu BZZ frequency table is incomplete");
    const frequency = frequencyAdd + oldFrequency;
    let rank = mtfIndex;
    while (rank > 3) {
      const preceding = mtf[rank - 1];
      if (preceding === undefined) throw configError("DjVu BZZ MTF table is incomplete");
      mtf[rank] = preceding;
      rank -= 1;
    }
    while (rank > 0) {
      const precedingFrequency = frequencies[rank - 1];
      const preceding = mtf[rank - 1];
      if (precedingFrequency === undefined || preceding === undefined) {
        throw configError("DjVu BZZ MTF table is incomplete");
      }
      if (frequency < precedingFrequency) break;
      mtf[rank] = preceding;
      frequencies[rank] = precedingFrequency;
      rank -= 1;
    }
    mtf[rank] = symbol;
    frequencies[rank] = frequency;
  }

  if (markerPosition <= 0 || markerPosition >= blockSize) {
    throw configError(
      `DjVu BZZ block of ${blockSize} bytes has invalid end marker ${markerPosition}`,
    );
  }
  return invertBurrowsWheeler(transformed, markerPosition);
}

function invertBurrowsWheeler(transformed: Uint8Array, markerPosition: number): Uint8Array {
  const positions = new Uint32Array(transformed.length);
  const counts = new Uint32Array(256);

  for (let index = 0; index < transformed.length; index += 1) {
    if (index === markerPosition) continue;
    const symbol = transformed[index];
    if (symbol === undefined) throw configError("DjVu BZZ block is truncated");
    const count = counts[symbol];
    if (count === undefined) throw configError("DjVu BZZ symbol table is incomplete");
    positions[index] = count;
    counts[symbol] = count + 1;
  }

  let sortedPosition = 1;
  for (let symbol = 0; symbol < counts.length; symbol += 1) {
    const count = counts[symbol];
    if (count === undefined) throw configError("DjVu BZZ symbol table is incomplete");
    counts[symbol] = sortedPosition;
    sortedPosition += count;
  }
  if (sortedPosition !== transformed.length) {
    throw configError("DjVu BZZ block has an invalid end marker");
  }

  const output = new Uint8Array(transformed.length - 1);
  let cursor = 0;
  for (let destination = output.length; destination > 0; ) {
    destination -= 1;
    const symbol = transformed[cursor];
    const rank = positions[cursor];
    if (symbol === undefined || rank === undefined)
      throw configError("DjVu BZZ block is truncated");
    output[destination] = symbol;
    const first = counts[symbol];
    if (first === undefined) throw configError("DjVu BZZ symbol table is incomplete");
    cursor = first + rank;
  }
  if (cursor !== markerPosition) throw configError("DjVu BZZ block has an invalid transform");
  return output;
}

function decompressBzz(input: Uint8Array): Uint8Array {
  const decoder = new ZPrimeDecoder(input);
  const blocks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const blockSize = decodeRaw(decoder, 24);
    if (blockSize === 0) break;
    if (blockSize > MAX_BZZ_BLOCK_SIZE) {
      throw configError(`DjVu BZZ block size ${blockSize} exceeds the format limit`);
    }
    const block = decodeBzzBlock(decoder, blockSize);
    totalLength += block.length;
    if (totalLength > MAX_BZZ_OUTPUT_SIZE) {
      throw configError("DjVu BZZ text exceeds the safe decompressed size");
    }
    blocks.push(block);
  }

  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.length;
  }
  return output;
}

function readChunks(bytes: Uint8Array, start: number, end: number): readonly Chunk[] {
  const chunks: Chunk[] = [];
  let cursor = start;
  while (cursor < end) {
    if (cursor + 8 > end) throw configError("DjVu IFF chunk header is truncated");
    const id = ascii4(bytes, cursor);
    const length = readBe32(bytes, cursor + 4);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > end) throw configError(`DjVu IFF chunk ${id} is truncated`);
    chunks.push({ id, dataStart, dataEnd });
    // The final outer FORM in real DjVu files commonly ends at EOF; nested
    // chunks still consume their mandatory pad before any following chunk.
    cursor = dataEnd + (dataEnd < end ? length & 1 : 0);
  }
  return chunks;
}

function collectPages(
  bytes: Uint8Array,
  chunks: readonly Chunk[],
  pages: Chunk[],
  insideDocument = false,
): void {
  for (const chunk of chunks) {
    if (chunk.id !== "FORM") continue;
    if (chunk.dataEnd - chunk.dataStart < 4)
      throw configError("DjVu FORM chunk has no secondary ID");
    const formType = ascii4(bytes, chunk.dataStart);
    if (formType === "DJVU") {
      pages.push(chunk);
    } else if (formType === "DJVM") {
      if (insideDocument) throw configError("DjVu document contains a nested FORM:DJVM");
      collectPages(bytes, readChunks(bytes, chunk.dataStart + 4, chunk.dataEnd), pages, true);
    }
  }
}

function readPageText(
  bytes: Uint8Array,
  page: Chunk,
): { readonly text: string; readonly found: boolean } {
  const chunks = readChunks(bytes, page.dataStart + 4, page.dataEnd);
  for (const chunk of chunks) {
    if (chunk.id !== "TXTa" && chunk.id !== "TXTz") continue;
    const payload = bytes.subarray(chunk.dataStart, chunk.dataEnd);
    return {
      text: readTextPayload(chunk.id === "TXTz" ? decompressBzz(payload) : payload),
      found: true,
    };
  }
  return { text: "", found: false };
}

function readTextPayload(payload: Uint8Array): string {
  if (payload.length < 3) throw configError("DjVu hidden text chunk is truncated");
  const textLength = readBe24(payload, 0);
  if (textLength > payload.length - 3) throw configError("DjVu hidden text string is truncated");
  try {
    return utf8Decoder.decode(payload.subarray(3, 3 + textLength));
  } catch {
    throw configError("DjVu hidden text is not valid UTF-8");
  }
}

function ascii4(bytes: Uint8Array, offset: number): string {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw configError("DjVu IFF identifier is truncated");
  }
  return String.fromCharCode(a, b, c, d);
}

function readBe24(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  if (a === undefined || b === undefined || c === undefined)
    throw configError("DjVu BE24 is truncated");
  return a * 0x10000 + b * 0x100 + c;
}

function readBe32(bytes: Uint8Array, offset: number): number {
  const a = bytes[offset];
  const b = bytes[offset + 1];
  const c = bytes[offset + 2];
  const d = bytes[offset + 3];
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw configError("DjVu BE32 is truncated");
  }
  return a * 0x1000000 + b * 0x10000 + c * 0x100 + d;
}

function configError(message: string): XnewsFetchError {
  return new XnewsFetchError("config", message, { url: "" });
}

export async function extractDjvuText(bytes: Uint8Array): Promise<DjvuText> {
  if (bytes.length < DJVU_MAGIC.length || DJVU_MAGIC.some((byte, index) => bytes[index] !== byte)) {
    throw configError("Cannot extract text: input is not a DjVu file (missing AT&T magic)");
  }

  const pageForms: Chunk[] = [];
  collectPages(bytes, readChunks(bytes, 4, bytes.length), pageForms);
  if (pageForms.length === 0) throw configError("DjVu document has no page components");

  let foundTextLayer = false;
  const pages = pageForms.map((form, index) => {
    const page = readPageText(bytes, form);
    foundTextLayer ||= page.found;
    return { href: `page/${index + 1}`, text: page.text };
  });
  if (!foundTextLayer) {
    throw configError(
      `DjVu has no text layer across ${pageForms.length} page(s); it is most likely a scan and needs OCR`,
    );
  }

  return { pages, text: pages.map((page) => page.text).join("\n\n"), warnings: [] };
}

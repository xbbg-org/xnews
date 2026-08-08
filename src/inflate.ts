/**
 * Bounded DEFLATE decoding over the runtime's `DecompressionStream`.
 *
 * Every compressed payload xnews reads arrives from a public endpoint, and
 * DEFLATE expands by up to ~1032:1, so a download that passed the transport's
 * byte ceiling can still expand far past available memory. Decoding therefore
 * always carries an explicit output ceiling and stops at the byte that crosses
 * it, rather than materializing the whole stream and discovering its size
 * afterwards.
 */

/** Raised when a stream expands past the ceiling its caller allowed. */
export class InflateLimitError extends Error {
  readonly limit: number;

  constructor(label: string, limit: number) {
    super(`${label} expands past the ${limit} byte decompression ceiling`);
    this.name = "InflateLimitError";
    this.limit = limit;
  }
}

/**
 * Inflates `bytes` and fails with `InflateLimitError` once the output would
 * exceed `limit`. `label` names the payload in that error.
 */
export async function inflateCapped(
  bytes: Uint8Array,
  format: "deflate" | "deflate-raw",
  limit: number,
  label: string,
): Promise<Uint8Array> {
  const source = new Blob([bytes.slice()]);
  const reader = source.stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new InflateLimitError(label, limit);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const single = chunks.length === 1 ? chunks[0] : undefined;
  if (single !== undefined) return single;

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

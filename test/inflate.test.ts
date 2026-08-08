import { deflateRawSync, deflateSync } from "node:zlib";
import { expect, test } from "bun:test";
import { inflateCapped, InflateLimitError } from "../src/inflate.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error", { cause: error });
  }
  throw new Error("Expected a rejection");
}

test("inflates both zlib and raw framing up to the ceiling", async () => {
  const payload = encoder.encode("call report row\n".repeat(64));
  const zlib = await inflateCapped(
    new Uint8Array(deflateSync(payload)),
    "deflate",
    payload.byteLength,
    "zlib payload",
  );
  const raw = await inflateCapped(
    new Uint8Array(deflateRawSync(payload)),
    "deflate-raw",
    payload.byteLength,
    "raw payload",
  );

  expect(decoder.decode(zlib)).toBe(decoder.decode(payload));
  expect(decoder.decode(raw)).toBe(decoder.decode(payload));
});

test("a payload that expands past its ceiling is refused, not materialized", async () => {
  // 8 MiB of zeros compresses to a few kilobytes: the shape of a decompression
  // bomb, and the reason a ceiling exists at all.
  const bomb = new Uint8Array(deflateRawSync(new Uint8Array(8 * 1024 * 1024)));
  expect(bomb.byteLength).toBeLessThan(64 * 1024);

  const failure = await captureError(inflateCapped(bomb, "deflate-raw", 1024, "archive entry"));

  expect(failure).toBeInstanceOf(InflateLimitError);
  if (!(failure instanceof InflateLimitError)) throw failure;
  expect(failure.limit).toBe(1024);
  expect(failure.message).toContain("archive entry");
});

test("corrupt input fails as a decoding error rather than a ceiling breach", async () => {
  const failure = await captureError(
    inflateCapped(encoder.encode("not a deflate stream"), "deflate", 1024, "corrupt payload"),
  );

  expect(failure).not.toBeInstanceOf(InflateLimitError);
});

import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import {
  createMoonshineAsrBackend,
  createOpenRouterAsrBackend,
  transcribePcmStream,
  transcribeYoutubeRealtime,
  type RealtimeAsrBackend,
  type RealtimeAsrEvent,
} from "../src";
import type { SourceFetch } from "../src/types";

const SIDECAR_PATH = fileURLToPath(new URL("../src/asr/moonshine-worker.py", import.meta.url));
const SIDECAR_FIXTURE = fileURLToPath(new URL("./fixtures/asr-sidecar.mjs", import.meta.url));
const MEDIA_FIXTURE = fileURLToPath(new URL("./fixtures/asr-media-command.mjs", import.meta.url));
const TEST_VIDEO_ID = "fedCut2026A";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requestWave(body: Record<string, unknown>): Buffer {
  const inputAudio = body["input_audio"];
  if (!isRecord(inputAudio)) throw new Error("missing input audio");
  const encoded = inputAudio["data"];
  if (typeof encoded !== "string") throw new Error("missing encoded audio");
  return Buffer.from(encoded, "base64");
}

async function collectEvents(events: AsyncIterable<RealtimeAsrEvent>): Promise<RealtimeAsrEvent[]> {
  const collected: RealtimeAsrEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function* onePcmChunk(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function stubMoonshineBackend(mode?: string): RealtimeAsrBackend {
  return createMoonshineAsrBackend({
    command: process.execPath,
    commandArgs: [SIDECAR_FIXTURE, ...(mode ? [mode] : [])],
    workerPath: SIDECAR_PATH,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
  });
}

test("chunks OpenRouter PCM with overlap and sends only the verified default fields", async () => {
  const requestBodies: Array<Record<string, unknown>> = [];
  const authorization: string[] = [];
  const texts = ["hello market close", "market close today"];
  const fetchMock: SourceFetch = async (_input, init) => {
    if (typeof init?.body !== "string") throw new Error("invalid request body");
    const body: unknown = JSON.parse(init.body);
    if (!isRecord(body)) throw new Error("invalid request body");
    requestBodies.push(body);
    authorization.push(new Headers(init.headers).get("Authorization") ?? "");
    return new Response(JSON.stringify({ text: texts[requestBodies.length - 1] ?? "" }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: fetchMock,
    windowMs: 1_000,
    overlapMs: 200,
    retryCount: 0,
  });

  const pcm = new Uint8Array(1_800 * 32);
  for (let index = 0; index < pcm.length; index += 1) pcm[index] = index % 251;
  const events = await collectEvents(transcribePcmStream(onePcmChunk(pcm), { backend }));

  expect(requestBodies).toHaveLength(2);
  expect(requestBodies.map((body) => Object.keys(body).toSorted())).toEqual([
    ["input_audio", "language", "model"],
    ["input_audio", "language", "model"],
  ]);
  const waves = requestBodies.map(requestWave);
  for (const wave of waves) {
    expect(wave.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wave.readUInt16LE(20)).toBe(1);
    expect(wave.readUInt16LE(22)).toBe(1);
    expect(wave.readUInt32LE(24)).toBe(16_000);
    expect(wave.readUInt16LE(34)).toBe(16);
    expect(wave.readUInt32LE(40)).toBe(32_000);
  }
  const firstPcm = waves[0]?.subarray(44);
  const secondPcm = waves[1]?.subarray(44);
  if (!firstPcm || !secondPcm) throw new Error("missing chunk audio");
  expect(firstPcm.equals(Buffer.from(pcm.subarray(0, 1_000 * 32)))).toBe(true);
  expect(secondPcm.equals(Buffer.from(pcm.subarray(800 * 32, 1_800 * 32)))).toBe(true);
  expect(firstPcm.subarray(-200 * 32).equals(secondPcm.subarray(0, 200 * 32))).toBe(true);
  expect(authorization).toEqual(["Bearer test-secret", "Bearer test-secret"]);
  expect(events.map((event) => (event.type === "final" ? event.text : event.type))).toEqual([
    "status",
    "hello market close",
    "today",
  ]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
});

test("retries OpenRouter server failures and redacts provider errors", async () => {
  let calls = 0;
  const fetchMock: SourceFetch = async () => {
    calls += 1;
    if (calls === 1) return new Response("provider body with secret-test-key", { status: 500 });
    return new Response(JSON.stringify({ text: "rates unchanged" }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  const backend = createOpenRouterAsrBackend({
    apiKey: "secret-test-key",
    fetch: fetchMock,
    windowMs: 1_000,
    overlapMs: 200,
    retryCount: 1,
    retryDelayMs: 0,
  });
  const events = await collectEvents(
    transcribePcmStream(onePcmChunk(new Uint8Array(500 * 32)), { backend }),
  );
  expect(calls).toBe(2);
  expect(events[1]).toMatchObject({ type: "final", text: "rates unchanged" });

  const failingBackend = createOpenRouterAsrBackend({
    apiKey: "never-leak-this-key",
    fetch: async () => {
      throw new Error("network failed with never-leak-this-key");
    },
    windowMs: 1_000,
    overlapMs: 200,
    retryCount: 0,
  });
  const message = await rejectionMessage(
    collectEvents(
      transcribePcmStream(onePcmChunk(new Uint8Array(500 * 32)), {
        backend: failingBackend,
      }),
    ),
  );
  expect(message).toBe("OpenRouter transcription failed");
  expect(message).not.toContain("never-leak-this-key");
});

test("aborts a pending OpenRouter request when the event consumer returns", async () => {
  const secondStarted = Promise.withResolvers<void>();
  let secondSignal: AbortSignal | undefined;
  let calls = 0;
  const fetchMock: SourceFetch = async (_input, init) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ text: "first window" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!init?.signal) throw new Error("missing request signal");
    secondSignal = init.signal;
    const pending = Promise.withResolvers<Response>();
    const abort = (): void =>
      pending.reject(init.signal?.reason ?? new Error("request was not aborted"));
    init.signal.addEventListener("abort", abort, { once: true });
    if (init.signal.aborted) abort();
    secondStarted.resolve();
    return pending.promise;
  };
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: fetchMock,
    windowMs: 1_000,
    overlapMs: 200,
    retryCount: 0,
  });
  const iterator = transcribePcmStream(onePcmChunk(new Uint8Array(1_800 * 32)), { backend });

  const ready = await iterator.next();
  const first = await iterator.next();
  await secondStarted.promise;
  const returned = await iterator.return(undefined);

  expect(ready.value).toMatchObject({ type: "status", state: "ready" });
  expect(first.value).toMatchObject({ type: "final", text: "first window" });
  expect(returned.done).toBe(true);
  expect(calls).toBe(2);
  expect(secondSignal?.aborted).toBe(true);
});

test("keeps repeated boundary words when OpenRouter overlap is disabled", async () => {
  let calls = 0;
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ text: "market" }));
    },
    windowMs: 1,
    overlapMs: 0,
    retryCount: 0,
  });

  const events = await collectEvents(
    transcribePcmStream(onePcmChunk(new Uint8Array(2 * 32)), { backend }),
  );
  expect(calls).toBe(2);
  expect(events.flatMap((event) => (event.type === "final" ? [event.text] : []))).toEqual([
    "market",
    "market",
  ]);
});

test("aborts a stalled OpenRouter response body", async () => {
  const responseStarted = Promise.withResolvers<void>();
  const controller = new AbortController();
  let bodyCancelled = false;
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start() {
            responseStarted.resolve();
          },
          cancel() {
            bodyCancelled = true;
          },
        }),
      ),
    windowMs: 1,
    overlapMs: 0,
    retryCount: 0,
  });
  const pending = collectEvents(
    transcribePcmStream(onePcmChunk(new Uint8Array(32)), {
      backend,
      signal: controller.signal,
    }),
  );

  await responseStarted.promise;
  controller.abort(new Error("response cancelled"));
  expect(await rejectionMessage(pending)).toBe("response cancelled");
  expect(bodyCancelled).toBe(true);
});

test("cancels without awaiting an uncooperative PCM source return", async () => {
  const stalled = Promise.withResolvers<IteratorResult<Uint8Array>>().promise;
  let delivered = false;
  let sourceReturnCalled = false;
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      return {
        next(): Promise<IteratorResult<Uint8Array>> {
          if (delivered) return stalled;
          delivered = true;
          return Promise.resolve({ value: new Uint8Array(32), done: false });
        },
        return(): Promise<IteratorResult<Uint8Array>> {
          sourceReturnCalled = true;
          return stalled;
        },
      };
    },
  };
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: async () => new Response(JSON.stringify({ text: "market" })),
    windowMs: 1,
    overlapMs: 0,
    retryCount: 0,
  });
  const iterator = transcribePcmStream(source, { backend });

  expect((await iterator.next()).value).toMatchObject({ type: "status" });
  expect((await iterator.next()).value).toMatchObject({ type: "final", text: "market" });
  expect((await iterator.return(undefined)).done).toBe(true);
  expect(sourceReturnCalled).toBe(true);
});

test("bounds OpenRouter event buffering under sustained output", async () => {
  let calls = 0;
  const backend = createOpenRouterAsrBackend({
    apiKey: "test-secret",
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ text: `window-${calls}` }));
    },
    windowMs: 1,
    overlapMs: 0,
    maxPendingChunks: 4,
    retryCount: 0,
  });
  const session = await backend.open();
  const producing = (async () => {
    await session.write(new Uint8Array(100 * 32));
    await session.close();
  })();
  const events = await collectEvents(session);
  await producing;

  expect(calls).toBe(100);
  expect(events.filter((event) => event.type === "final")).toHaveLength(100);
  expect(events.map((event) => event.sequence)).toEqual(
    Array.from({ length: 101 }, (_, index) => index + 1),
  );
});

test("rejects OpenRouter endpoint origins that could receive credentials", () => {
  expect(() =>
    createOpenRouterAsrBackend({
      apiKey: "test-secret",
      endpoint: "https://openrouter.ai@attacker.invalid/transcriptions",
    }),
  ).toThrow("OpenRouter endpoint must use the https://openrouter.ai origin");
});

test("requires verbose JSON for OpenRouter timestamp granularities", () => {
  expect(() =>
    createOpenRouterAsrBackend({
      apiKey: "test-secret",
      timestampGranularities: ["word"],
    }),
  ).toThrow('OpenRouter timestampGranularities require responseFormat "verbose_json"');
  expect(() =>
    createOpenRouterAsrBackend({
      apiKey: "test-secret",
      responseFormat: "verbose_json",
      timestampGranularities: ["segment", "word"],
    }),
  ).not.toThrow();
});

test("streams Moonshine protocol partials, finals, and explicit gaps", async () => {
  const session = await stubMoonshineBackend().open();
  const collected = collectEvents(session);
  await session.write(new Uint8Array([0, 0, 1, 0]));
  await session.markGap("source", "reconnected");
  await session.close();
  const events = await collected;

  expect(events.map((event) => event.type)).toEqual(["status", "partial", "final", "gap"]);
  expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  expect(events[0]).toMatchObject({ state: "ready" });
  expect(events[1]).toMatchObject({ segmentId: "stub:0:1", revision: 1, text: "market" });
  expect(events[2]).toMatchObject({ segmentId: "stub:0:1", revision: 2, text: "market close" });
  expect(events[3]).toMatchObject({ generation: 0, reason: "source", message: "reconnected" });
});

test("preserves Moonshine revisions, word timings, and UTF-16 speaker spans", async () => {
  const session = await stubMoonshineBackend("metadata").open();
  const collected = collectEvents(session);
  await session.write(new Uint8Array([0, 0]));
  await session.close();
  const events = await collected;

  expect(events[1]).toMatchObject({
    type: "partial",
    segmentId: "stub:0:1",
    revision: 1,
    text: "A😀",
    words: [{ text: "A😀", startMs: 0, durationMs: 100, confidence: 0.9 }],
    speakers: [{ speakerId: "speaker-a", textStart: 0, textEnd: 3 }],
  });
  expect(events[2]).toMatchObject({
    type: "final",
    segmentId: "stub:0:1",
    revision: 2,
    text: "A😀 closes",
  });
});

test("drains sustained Moonshine events without queue deadlock", async () => {
  const session = await stubMoonshineBackend("flood").open();
  const collected = collectEvents(session);
  for (let index = 0; index < 300; index += 1) {
    await session.write(new Uint8Array([index % 256, 0]));
  }
  await session.close();
  const events = await collected;

  expect(events).toHaveLength(601);
  expect(events.filter((event) => event.type === "partial")).toHaveLength(300);
  expect(events.filter((event) => event.type === "final")).toHaveLength(300);
  expect(events.at(-1)?.sequence).toBe(601);
});

test("terminates Moonshine when PCM ends on an incomplete sample", async () => {
  const session = await stubMoonshineBackend().open();
  await session.write(new Uint8Array([1]));
  const message = await rejectionMessage(session.close());
  expect(message).toBe("PCM input must end on a complete 16-bit sample");
});

test("fails Moonshine readiness before consuming PCM when the command is missing", async () => {
  let consumed = false;
  const source: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      consumed = true;
      yield new Uint8Array([0, 0]);
    },
  };
  const backend = createMoonshineAsrBackend({
    command: "xnews-command-that-does-not-exist",
    workerPath: SIDECAR_PATH,
    startupTimeoutMs: 1_000,
    shutdownTimeoutMs: 500,
  });

  const message = await rejectionMessage(collectEvents(transcribePcmStream(source, { backend })));
  expect(consumed).toBe(false);
  expect(message).toContain("Moonshine startup failed");
});

test("rejects a spawned Moonshine sidecar protocol mismatch before consuming PCM", async () => {
  let consumed = false;
  const source: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      consumed = true;
      yield new Uint8Array([0, 0]);
    },
  };
  const backend = createMoonshineAsrBackend({
    command: process.execPath,
    commandArgs: [SIDECAR_FIXTURE, "protocol-mismatch"],
    workerPath: SIDECAR_PATH,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
  });

  const message = await rejectionMessage(collectEvents(transcribePcmStream(source, { backend })));
  expect(consumed).toBe(false);
  expect(message).toBe("Moonshine sidecar protocol mismatch");
});

test("decodes finite YouTube audio without reconnecting at EOF", async () => {
  const events = await collectEvents(
    transcribeYoutubeRealtime(TEST_VIDEO_ID, {
      backend: stubMoonshineBackend(),
      ytDlpCommand: process.execPath,
      ytDlpArgs: [MEDIA_FIXTURE, "yt-finite"],
      ffmpegCommand: process.execPath,
      ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-finite"],
      commandTimeoutMs: 5_000,
    }),
  );

  expect(events.map((event) => event.type)).toEqual(["status", "partial", "final"]);
  expect(events[2]).toMatchObject({ text: "market close" });
});

test("flushes finite YouTube transcript tail before surfacing FFmpeg failure", async () => {
  const events: RealtimeAsrEvent[] = [];
  let message = "";
  try {
    for await (const event of transcribeYoutubeRealtime(TEST_VIDEO_ID, {
      backend: stubMoonshineBackend(),
      ytDlpCommand: process.execPath,
      ytDlpArgs: [MEDIA_FIXTURE, "yt-finite"],
      ffmpegCommand: process.execPath,
      ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-finite-error"],
      commandTimeoutMs: 5_000,
    })) {
      events.push(event);
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(events.map((event) => event.type)).toEqual(["status", "partial", "final"]);
  expect(events[2]).toMatchObject({ text: "market close" });
  expect(message).toBe("FFmpeg decode failed with exit code 7");
});

test("stops live YouTube processes when the event consumer returns", async () => {
  const iterator = transcribeYoutubeRealtime(TEST_VIDEO_ID, {
    backend: stubMoonshineBackend(),
    ytDlpCommand: process.execPath,
    ytDlpArgs: [MEDIA_FIXTURE, "yt-live"],
    ffmpegCommand: process.execPath,
    ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-live-hang"],
    commandTimeoutMs: 5_000,
  });
  const ready = await iterator.next();
  const first = await iterator.next();
  const returned = await iterator.return(undefined);

  expect(ready.value).toMatchObject({ type: "status", state: "ready" });
  expect(first.value).toMatchObject({ type: "partial" });
  expect(returned.done).toBe(true);
});

test("terminates live YouTube decoder descendants on cancellation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xnews-asr-tree-"));
  const pidPath = join(directory, "descendant.pid");
  let descendantPid: number | undefined;
  try {
    const iterator = transcribeYoutubeRealtime(TEST_VIDEO_ID, {
      backend: stubMoonshineBackend(),
      ytDlpCommand: process.execPath,
      ytDlpArgs: [MEDIA_FIXTURE, "yt-live"],
      ffmpegCommand: process.execPath,
      ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-tree-hang", pidPath],
      commandTimeoutMs: 5_000,
    });
    await iterator.next();
    await iterator.next();
    await iterator.return(undefined);

    descendantPid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    let descendantAlive = true;
    try {
      process.kill(descendantPid, 0);
    } catch {
      descendantAlive = false;
    }
    expect(descendantAlive).toBe(false);
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch {
        // The expected path already terminated the descendant.
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test("refreshes live audio URLs and advances generation after a source gap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xnews-asr-"));
  const statePath = join(directory, "resolve-count.txt");
  const events: RealtimeAsrEvent[] = [];
  try {
    const iterator = transcribeYoutubeRealtime(TEST_VIDEO_ID, {
      backend: stubMoonshineBackend(),
      ytDlpCommand: process.execPath,
      ytDlpArgs: [MEDIA_FIXTURE, "yt-live-rotate", statePath],
      ffmpegCommand: process.execPath,
      ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-live-rotate"],
      reconnectAttempts: 2,
      reconnectDelayMs: 0,
      commandTimeoutMs: 5_000,
    });
    while (events.length < 6) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
    }
    await iterator.return(undefined);

    expect(await readFile(statePath, "utf8")).toBe("2");
    expect(events.map((event) => event.type)).toEqual([
      "status",
      "partial",
      "final",
      "gap",
      "partial",
      "final",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.map((event) => event.generation)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(events[4]).toMatchObject({ segmentId: "stub:1:1", revision: 1 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("emits a live source gap, refreshes the URL, and redacts the signed URL", async () => {
  const events: RealtimeAsrEvent[] = [];
  let message = "";
  try {
    for await (const event of transcribeYoutubeRealtime(TEST_VIDEO_ID, {
      backend: stubMoonshineBackend(),
      ytDlpCommand: process.execPath,
      ytDlpArgs: [MEDIA_FIXTURE, "yt-live"],
      ffmpegCommand: process.execPath,
      ffmpegArgs: [MEDIA_FIXTURE, "ffmpeg-live-fail"],
      reconnectAttempts: 1,
      reconnectDelayMs: 0,
      commandTimeoutMs: 5_000,
    })) {
      events.push(event);
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  expect(events.map((event) => event.type)).toEqual([
    "status",
    "partial",
    "final",
    "gap",
    "partial",
    "final",
  ]);
  expect(events[3]).toMatchObject({ reason: "source", recoverable: true });
  expect(message).toBe("FFmpeg live decode failed after 1 reconnects");
  expect(message).not.toContain("signed.invalid");
  expect(message).not.toContain("do-not-expose");
});

test("does not reflect invalid YouTube input in public errors", async () => {
  const secretInput = "not-a-video-id?token=do-not-expose";
  const message = await rejectionMessage(
    collectEvents(
      transcribeYoutubeRealtime(secretInput, {
        backend: stubMoonshineBackend(),
      }),
    ),
  );
  expect(message).toBe("Could not extract a YouTube video ID");
  expect(message).not.toContain(secretInput);
});

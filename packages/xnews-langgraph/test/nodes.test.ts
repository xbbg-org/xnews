import { Buffer } from "node:buffer";
import { expect, test } from "bun:test";
import type {
  DataSource,
  EventSource,
  RealtimeAsrBackend,
  RealtimeAsrEvent,
  RealtimeAsrGapReason,
  RealtimeAsrSession,
} from "@xbbg/xnews";

import {
  createXnewsDataWatchNode,
  createXnewsEventWatchNode,
  createXnewsNewsNode,
  createXnewsRealtimeAsrNode,
} from "../src/index.js";

async function rejectionError(promise: PromiseLike<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("Expected promise to reject");
}

const RSS = `<?xml version="1.0"?><rss><channel><item>
  <title>Checkpointed update</title><link>https://news.test/one</link><guid>news-1</guid>
  <pubDate>Tue, 25 Aug 2026 12:00:00 GMT</pubDate>
</item></channel></rss>`;

test("news node checkpoints ids and does not replay consumed items", async () => {
  const node = createXnewsNewsNode({
    subject: { kind: "topic", query: "markets" },
    sources: ["bing-news"],
  });
  const context = { fetch: async () => new Response(RSS) };
  const first = await node({}, { context });
  const resumed = await node(first, { context });

  expect(first.addedItems).toHaveLength(1);
  expect(first.seenIds).toHaveLength(1);
  expect(resumed.addedItems).toHaveLength(0);
  expect(resumed.seenIds).toEqual(first.seenIds);
});

test("data watch node resumes by sequence and distinguishes repeated failures", async () => {
  const afterSequences: Array<number | undefined> = [];
  const source: DataSource<unknown> = {
    provider: "fixture",
    dataset: "sequenced",
    requestUrls: () => ["https://data.test/sequence"],
    fetchRelease: async (options) => {
      afterSequences.push(options?.afterSequence);
      const sequence = options?.afterSequence === undefined ? 7 : options.afterSequence + 1;
      return {
        provider: "fixture",
        dataset: "sequenced",
        asOf: "2026-08-25",
        sequence,
        url: "https://data.test/sequence",
        rows: [{ sequence, authorization: "issued-data-token" }],
      };
    },
  };
  const node = createXnewsDataWatchNode({ source: "sequence" });
  const first = await node({}, { context: { dataSources: { sequence: source } } });
  const resumed = await node(first, { context: { dataSources: { sequence: source } } });

  expect(first).toMatchObject({ emitted: true, sinceSequence: 7 });
  expect(resumed).toMatchObject({ emitted: true, sinceSequence: 8 });
  expect(afterSequences).toEqual([undefined, 7]);
  expect(JSON.stringify(first)).not.toContain("issued-data-token");

  const failing: DataSource<unknown> = {
    provider: "fixture",
    dataset: "failure",
    requestUrls: () => ["https://data.test/failure"],
    fetchRelease: async () => {
      throw new Error("same failure");
    },
  };
  const failureNode = createXnewsDataWatchNode({ source: "failure" });
  const failedOnce = await failureNode({}, { context: { dataSources: { failure: failing } } });
  const failedTwice = await failureNode(failedOnce, {
    context: { dataSources: { failure: failing } },
  });
  expect(failedOnce.failureCount).toBe(1);
  expect(failedTwice.failureCount).toBe(2);
  expect(failedTwice.emitted).toBe(false);
});

test("event watch node keeps the full snapshot authoritative and checkpoints delta ids", async () => {
  let poll = 0;
  const source: EventSource<string> = {
    provider: "fixture-events",
    dataset: "active",
    requestUrls: () => ["https://events.test/active"],
    fetchSnapshot: async () => {
      poll += 1;
      const events = [
        {
          id: "gdelt-1234567890",
          provider: "fixture-events",
          category: "hazard" as const,
          title: "Existing event",
          severity: "moderate" as const,
        },
        ...(poll > 1
          ? [
              {
                id: "gdelt-1234567891",
                provider: "fixture-events",
                category: "weather" as const,
                title: "New event",
                severity: "severe" as const,
                cookie: "issued-event-cookie",
              },
            ]
          : []),
      ];
      return {
        provider: "fixture-events",
        dataset: "active",
        observedAt: `2026-08-25T12:0${poll}:00.000Z`,
        events,
        warnings: [],
        requestUrls: ["https://events.test/active"],
      };
    },
  };
  const node = createXnewsEventWatchNode({ source: "events", maxSeenIds: 10 });
  const first = await node({}, { context: { eventSources: { events: source } } });
  const resumed = await node(first, { context: { eventSources: { events: source } } });

  expect(first.addedEvents.map((event) => event.id)).toEqual(["gdelt-1234567890"]);
  expect(resumed.addedEvents.map((event) => event.id)).toEqual(["gdelt-1234567891"]);
  expect(resumed.result.events.map((event) => event.id).toSorted()).toEqual([
    "gdelt-1234567890",
    "gdelt-1234567891",
  ]);
  expect(resumed.seenIds).toEqual(["gdelt-1234567890", "gdelt-1234567891"]);
  expect(JSON.stringify(resumed)).not.toContain("issued-event-cookie");
});

class FakeAsrSession implements RealtimeAsrSession {
  readonly backend = "fake-asr";
  readonly #events: RealtimeAsrEvent[] = [
    {
      type: "status",
      state: "ready",
      backend: "fake-asr",
      sequence: 1,
      generation: 1,
      authorization: "issued-asr-token",
    } as RealtimeAsrEvent,
  ];
  #waiter: (() => void) | undefined;
  #closed = false;
  #writes = 0;

  async write(pcm: Uint8Array): Promise<void> {
    this.#writes += 1;
    if (this.#writes === 1) {
      this.#events.push({
        type: "partial",
        backend: this.backend,
        sequence: 2,
        generation: 1,
        startMs: 0,
        durationMs: pcm.byteLength,
        segmentId: "segment-1",
        revision: 1,
        text: "partial",
        timing: "estimated",
      });
    } else {
      this.#events.push({
        type: "gap",
        backend: this.backend,
        sequence: 3,
        generation: 1,
        startMs: 2,
        durationMs: 1,
        reason: "source",
        message: "fixture gap",
        recoverable: true,
      });
      this.#events.push({
        type: "final",
        backend: this.backend,
        sequence: 4,
        generation: 1,
        startMs: 0,
        durationMs: pcm.byteLength,
        segmentId: "segment-1",
        revision: 2,
        text: "final",
        timing: "model",
      });
    }
    this.#waiter?.();
  }

  async markGap(reason: RealtimeAsrGapReason, message = "gap"): Promise<void> {
    this.#events.push({
      type: "gap",
      backend: this.backend,
      sequence: 5,
      generation: 1,
      startMs: 0,
      durationMs: 0,
      reason,
      message,
      recoverable: true,
    });
    this.#waiter?.();
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#waiter?.();
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#waiter?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<RealtimeAsrEvent> {
    while (!this.#closed || this.#events.length > 0) {
      const event = this.#events.shift();
      if (event !== undefined) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
      this.#waiter = undefined;
    }
  }
}

test("realtime ASR node drains finite chunks and checkpoints no live handles", async () => {
  let opens = 0;
  const backend: RealtimeAsrBackend = {
    id: "fake-asr",
    open: async () => {
      opens += 1;
      return new FakeAsrSession();
    },
  };
  const node = createXnewsRealtimeAsrNode({
    backend: "fixture",
    maxConsumedChunkIds: 2,
    maxEvents: 2,
  });
  const initial = {
    consumedChunkIds: ["old-1", "old-2"],
    queuedChunks: [
      { id: "chunk-1", pcmBase64: Buffer.from([1, 2]).toString("base64") },
      { id: "chunk-2", pcmBase64: Buffer.from([3, 4]).toString("base64") },
    ],
  };
  const first = await node(initial, { context: { realtimeAsrBackends: { fixture: backend } } });
  const resumed = await node(first, { context: {} });

  expect(opens).toBe(1);
  expect(first.queuedChunks).toEqual([]);
  expect(first.consumedChunkIds).toEqual(["chunk-1", "chunk-2"]);
  expect(first.events.map((event) => event.type)).toEqual(["gap", "final"]);
  expect(first.lastSequence).toBe(4);
  expect(resumed).toEqual(first);
  expect(() => JSON.stringify(first)).not.toThrow();
  expect(Object.values(first).some((value) => typeof value === "function")).toBe(false);
  expect(JSON.stringify(first)).not.toContain("issued-asr-token");
});

test("realtime ASR node preserves the prior sequence when a session emits no events", async () => {
  const session: RealtimeAsrSession = {
    backend: "empty-asr",
    write: async () => {},
    markGap: async () => {},
    close: async () => {},
    abort: async () => {},
    async *[Symbol.asyncIterator](): AsyncGenerator<RealtimeAsrEvent> {},
  };
  const backend: RealtimeAsrBackend = {
    id: "empty-asr",
    open: async () => session,
  };
  const node = createXnewsRealtimeAsrNode({ backend: "empty" });
  const result = await node(
    {
      lastSequence: 41,
      queuedChunks: [{ id: "chunk", pcmBase64: Buffer.from([1]).toString("base64") }],
    },
    { context: { realtimeAsrBackends: { empty: backend } } },
  );

  expect(result.events).toEqual([]);
  expect(result.lastSequence).toBe(41);
  expect(result.consumedChunkIds).toEqual(["chunk"]);
});
test("realtime ASR node fails finite work on event caps and deadlines without consuming chunks", async () => {
  const endlessSession: RealtimeAsrSession = {
    backend: "endless-asr",
    write: async () => {},
    markGap: async () => {},
    close: async () => {},
    abort: async () => {},
    async *[Symbol.asyncIterator](): AsyncGenerator<RealtimeAsrEvent> {
      let sequence = 0;
      while (true) {
        sequence += 1;
        yield {
          type: "status",
          state: "ready",
          backend: "endless-asr",
          sequence,
          generation: 1,
        };
        await Promise.resolve();
      }
    },
  };
  const stalledSession: RealtimeAsrSession = {
    backend: "stalled-asr",
    write: async () => {},
    markGap: async () => {},
    close: async () => {},
    abort: async () => {},
    async *[Symbol.asyncIterator](): AsyncGenerator<RealtimeAsrEvent> {
      const { promise } = Promise.withResolvers<never>();
      yield await promise;
    },
  };
  const queuedChunks = [{ id: "unconsumed", pcmBase64: Buffer.from([1]).toString("base64") }];

  const cappedNode = createXnewsRealtimeAsrNode({
    backend: "endless",
    maxEventsPerStep: 3,
  });
  const cappedError = await rejectionError(
    cappedNode(
      { queuedChunks },
      {
        context: {
          realtimeAsrBackends: { endless: { id: "endless-asr", open: async () => endlessSession } },
          timeoutMs: 100,
        },
      },
    ),
  );
  expect(cappedError.message).toBe("Node operation failed");
  expect(queuedChunks[0]?.id).toBe("unconsumed");

  const stalledNode = createXnewsRealtimeAsrNode({ backend: "stalled" });
  const stalledError = await rejectionError(
    stalledNode(
      { queuedChunks },
      {
        context: {
          realtimeAsrBackends: { stalled: { id: "stalled-asr", open: async () => stalledSession } },
          timeoutMs: 10,
        },
      },
    ),
  );
  expect(stalledError.message).toBe("Node operation failed");
  expect(queuedChunks[0]?.id).toBe("unconsumed");
});

test("realtime ASR node treats a stream ending exactly at the event cap as complete", async () => {
  const exactSession: RealtimeAsrSession = {
    backend: "exact-asr",
    write: async () => {},
    markGap: async () => {},
    close: async () => {},
    abort: async () => {},
    async *[Symbol.asyncIterator](): AsyncGenerator<RealtimeAsrEvent> {
      for (const sequence of [1, 2, 3]) {
        yield {
          type: "status",
          state: "ready",
          backend: "exact-asr",
          sequence,
          generation: 1,
        };
      }
    },
  };
  const node = createXnewsRealtimeAsrNode({ backend: "exact", maxEventsPerStep: 3 });
  const result = await node(
    { queuedChunks: [{ id: "chunk", pcmBase64: Buffer.from([1]).toString("base64") }] },
    {
      context: {
        realtimeAsrBackends: { exact: { id: "exact-asr", open: async () => exactSession } },
        timeoutMs: 1_000,
      },
    },
  );

  expect(result.events).toHaveLength(3);
  expect(result.lastSequence).toBe(3);
  expect(result.consumedChunkIds).toEqual(["chunk"]);
});

test("finite nodes propagate an already-aborted runtime signal", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stop operator-secret@example.com"));
  const node = createXnewsNewsNode({
    subject: { kind: "topic", query: "markets" },
    sources: ["bing-news"],
  });
  const error = await rejectionError(node({}, { context: { signal: controller.signal } }));
  expect(error.message).toBe("Node operation failed");
  expect(error.message).not.toContain("operator-secret");
});

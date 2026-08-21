import { expect, test } from "bun:test";
import {
  createEventWatcher,
  fetchEventSnapshot,
  fetchEventsAcross,
  filterEvents,
  meetsSeverity,
  sortEvents,
} from "../src/events.js";
import type {
  EventFetchOptions,
  EventProvider,
  EventProviderResult,
  EventRecord,
  EventSnapshot,
  EventSource,
} from "../src/types.js";

function event(overrides: Partial<EventRecord> & Pick<EventRecord, "id">): EventRecord {
  return {
    provider: "nws-alerts",
    category: "weather",
    title: `Event ${overrides.id}`,
    severity: "moderate",
    ...overrides,
  };
}

/**
 * Scripted publisher. Each entry is one poll's outcome: a set of active events,
 * or an `Error` the poll throws. The final entry repeats once the script is
 * exhausted, so a watcher polling past the script sees a steady state.
 */
function stubSource(
  script: readonly (readonly EventRecord[] | Error)[],
  options: {
    readonly provider?: EventProvider;
    readonly dataset?: string;
    readonly warnings?: readonly string[];
  } = {},
): EventSource {
  const provider = options.provider ?? "nws-alerts";
  const dataset = options.dataset ?? "active";
  let calls = 0;
  return {
    provider,
    dataset,
    requestUrls: () => ["https://example.test/alerts"],
    fetchSnapshot: async () => {
      const outcome = script[Math.min(calls, script.length - 1)] ?? [];
      calls += 1;
      if (outcome instanceof Error) throw outcome;
      return {
        provider,
        dataset,
        observedAt: "2026-08-20T00:00:00.000Z",
        events: [...outcome],
        warnings: [...(options.warnings ?? [])],
        requestUrls: ["https://example.test/alerts"],
      } satisfies EventSnapshot;
    },
  };
}

async function takeResults(
  generator: AsyncGenerator<EventProviderResult>,
  count: number,
): Promise<EventProviderResult[]> {
  const results: EventProviderResult[] = [];
  for await (const result of generator) {
    results.push(result);
    if (results.length >= count) break;
  }
  return results;
}

test("an unranked event never satisfies a severity floor", () => {
  // `unknown` sorts below `minor` deliberately: an event the publisher declined
  // to rank is not evidence of a mild one, and letting it through would defeat
  // the filter's purpose.
  expect(meetsSeverity("unknown", "minor")).toBe(false);
  expect(meetsSeverity("minor", "minor")).toBe(true);
  expect(meetsSeverity("extreme", "severe")).toBe(true);
  expect(meetsSeverity("moderate", "severe")).toBe(false);
});

test("filterEvents applies the severity floor and country scope", () => {
  const events = [
    event({ id: "a", severity: "extreme", countryCode: "US" }),
    event({ id: "b", severity: "minor", countryCode: "US" }),
    event({ id: "c", severity: "severe", countryCode: "gb" }),
    event({ id: "d", severity: "severe" }),
  ];

  expect(filterEvents(events, { minSeverity: "severe" }).map((e) => e.id)).toEqual(["a", "c", "d"]);
  // Country matching is case-insensitive on both sides.
  expect(filterEvents(events, { countryCodes: ["GB"] }).map((e) => e.id)).toEqual(["c"]);
  // An event stating no country cannot satisfy a country filter; passing it
  // through would silently widen the caller's scope.
  expect(filterEvents(events, { countryCodes: ["US"] }).map((e) => e.id)).toEqual(["a", "b"]);
  expect(filterEvents(events).map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
});

test("sortEvents orders by urgency then recency", () => {
  const sorted = sortEvents([
    event({ id: "old-extreme", severity: "extreme", observedAt: "2026-08-01T00:00:00.000Z" }),
    event({ id: "new-minor", severity: "minor", observedAt: "2026-08-19T00:00:00.000Z" }),
    event({ id: "new-extreme", severity: "extreme", observedAt: "2026-08-19T00:00:00.000Z" }),
  ]);
  expect(sorted.map((entry) => entry.id)).toEqual(["new-extreme", "old-extreme", "new-minor"]);
});

test("fetchEventSnapshot reports empty, partial, and ok distinctly", async () => {
  const empty = await fetchEventSnapshot(stubSource([[]]));
  expect(empty.status).toBe("empty");
  expect(empty.eventCount).toBe(0);

  const ok = await fetchEventSnapshot(stubSource([[event({ id: "a" })]]));
  expect(ok.status).toBe("ok");
  expect(ok.eventCount).toBe(1);
  expect(ok.requestUrls).toEqual(["https://example.test/alerts"]);

  const partial = await fetchEventSnapshot(
    stubSource([[event({ id: "a" })]], { warnings: ["one region failed"] }),
  );
  expect(partial.status).toBe("partial");
  expect(partial.warnings).toEqual(["one region failed"]);
});

test("fetchEventSnapshot converts a transport failure into an error envelope", async () => {
  const result = await fetchEventSnapshot(stubSource([new Error("upstream exploded")]));
  expect(result.status).toBe("error");
  expect(result.events).toEqual([]);
  expect(result.error?.message).toContain("upstream exploded");
});

test("fetchEventSnapshot rejects duplicate ids so watcher deltas cannot go lossy", async () => {
  const result = await fetchEventSnapshot(
    stubSource([[event({ id: "same" }), event({ id: "same" })]]),
  );
  expect(result.status).toBe("error");
  expect(result.error?.message).toContain("duplicate event id");
});

test("fetchEventSnapshot rejects a snapshot whose provider disagrees with its source", async () => {
  const source: EventSource = {
    provider: "gdacs",
    dataset: "events",
    requestUrls: () => [],
    fetchSnapshot: async () => ({
      provider: "nws-alerts",
      dataset: "events",
      observedAt: "2026-08-20T00:00:00.000Z",
      events: [],
      warnings: [],
      requestUrls: [],
    }),
  };
  const result = await fetchEventSnapshot(source);
  expect(result.status).toBe("error");
  expect(result.error?.message).toContain("inconsistent provider");
});

test("source-level filtering is applied before the status is decided", async () => {
  const result = await fetchEventSnapshot(stubSource([[event({ id: "a", severity: "minor" })]]), {
    minSeverity: "extreme",
  });
  // Every event was filtered out, so the provider has nothing to report.
  expect(result.status).toBe("empty");
  expect(result.events).toEqual([]);
});

test("the watcher yields each event once, not the whole snapshot every poll", async () => {
  const source = stubSource([
    [event({ id: "a" })],
    [event({ id: "a" }), event({ id: "b" })],
    [event({ id: "a" }), event({ id: "b" }), event({ id: "c" })],
  ]);
  const results = await takeResults(createEventWatcher(source, { intervalMs: 0 }), 3);
  // A warning in force across polls must not re-fire; only new ids appear.
  expect(results.map((result) => result.events.map((entry) => entry.id))).toEqual([
    ["a"],
    ["b"],
    ["c"],
  ]);
});

test("the watcher does not replay ids supplied as already seen", async () => {
  const source = stubSource([[event({ id: "a" }), event({ id: "b" })]]);
  const results = await takeResults(
    createEventWatcher(source, { intervalMs: 0, seenIds: ["a"] }),
    1,
  );
  expect(results[0]?.events.map((entry) => entry.id)).toEqual(["b"]);
});

test("the watcher rejects a nonsensical id budget", async () => {
  const results: EventProviderResult[] = [];
  for await (const result of createEventWatcher(stubSource([[event({ id: "a" })]]), {
    intervalMs: 0,
    maxSeenIds: 0,
  })) {
    results.push(result);
  }
  expect(results).toHaveLength(1);
  expect(results[0]?.status).toBe("disabled");
  expect(results[0]?.error?.code).toBe("config");
});

test("the watcher reports a repeated failure once, then recovers", async () => {
  // Two identical failures then a success. Yields must be [error, ok] — the
  // second failure is suppressed, which is observable without any wall clock
  // because the next yield is the recovery, not a duplicate error.
  const source = stubSource([
    new Error("still down"),
    new Error("still down"),
    [event({ id: "a" })],
  ]);
  const results = await takeResults(createEventWatcher(source, { intervalMs: 0 }), 2);

  expect(results.map((result) => result.status)).toEqual(["error", "ok"]);
  expect(results[1]?.events.map((entry) => entry.id)).toEqual(["a"]);
});

test("the watcher re-reports a failure when the reason changes", async () => {
  const source = stubSource([new Error("dns failure"), new Error("gateway timeout")]);
  const results = await takeResults(createEventWatcher(source, { intervalMs: 0 }), 2);

  expect(results.map((result) => result.status)).toEqual(["error", "error"]);
  expect(results[0]?.error?.message).toContain("dns failure");
  expect(results[1]?.error?.message).toContain("gateway timeout");
});

test("fetchEventsAcross merges publishers and survives one failing", async () => {
  const merged = await fetchEventsAcross([
    stubSource([[event({ id: "a", severity: "severe" })]]),
    stubSource([new Error("gdacs down")], { provider: "gdacs" }),
  ]);

  expect(merged.events.map((entry) => entry.id)).toEqual(["a"]);
  expect(merged.results).toHaveLength(2);
  expect(merged.results.find((result) => result.provider === "gdacs")?.status).toBe("error");
});

test("fetch options reach the source unchanged", async () => {
  let seen: EventFetchOptions | undefined;
  const source: EventSource = {
    provider: "faa-status",
    dataset: "airport-status",
    requestUrls: () => [],
    fetchSnapshot: async (options) => {
      seen = options;
      return undefined;
    },
  };
  await fetchEventSnapshot(source, { minSeverity: "severe", countryCodes: ["US"] });
  expect(seen?.minSeverity).toBe("severe");
  expect(seen?.countryCodes).toEqual(["US"]);
});

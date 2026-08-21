/**
 * The events lane: generic machinery for active-state publishers.
 *
 * News providers answer with dated documents, data providers with dated rows,
 * and works providers with undated catalog records. A fourth shape does not
 * fit any of them: publishers that answer with *the set of things currently
 * in force* — storm warnings, elevated volcanoes, airport ground stops. That
 * set has no release date to key on and no natural ordering, it changes
 * continuously rather than on a schedule, and the interesting question is not
 * "is there a newer release" but "what appeared since I last looked".
 *
 * So this lane keys on event identity. `fetchEventSnapshot` wraps any source
 * in the same non-throwing status taxonomy the other lanes give providers,
 * and `createEventWatcher` diffs snapshots by id to yield events as they
 * appear — the events-lane counterpart of `createTopicNewsWatcher`'s
 * `seenIds`.
 *
 * Built-in sources live under `src/sources/`; consumers can implement
 * `EventSource` for their own publishers and reuse everything here.
 */

import { sleep } from "./async.js";
import { providerErrorFromUnknown } from "./http.js";
import type {
  EventFetchOptions,
  EventProviderResult,
  EventRecord,
  EventSeverity,
  EventSnapshot,
  EventSource,
  EventWatcherOptions,
  ProviderError,
} from "./types.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const DEFAULT_MAX_SEEN_IDS = 10_000;

/**
 * Ascending urgency. `unknown` sorts at the bottom so a `minSeverity` filter
 * excludes unranked events: an event the publisher declined to rank is not
 * evidence of a mild one, and including it would let unranked noise through a
 * filter whose whole purpose is to exclude noise. Callers who want everything
 * simply omit `minSeverity`.
 */
const SEVERITY_RANK: Readonly<Record<EventSeverity, number>> = {
  unknown: 0,
  minor: 1,
  moderate: 2,
  severe: 3,
  extreme: 4,
};

/**
 * Fetches one snapshot through the shared status taxonomy. Never throws:
 * transport failures land in `error` with `status: "error"`, caller
 * configuration preconditions land in `status: "disabled"`, and a snapshot
 * that parsed with warnings but still yielded events is `"partial"`.
 */
export async function fetchEventSnapshot(
  source: EventSource,
  options: EventFetchOptions = {},
): Promise<EventProviderResult> {
  const startedAt = Date.now();
  let requestUrls: readonly string[] = [];
  try {
    requestUrls = source.requestUrls(options);
    const snapshot = await source.fetchSnapshot(options);
    if (snapshot !== undefined) validateSnapshot(source, snapshot);
    const filtered = snapshot === undefined ? undefined : filterSnapshot(snapshot, options);
    return eventProviderResult(source, {
      status: statusOf(filtered),
      ...(filtered ? { snapshot: filtered } : {}),
      startedAt,
      // A source may dial URLs the pre-flight estimate could not know;
      // the snapshot's own list is authoritative when it states one.
      requestUrls: filtered && filtered.requestUrls.length > 0 ? filtered.requestUrls : requestUrls,
    });
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    return eventProviderResult(source, {
      // A config precondition is the caller's decision, not a transport
      // failure: the provider is disabled until the caller supplies it.
      status: providerError.code === "config" ? "disabled" : "error",
      warnings: [`${source.provider}: ${providerError.message}`],
      startedAt,
      requestUrls,
      error: providerError,
    });
  }
}

/**
 * Fetches several publishers concurrently and merges their events. Every
 * source's envelope is returned so one failing publisher degrades the merge
 * instead of failing it. Events are returned most urgent first, then most
 * recently observed.
 */
export async function fetchEventsAcross(
  sources: readonly EventSource[],
  options: EventFetchOptions = {},
): Promise<{
  readonly events: readonly EventRecord[];
  readonly results: readonly EventProviderResult[];
}> {
  const results = await Promise.all(sources.map((source) => fetchEventSnapshot(source, options)));
  return { events: sortEvents(results.flatMap((result) => result.events)), results };
}

/**
 * Polls a publisher and yields each event the first time it is seen.
 *
 * Unlike the data lane's watcher this never re-yields a whole payload: a
 * snapshot is the current state, so re-emitting it every poll would report
 * a week-long hurricane warning as new every five minutes. Instead ids are
 * remembered and only unseen events are yielded, bounded by `maxSeenIds`
 * with oldest-first eviction so a high-churn publisher cannot grow memory
 * without limit.
 *
 * Failed polls are yielded once per distinct failure — consecutive identical
 * failures are suppressed until a poll succeeds — matching the data lane.
 * Polls that surface no unseen events yield nothing. Like the other lanes'
 * watchers, the generator runs until `signal` aborts.
 */
export async function* createEventWatcher(
  source: EventSource,
  options: EventWatcherOptions = {},
): AsyncGenerator<EventProviderResult> {
  const maxSeenIds = options.maxSeenIds ?? DEFAULT_MAX_SEEN_IDS;
  if (!Number.isSafeInteger(maxSeenIds) || maxSeenIds < 1) {
    yield eventProviderResult(source, {
      status: "disabled",
      warnings: [`${source.provider}: maxSeenIds must be a positive safe integer`],
      startedAt: Date.now(),
      requestUrls: [],
      error: { code: "config", message: "maxSeenIds must be a positive safe integer" },
    });
    return;
  }

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  // Insertion-ordered, so eviction is oldest-first.
  const seen = new Set<string>(options.seenIds ?? []);
  evictOldest(seen, maxSeenIds);
  let lastFailureKey: string | undefined;

  while (!options.signal?.aborted) {
    const result = await fetchEventSnapshot(source, options);
    if (result.status === "error" || result.status === "disabled") {
      const failureKey = failureKeyOf(result.status, result.error);
      if (failureKey !== lastFailureKey) {
        lastFailureKey = failureKey;
        yield result;
      }
    } else {
      lastFailureKey = undefined;
      const fresh = result.events.filter((event) => !seen.has(event.id));
      if (fresh.length > 0) {
        for (const event of fresh) seen.add(event.id);
        evictOldest(seen, maxSeenIds);
        yield withEvents(result, fresh);
      }
    }
    if (options.signal?.aborted) break;
    await sleep(intervalMs, options.signal, "Event watcher aborted");
  }
}

/** Most urgent first, then most recently observed, then by id for stability. */
export function sortEvents(events: readonly EventRecord[]): readonly EventRecord[] {
  return events.toSorted((left, right) => {
    const bySeverity = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (bySeverity !== 0) return bySeverity;
    const byObserved = (right.observedAt ?? "").localeCompare(left.observedAt ?? "");
    if (byObserved !== 0) return byObserved;
    return left.id.localeCompare(right.id);
  });
}

/** Whether `severity` is at least `floor` on the normalized scale. */
export function meetsSeverity(severity: EventSeverity, floor: EventSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}

/**
 * Applies the lane-wide `minSeverity` and `countryCodes` filters. Sources
 * call this so every publisher honors both options identically, including
 * publishers whose upstream API cannot filter server-side.
 */
export function filterEvents(
  events: readonly EventRecord[],
  options: EventFetchOptions = {},
): readonly EventRecord[] {
  const floor = options.minSeverity;
  const countries =
    options.countryCodes === undefined
      ? undefined
      : new Set(options.countryCodes.map((code) => code.toUpperCase()));
  return events.filter((event) => {
    if (floor !== undefined && !meetsSeverity(event.severity, floor)) return false;
    // An event with no stated country cannot satisfy a country filter;
    // passing it through would silently widen the caller's scope.
    if (countries !== undefined) {
      if (event.countryCode === undefined) return false;
      if (!countries.has(event.countryCode.toUpperCase())) return false;
    }
    return true;
  });
}

function filterSnapshot(snapshot: EventSnapshot, options: EventFetchOptions): EventSnapshot {
  const events = filterEvents(snapshot.events, options);
  return events.length === snapshot.events.length ? snapshot : { ...snapshot, events };
}

function statusOf(snapshot: EventSnapshot | undefined): EventProviderResult["status"] {
  if (snapshot === undefined || snapshot.events.length === 0) return "empty";
  return snapshot.warnings.length > 0 ? "partial" : "ok";
}

function evictOldest(seen: Set<string>, maxSeenIds: number): void {
  if (seen.size <= maxSeenIds) return;
  const excess = seen.size - maxSeenIds;
  let removed = 0;
  for (const id of seen) {
    seen.delete(id);
    if (++removed >= excess) break;
  }
}

function withEvents(
  result: EventProviderResult,
  events: readonly EventRecord[],
): EventProviderResult {
  const sorted = sortEvents(events);
  return {
    ...result,
    ...(result.snapshot ? { snapshot: { ...result.snapshot, events: sorted } } : {}),
    events: sorted,
    eventCount: sorted.length,
  };
}

function failureKeyOf(status: string, error: ProviderError | undefined): string {
  return `${status}:${error?.code ?? ""}:${error?.status ?? ""}:${error?.message ?? ""}`;
}

function validateSnapshot(source: EventSource, snapshot: EventSnapshot): void {
  if (snapshot.provider !== source.provider) {
    throw new RangeError("EventSource returned a snapshot with an inconsistent provider");
  }
  if (snapshot.dataset !== source.dataset) {
    throw new RangeError("EventSource returned a snapshot with an inconsistent dataset");
  }
  if (Number.isNaN(Date.parse(snapshot.observedAt))) {
    throw new RangeError("EventSource returned a snapshot with an invalid observedAt instant");
  }
  const ids = new Set<string>();
  for (const event of snapshot.events) {
    if (event.id === "") {
      throw new RangeError("EventSource returned an event with an empty id");
    }
    // Duplicate ids would make the watcher's delta silently lossy.
    if (ids.has(event.id)) {
      throw new RangeError(`EventSource returned duplicate event id ${event.id}`);
    }
    ids.add(event.id);
  }
}

function eventProviderResult(
  source: EventSource,
  options: {
    readonly status: EventProviderResult["status"];
    readonly snapshot?: EventSnapshot;
    readonly warnings?: readonly string[];
    readonly startedAt: number;
    readonly requestUrls: readonly string[];
    readonly error?: ProviderError;
  },
): EventProviderResult {
  const events = options.snapshot ? sortEvents(options.snapshot.events) : [];
  return {
    provider: source.provider,
    dataset: source.dataset,
    status: options.status,
    ...(options.snapshot ? { snapshot: { ...options.snapshot, events } } : {}),
    events,
    eventCount: events.length,
    warnings: options.warnings ?? options.snapshot?.warnings ?? [],
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAt,
    requestUrls: options.requestUrls,
    ...(options.error ? { error: options.error } : {}),
  };
}

/**
 * The data lane: generic machinery for scheduled structured-data releases.
 *
 * News providers return dated documents; data providers return dated rows.
 * A `DataSource` binds one provider dataset to its transport, and this
 * module wraps any source in the same non-throwing status taxonomy and
 * polling semantics the news lane gives providers. Built-in sources live
 * under `src/sources/` (see `cotDataSource`); consumers can implement
 * `DataSource` for their own publishers and reuse everything here.
 */

import { sleep } from "./async.js";
import { providerErrorFromUnknown } from "./http.js";
import type {
  DataFetchOptions,
  DataProviderResult,
  DataRelease,
  DataReleaseWatcherOptions,
  DataSource,
  ProviderError,
} from "./types.js";

/**
 * Fetches one release through the shared status taxonomy. Never throws:
 * transport failures land in `error` with `status: "error"`, and caller
 * configuration preconditions land in `status: "disabled"`, mirroring the
 * news lane's `ProviderResult`.
 */
export async function fetchDataRelease<Row>(
  source: DataSource<Row>,
  options: DataFetchOptions = {},
): Promise<DataProviderResult<Row>> {
  const startedAt = Date.now();
  let requestUrls: readonly string[] = [];
  try {
    requestUrls = source.requestUrls(options);
    const release = await source.fetchRelease(options);
    if (release !== undefined) validateDataRelease(source, release);
    return dataProviderResult(source, {
      status: release === undefined ? "empty" : "ok",
      ...(release ? { release } : {}),
      warnings: [],
      startedAt,
      requestUrls,
    });
  } catch (error) {
    const providerError = providerErrorFromUnknown(error);
    return dataProviderResult(source, {
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
 * Polls a source and yields a result whenever a new release appears. For
 * sources that publish one release per date, "new" means a strictly later
 * `asOf` (ISO date strings compare lexically). For sequenced sources —
 * releases carrying a monotonic `sequence` — "new" means a strictly greater
 * `sequence`, the last yielded `sequence` is passed as `afterSequence` so
 * the source serves a backlog in order, and the backlog is drained without
 * sleeping between polls. Failed polls are yielded once per distinct
 * failure — consecutive identical failures are suppressed until a poll
 * succeeds — and empty polls or already-seen releases yield nothing. Each
 * poll passes the last known `asOf` as `ifNewerThan` so heavy sources can
 * skip re-downloading an unchanged upstream. Like the news watchers, the
 * generator runs until `signal` aborts.
 */
export async function* createDataReleaseWatcher<Row>(
  source: DataSource<Row>,
  options: DataReleaseWatcherOptions = {},
): AsyncGenerator<DataProviderResult<Row>> {
  const checkpointError = validateWatcherCheckpoints(options);
  if (checkpointError !== undefined) {
    yield dataProviderResult(source, {
      status: "disabled",
      warnings: [`${source.provider}: ${checkpointError.message}`],
      startedAt: Date.now(),
      requestUrls: [],
      error: checkpointError,
    });
    return;
  }
  const intervalMs = options.intervalMs ?? 15 * 60_000;
  let lastAsOf = options.sinceAsOf ?? "";
  let lastSequence = options.sinceSequence;
  let lastFailureKey: string | undefined;

  while (!options.signal?.aborted) {
    const result = await fetchDataRelease(source, {
      ...options,
      ...(lastAsOf === "" ? {} : { ifNewerThan: lastAsOf }),
      ...(lastSequence === undefined ? {} : { afterSequence: lastSequence }),
    });
    if (result.status === "ok" && result.release) {
      lastFailureKey = undefined;
      const release = result.release;
      // Before the first sequenced yield the date gate applies, so
      // `sinceAsOf` keeps its contract for sequenced sources too.
      const isNew =
        release.sequence !== undefined && lastSequence !== undefined
          ? release.sequence > lastSequence
          : release.asOf > lastAsOf;
      if (isNew) {
        if (release.asOf > lastAsOf) lastAsOf = release.asOf;
        if (release.sequence !== undefined) lastSequence = release.sequence;
        yield result;
        // A sequenced release may be one of many pending; poll again
        // immediately until the source reports no newer release.
        if (release.sequence !== undefined) continue;
      }
    } else if (result.status === "error" || result.status === "disabled") {
      const failureKey = failureKeyOf(result.status, result.error);
      if (failureKey !== lastFailureKey) {
        lastFailureKey = failureKey;
        yield result;
      }
    } else {
      lastFailureKey = undefined;
    }
    if (options.signal?.aborted) break;
    await sleep(intervalMs, options.signal, "Data watcher aborted");
  }
}

function failureKeyOf(status: string, error: ProviderError | undefined): string {
  return `${status}:${error?.code ?? ""}:${error?.status ?? ""}:${error?.message ?? ""}`;
}

function validateDataRelease<Row>(source: DataSource<Row>, release: DataRelease<Row>): void {
  if (release.provider !== source.provider) {
    throw new RangeError("DataSource returned a release with an inconsistent provider");
  }
  if (release.dataset !== source.dataset) {
    throw new RangeError("DataSource returned a release with an inconsistent dataset");
  }
  if (!isCanonicalIsoDate(release.asOf)) {
    throw new RangeError("DataSource returned a release with an invalid asOf date");
  }
  if (release.sequence !== undefined && !Number.isSafeInteger(release.sequence)) {
    throw new RangeError("DataSource returned a release with an invalid sequence");
  }
}

function validateWatcherCheckpoints(options: DataReleaseWatcherOptions): ProviderError | undefined {
  if (options.sinceAsOf !== undefined && !isCanonicalIsoDate(options.sinceAsOf)) {
    return {
      code: "config",
      message: "sinceAsOf must be a real ISO date in YYYY-MM-DD form",
    };
  }
  if (options.sinceSequence !== undefined && !Number.isSafeInteger(options.sinceSequence)) {
    return {
      code: "config",
      message: "sinceSequence must be a finite safe integer",
    };
  }
  return undefined;
}

function isCanonicalIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dataProviderResult<Row>(
  source: DataSource<Row>,
  options: {
    readonly status: DataProviderResult<Row>["status"];
    readonly release?: DataRelease<Row>;
    readonly warnings: readonly string[];
    readonly startedAt: number;
    readonly requestUrls: readonly string[];
    readonly error?: ProviderError;
  },
): DataProviderResult<Row> {
  return {
    provider: source.provider,
    dataset: source.dataset,
    status: options.status,
    ...(options.release ? { release: options.release } : {}),
    rowCount: options.release?.rows.length ?? 0,
    warnings: options.warnings,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - options.startedAt,
    requestUrls: options.requestUrls,
    ...(options.error ? { error: options.error } : {}),
  };
}

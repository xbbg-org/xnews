const DEFAULT_FINITE_STEP_TIMEOUT_MS = 30_000;
const MAX_FINITE_STEP_TIMEOUT_MS = 120_000;

export interface BoundedAsyncResult<T> {
  readonly items: readonly T[];
  readonly truncated: boolean;
}

export function finiteStepSignal(
  upstream: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal {
  const boundedTimeout =
    timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.min(Math.trunc(timeoutMs), MAX_FINITE_STEP_TIMEOUT_MS)
      : DEFAULT_FINITE_STEP_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(boundedTimeout);
  return upstream === undefined ? deadline : AbortSignal.any([upstream, deadline]);
}

export async function collectBoundedAsync<T>(
  iterable: AsyncIterable<T>,
  maxItems: number,
  signal: AbortSignal,
): Promise<BoundedAsyncResult<T>> {
  const iterator = iterable[Symbol.asyncIterator]();
  const items: T[] = [];
  let completed = false;
  try {
    while (items.length < maxItems) {
      const next = await nextWithSignal(iterator, signal);
      if (next.done) {
        completed = true;
        break;
      }
      items.push(next.value);
    }
    // `maxItems` bounds retention, not completion: a stream ending exactly at the cap
    // omitted nothing. One lookahead separates that from a genuine overflow, and the
    // probed value is dropped so retention never exceeds `maxItems`.
    if (!completed) {
      const probe = await nextWithSignal(iterator, signal);
      if (probe.done) completed = true;
    }
  } finally {
    if (!completed) closeDetached(iterator);
  }
  return { items, truncated: !completed };
}

function nextWithSignal<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  const { promise, resolve, reject } = Promise.withResolvers<IteratorResult<T>>();
  const onAbort = (): void => reject(abortReason(signal));
  signal.addEventListener("abort", onAbort, { once: true });
  void Promise.resolve(iterator.next())
    .then(resolve, reject)
    .finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  return promise;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function closeDetached<T>(iterator: AsyncIterator<T>): void {
  if (iterator.return === undefined) return;
  try {
    void Promise.resolve(iterator.return()).catch(() => undefined);
  } catch {
    // The caller's finite step has already ended; provider teardown cannot block it.
  }
}

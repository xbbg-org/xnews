/** Abortable delay shared by the news and data watchers. Rejects with the
 * signal's reason (or `abortMessage`) when aborted mid-sleep. */
export function sleep(ms: number, signal?: AbortSignal, abortMessage = "Aborted"): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timeout = setTimeout(resolve, ms);
  const onAbort = (): void => {
    clearTimeout(timeout);
    reject(signal?.reason instanceof Error ? signal.reason : new Error(abortMessage));
  };

  signal?.addEventListener("abort", onAbort, { once: true });
  return promise.finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  });
}

import type {
  RealtimeAsrEvent,
  RealtimeAsrSessionOptions,
  TranscribePcmStreamOptions,
} from "./types";

/**
 * Transcribes a finite or live stream of mono 16 kHz s16le PCM frames.
 * The backend is ready before the source iterator is created.
 */
export async function* transcribePcmStream(
  source: AsyncIterable<Uint8Array>,
  options: TranscribePcmStreamOptions,
): AsyncGenerator<RealtimeAsrEvent> {
  const sessionOptions: RealtimeAsrSessionOptions = options.signal
    ? { signal: options.signal }
    : {};
  const session = await options.backend.open(sessionOptions);

  let sourceIterator: AsyncIterator<Uint8Array>;
  try {
    sourceIterator = source[Symbol.asyncIterator]();
  } catch (error) {
    await session.abort(error).catch(() => undefined);
    throw error;
  }

  let pumpFinished = false;
  const pump = (async (): Promise<void> => {
    try {
      while (true) {
        const next = await sourceIterator.next();
        if (next.done) break;
        if (next.value.byteLength > 0) await session.write(next.value);
      }
      await session.close();
    } catch (error) {
      await session.abort(error).catch(() => undefined);
      throw error;
    } finally {
      pumpFinished = true;
    }
  })();
  void pump.catch(() => undefined);

  let completed = false;
  try {
    for await (const event of session) yield event;
    await pump;
    completed = true;
  } finally {
    if (!completed) {
      await session.abort();
      if (!pumpFinished && sourceIterator.return) {
        try {
          void Promise.resolve(sourceIterator.return()).catch(() => undefined);
        } catch {
          // A source iterator can reject cancellation; backend teardown still owns completion.
        }
      }
      void pump.catch(() => undefined);
    }
  }
}

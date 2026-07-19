interface QueueWaiter<T> {
  readonly resolve: (result: IteratorResult<T>) => void;
  readonly reject: (reason: unknown) => void;
}

interface QueueNode<T> {
  readonly value: T;
  next: QueueNode<T> | undefined;
}

interface QueueSizeWaiter {
  readonly limit: number;
  readonly resolve: () => void;
}

/** Single-consumer async queue used by ASR sessions. */
export class AsyncEventQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private readonly waiters: QueueWaiter<T>[] = [];
  private readonly sizeWaiters: QueueSizeWaiter[] = [];
  private readonly onSizeChange: ((size: number) => void) | undefined;
  private head: QueueNode<T> | undefined;
  private tail: QueueNode<T> | undefined;
  private buffered = 0;
  private closed = false;
  private failed = false;
  private failure: unknown;

  constructor(onSizeChange?: (size: number) => void) {
    this.onSizeChange = onSizeChange;
  }

  get size(): number {
    return this.buffered;
  }

  push(value: T): boolean {
    if (this.closed || this.failed) return false;

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value, done: false });
    } else {
      const node: QueueNode<T> = { value, next: undefined };
      if (this.tail) {
        this.tail.next = node;
      } else {
        this.head = node;
      }
      this.tail = node;
      this.buffered += 1;
      this.onSizeChange?.(this.buffered);
    }
    return true;
  }

  close(): void {
    if (this.closed || this.failed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
    this.resolveSizeWaiters();
  }

  fail(error: unknown): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    this.resolveSizeWaiters();
  }

  next(): Promise<IteratorResult<T>> {
    const node = this.head;
    if (node) {
      this.head = node.next;
      if (!this.head) this.tail = undefined;
      this.buffered -= 1;
      this.onSizeChange?.(this.buffered);
      this.resolveSizeWaiters();
      return Promise.resolve({ value: node.value, done: false });
    }
    if (this.failed) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });

    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  waitForSizeBelow(limit: number): Promise<void> {
    if (this.buffered < limit || this.closed || this.failed) return Promise.resolve();
    return new Promise<void>((resolve) => this.sizeWaiters.push({ limit, resolve }));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }

  private resolveSizeWaiters(): void {
    for (let index = this.sizeWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.sizeWaiters[index];
      if (waiter && (this.buffered < waiter.limit || this.closed || this.failed)) {
        this.sizeWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

export function cancellableAsyncIterator<T>(
  iterator: AsyncIterator<T>,
  cancel: (reason?: unknown) => Promise<void>,
): AsyncIterator<T> {
  let terminal = false;
  return {
    async next(): Promise<IteratorResult<T>> {
      try {
        const result = await iterator.next();
        if (result.done) terminal = true;
        return result;
      } catch (error) {
        terminal = true;
        throw error;
      }
    },
    async return(): Promise<IteratorResult<T>> {
      if (!terminal) await cancel();
      terminal = true;
      return { value: undefined, done: true };
    },
    async throw(error?: unknown): Promise<IteratorResult<T>> {
      if (!terminal) await cancel(error);
      terminal = true;
      throw error;
    },
  };
}

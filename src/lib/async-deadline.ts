export type DeadlineResult<T> =
  | { state: "ready"; value: T }
  | { state: "unavailable"; value: null };

type DeadlineOptions = {
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

/** Bound read-only work even when its transport ignores cancellation. */
export async function withinDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  options: DeadlineOptions = {},
): Promise<DeadlineResult<T>> {
  const now = options.now ?? Date.now;
  const remaining = Math.max(0, deadline - now());
  if (remaining === 0) return { state: "unavailable", value: null };

  const controller = new AbortController();
  const schedule = options.schedule ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = options.cancel ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let timer: unknown;
  try {
    const timeout = new Promise<DeadlineResult<T>>((resolve) => {
      timer = schedule(() => {
        controller.abort();
        resolve({ state: "unavailable", value: null });
      }, remaining);
    });
    const result = Promise.resolve()
      .then(() => work(controller.signal))
      .then<DeadlineResult<T>, DeadlineResult<T>>(
        (value) => ({ state: "ready", value }),
        () => ({ state: "unavailable", value: null }),
      );
    return await Promise.race([result, timeout]);
  } finally {
    if (timer !== undefined) cancel(timer);
  }
}

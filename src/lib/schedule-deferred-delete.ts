const UNDO_WINDOW_MS = 4_000;

export function scheduleDeferredDelete(
  deleteFn: () => Promise<void>,
  delayMs = UNDO_WINDOW_MS,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void deleteFn();
  }, delayMs);
}

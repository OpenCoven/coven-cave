import type { RunBufferHandle } from "./chat-stream-buffer";

type RunDetachCleanupOptions = {
  runBuffer: RunBufferHandle;
  signal: AbortSignal;
  isStopRequested: () => boolean;
  timeoutMs: number;
  onTimeout: () => void;
};

/**
 * Reconciles an aborted original stream with resumable live tails. A live
 * tail always wins over an abort; only an aborted run with no live tail gets
 * the detach deadline.
 */
export function wireRunDetachCleanup(options: RunDetachCleanupOptions): () => void {
  let liveTailAttached = false;
  let closed = false;
  let timeoutFired = false;
  let detachTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDetachTimer = () => {
    if (detachTimer == null) return;
    clearTimeout(detachTimer);
    detachTimer = null;
  };

  const reconcile = () => {
    if (
      closed
      || !options.signal.aborted
      || liveTailAttached
      || options.isStopRequested()
      || timeoutFired
    ) {
      clearDetachTimer();
      return;
    }
    if (detachTimer != null) return;
    detachTimer = setTimeout(() => {
      detachTimer = null;
      timeoutFired = true;
      options.onTimeout();
    }, options.timeoutMs);
  };

  options.runBuffer.setHooks({
    attach: () => {
      liveTailAttached = true;
      reconcile();
    },
    detach: () => {
      liveTailAttached = false;
      reconcile();
    },
  });

  const onAbort = () => reconcile();
  options.signal.addEventListener("abort", onAbort, { once: true });
  // An AbortSignal does not replay an abort that happened before listener
  // installation. `setHooks()` synchronously reports an existing live tail,
  // so this single reconciliation handles both pre-aborted states correctly.
  reconcile();

  return () => {
    if (closed) return;
    closed = true;
    options.signal.removeEventListener("abort", onAbort);
    clearDetachTimer();
    options.runBuffer.setHooks(null);
  };
}

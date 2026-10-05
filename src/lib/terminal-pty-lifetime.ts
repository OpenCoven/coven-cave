/** Effect-scoped ownership for temporary terminals. Wait for the actual
 * transport handshake (not its UI timeout) before reaping a late PTY. */
export function createTerminalPtyLifetime(threadId: string, ephemeral: boolean) {
  let disposed = false;
  let pending = 0;
  let stopped = false;
  let stop: (() => unknown) | undefined;
  const reap = () => {
    if (!ephemeral || !disposed || pending || stopped || !stop) return;
    stopped = true;
    try {
      void Promise.resolve(stop()).catch(() => {});
    } catch { /* the transport may already have exited */ }
  };
  return {
    // A late cleanup must never kill a newer Strict Mode mount or retry.
    threadId: ephemeral ? `${threadId}.${crypto.randomUUID()}` : threadId,
    async run<T>(start: () => Promise<T>, stopTransport: () => unknown): Promise<T | undefined> {
      if (disposed) return;
      stop = stopTransport;
      pending++;
      try {
        return await start();
      } finally {
        pending--;
        reap();
      }
    },
    dispose() {
      disposed = true;
      reap();
    },
  };
}

// Test-side wait: poll for a condition instead of sleeping a guessed interval.
//
// A `await new Promise(r => setTimeout(r, 15))` before an assertion says "the
// work should be done by now" — which is a bet on the host's event loop, not a
// statement about the code. It fails on a busy machine and reads as a bare
// value mismatch, with nothing pointing at the deadline that actually lost.
// (See PR #4015: a launcher test inherited a 2.5s UI budget as a correctness
// assertion and failed intermittently for months' worth of runs.)
//
// Polling flips the trade: a fast machine proceeds the moment the condition
// holds, a slow one gets as long as it needs, and a genuine regression still
// fails — at the ceiling, with a message naming what was awaited.

export type WaitForOptions = {
  /** Upper bound before giving up. Generous by design: it exists to fail a
   *  real regression, not to police latency. */
  timeoutMs?: number;
  /** Gap between checks. Small enough to keep fast paths fast. */
  intervalMs?: number;
  /** What we were waiting for, quoted in the timeout error. */
  describe?: string;
};

/** Resolve once `condition()` returns truthy; reject at the ceiling.
 *
 *  The condition is checked immediately, so an already-satisfied wait costs
 *  nothing and the common case adds no wall-clock time to the suite. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 2000, intervalMs = 5, describe = "condition" }: WaitForOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) {
      throw new Error(`waitFor: timed out after ${timeoutMs}ms waiting for ${describe}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Pure decision helpers for the onboarding install queue.
 *
 * npm global installs share one lane — the install route 409s a second
 * concurrent npm target — so the onboarding overlay can only run one at a time.
 * To make "install both" work (rather than failing the second), npm targets are
 * queued and drained one at a time. Script installs (e.g. Hermes) are
 * independent and never queue.
 *
 * The overlay owns the React state (queue array, in-flight ref, running jobs);
 * these functions hold only the decision logic so it stays unit-testable.
 */

export type InstallLaneKind = "npm" | "script";

/**
 * Should an install for a target be queued (wait) instead of started now?
 *
 * npm targets queue when the lane is busy, a dispatch is mid-flight, or anything
 * is already queued (preserve order). Non-npm (script) targets never queue.
 */
export function shouldQueueInstall(opts: {
  kind: InstallLaneKind;
  /** An npm install is currently running. */
  npmBusy: boolean;
  /** An install POST is dispatched but its job hasn't registered yet. */
  inFlight: boolean;
  /** How many targets are already queued. */
  queuedCount: number;
}): boolean {
  if (opts.kind !== "npm") return false;
  return opts.npmBusy || opts.inFlight || opts.queuedCount > 0;
}

/**
 * Append a target to the queue without duplicates. Returns the SAME array
 * reference when the target is already queued so a React state setter can bail
 * out of a no-op re-render.
 */
export function enqueueInstall<T>(queue: T[], target: T): T[] {
  return queue.includes(target) ? queue : [...queue, target];
}

/**
 * The next target to dispatch from the queue, or null when the queue is empty
 * or the lane isn't free yet (something running or a dispatch in-flight).
 */
export function nextDrainTarget<T>(
  queue: readonly T[],
  opts: { npmBusy: boolean; inFlight: boolean },
): T | null {
  if (queue.length === 0) return null;
  if (opts.npmBusy || opts.inFlight) return null;
  return queue[0];
}

/**
 * A 409 for an npm target means it lost the race for the single npm lane —
 * re-queue and let the drain retry it, rather than surfacing an error.
 */
export function shouldRequeueOn409(kind: InstallLaneKind, httpStatus: number): boolean {
  return httpStatus === 409 && kind === "npm";
}

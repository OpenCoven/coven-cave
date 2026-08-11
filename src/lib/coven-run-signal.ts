/**
 * The active coven run, published for chrome that lives outside the coven.
 *
 * The status bar's run pill (design proposal §11) is rendered by `workspace`,
 * three layers above `GroupChatView` where the run actually lives. Threading a
 * prop down would mean `ChatSurface` carrying a callback it has no interest in,
 * purely as a relay — so the run publishes to this module instead and the
 * status bar subscribes.
 *
 * Module-level state is an honest fit rather than a shortcut here: there is one
 * status bar and one active coven at a time, so a single slot cannot lose
 * information the UI could otherwise show.
 *
 * The publisher owns the clear. `GroupChatView` clears on unmount and on coven
 * switch, so a stale run can never outlive the surface that produced it — the
 * failure mode this must avoid is a pill that keeps claiming a run is live
 * after the reader has navigated away.
 */

import type { CovenRunPill } from "./coven-run.ts";

/** Fired when the pill is clicked, so the open coven can scroll to its run. */
export const COVEN_JUMP_TO_RUN_EVENT = "cave:coven-jump-to-run";

let current: CovenRunPill | null = null;
const listeners = new Set<() => void>();

function sameSlot(a: CovenRunPill | null, b: CovenRunPill | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // Compared field-by-field rather than by identity: the publisher re-derives
  // on every transcript change (which is every streamed token), and waking the
  // status bar for an unchanged pill would repaint the whole workspace footer
  // at token rate.
  return (
    a.label === b.label &&
    a.tone === b.tone &&
    a.icon === b.icon &&
    a.live === b.live &&
    a.startedAtMs === b.startedAtMs &&
    a.elapsedMs === b.elapsedMs
  );
}

export function publishCovenRunPill(next: CovenRunPill | null): void {
  if (sameSlot(current, next)) return;
  current = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeCovenRunPill(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Snapshot for `useSyncExternalStore`. Returns a stable reference between
 * publishes, which that hook requires — returning a fresh object each call
 * would loop it.
 */
export function covenRunPillSnapshot(): CovenRunPill | null {
  return current;
}

/** The server render has no coven mounted, so there is never a pill. */
export function covenRunPillServerSnapshot(): CovenRunPill | null {
  return null;
}

/** Test seam: drop the slot and every subscriber. */
export function resetCovenRunPillForTests(): void {
  current = null;
  listeners.clear();
}

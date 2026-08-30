"use client";

// Residue purge for chat preferences whose feature has been removed.
//
// `cave:chat:thread-instruments` gated the transcript's right-side instrument.
// It was written by the retired "Show/Hide activity map" kebab toggle, and the
// value that survives in a real browser is `"0"` — an opt-OUT. Once the toggle
// and its reader are gone (cave-5m5hv) the run rail is automatic, so that
// stored `"0"` has no reader and cannot hide anything.
//
// It is deleted rather than left inert, and the distinction is not cosmetic.
// Leaving it means a machine keeps carrying a switch for a feature it can no
// longer reach: nothing in the product can clear it, so it survives every
// update, and the next surface that reaches for a chat preference key inherits
// a stale one that means "hidden". Migrating it was the other option and was
// rejected — there is no destination. The rail's remaining gates are data
// (no tool calls yet) and width, neither of which a person chooses, so there
// is no preference for the old value to become.
//
// Removal is also the safe direction under a downgrade: an older build finding
// the key absent reads its own documented default, which was ON.
//
// Idempotent, storage-exception-safe, and a no-op on the server.

const RETIRED_KEYS = [
  // Retired with the thread minimap and the activity-map toggle (cave-5m5hv).
  "cave:chat:thread-instruments",
] as const;

/** Delete every retired chat preference key. Returns the keys actually removed
 *  so a caller (or a test) can see the purge happen rather than assume it. */
export function purgeRetiredChatPreferences(): string[] {
  if (typeof window === "undefined") return [];
  const removed: string[] = [];
  for (const key of RETIRED_KEYS) {
    try {
      if (window.localStorage.getItem(key) === null) continue;
      window.localStorage.removeItem(key);
      removed.push(key);
    } catch {
      /* private mode / quota / disabled storage — nothing to clean up here */
    }
  }
  return removed;
}

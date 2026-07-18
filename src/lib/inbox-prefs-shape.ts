// Pure prefs shape — no node: imports — so client components (the bell's
// settings panel) can reach MUTABLE_KINDS without dragging fs/promises into
// the browser bundle. Same split as inbox-recurrence.ts vs cave-inbox.ts;
// the store logic lives in cave-inbox-prefs.ts, which re-exports these.

export type SoundMode = "default" | "silent" | "named";

/**
 * Kinds whose delivery (toast + native notification + sound) can be quieted.
 * response-needed is deliberately not mutable — a familiar waiting on a reply
 * clears by replying, not by silencing it.
 */
export const MUTABLE_KINDS = ["reminder", "agent", "daily-summary", "milestone"] as const;
export type MutableKind = (typeof MUTABLE_KINDS)[number];

export type InboxPrefs = {
  version: number;
  mutedFamiliars: string[];
  mutedKinds: MutableKind[];
  sound: { mode: SoundMode; name?: string };
};

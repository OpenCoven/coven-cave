// Cooldown model for high-frequency completion flares (cave-q06w).
//
// The PR-merge and board card-done flares (cave-hshy) are naturally rare —
// merging a PR or dragging a card to Done is a deliberate, spaced-out act.
// Session-settle and memory-save are not: parallel familiars can settle
// within seconds of each other, and a busy editing session saves constantly.
// Blooming on every one would turn the summoning-flare vocabulary into
// noise — the opposite of a reward.
//
// Two gates keep the vocabulary meaningful:
//
// 1. SIGNIFICANCE (owned by callers): session-settle only counts when the
//    settled turn ran ≥ SETTLE_MIN_RUN_MS — long runs are the ones where the
//    user context-switched away and the completion is an event; short replies
//    are their own feedback. Memory-save only counts for MANUAL saves —
//    autosave is ambient bookkeeping, not an accomplishment.
// 2. FREQUENCY (owned here): at most one flare per kind per
//    FLARE_COOLDOWN_MS, tracked globally rather than per-session/per-editor
//    so simultaneous settles across parallel panes collapse into a single
//    bloom instead of a strobe.
//
// Only GRANTED flares advance the clock — a denied attempt doesn't extend
// the quiet window, so a steady drizzle of events still yields one flare per
// window instead of zero. State is in-memory per window on purpose: a reload
// resetting the cooldown is harmless because under-flaring is always safe
// (flares are visual-only garnish — announce()/MetaLine carry the actual
// information) while over-flaring is the failure mode this lib exists to
// prevent.

/** Minimum quiet time between flares of the same kind. */
export const FLARE_COOLDOWN_MS = 5 * 60_000;

/** Session-settle significance floor: only runs at least this long flare. */
export const SETTLE_MIN_RUN_MS = 60_000;

const lastFlareAt = new Map<string, number>();

/**
 * Ask permission to flare. Returns true (and records the grant) when the
 * kind's cooldown window has passed; false otherwise. Denials are not
 * recorded, so they never push the next eligible flare further out.
 */
export function shouldFlare(kind: string, now: number = Date.now()): boolean {
  const last = lastFlareAt.get(kind);
  if (last !== undefined && now - last < FLARE_COOLDOWN_MS) return false;
  lastFlareAt.set(kind, now);
  return true;
}

/** Test hook: forget all grants. */
export function resetFlareCooldowns(): void {
  lastFlareAt.clear();
}

"use client";

/**
 * Cross-surface request to open the Summoning Circle (familiar creation).
 *
 * Familiar creation lives in the Circle on the Familiars surface (#2635) —
 * NOT in the onboarding wizard, which stops at infrastructure. Any surface
 * that wants to offer "summon a familiar" routes through here so the wiring
 * can't drift back to the wizard (cave-3em5: the switcher's Summon button
 * dispatched `cave:onboarding-open` long after creation moved out of it).
 *
 * Mount race: when summoning is requested from a different surface, the
 * Workspace flips to `agents` and FamiliarsView mounts fresh — a
 * fire-and-forget event can race its listener subscription. Same shape as
 * `markCovenTabPending` in chat-tab-events.ts: a retained latch set
 * synchronously before the mode flips, consumed on mount; the event covers
 * the already-mounted case. The latch lives on `window` so lazy chunk loading
 * cannot isolate or reset the request.
 */

/** Window event asking a mounted Familiars surface to open the Circle. */
export const SUMMON_FAMILIAR_EVENT = "cave:summon-familiar";

const SUMMON_PENDING_KEY = "__caveSummonPending";

type SummonWindow = Window & {
  [SUMMON_PENDING_KEY]?: boolean;
};

export function markSummonPending(): void {
  if (typeof window === "undefined") return;
  (window as SummonWindow)[SUMMON_PENDING_KEY] = true;
}

export function hasSummonPending(): boolean {
  return typeof window !== "undefined"
    && (window as SummonWindow)[SUMMON_PENDING_KEY] === true;
}

export function consumeSummonPending(): boolean {
  if (typeof window === "undefined") return false;
  const target = window as SummonWindow;
  const pending = target[SUMMON_PENDING_KEY] === true;
  delete target[SUMMON_PENDING_KEY];
  return pending;
}

/** Navigate to the Familiars surface and open the Summoning Circle. */
export function requestSummonFamiliar(): void {
  if (typeof window === "undefined") return;
  markSummonPending();
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "agents" } }));
  window.dispatchEvent(new CustomEvent(SUMMON_FAMILIAR_EVENT));
}

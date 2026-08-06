"use client";

/**
 * Cross-surface request to open familiar creation.
 *
 * What it opens is now the Summoning **Rite** (cave-3rz.3) — the Familiars
 * surface routes this to `FamiliarRiteOverlay`, with the Summoning Circle kept
 * one click away for the vessels the rite cannot bind (SSH, OpenClaw, Hermes
 * profiles). The event contract below is unchanged; only its destination is.
 *
 * Familiar creation lives on the Familiars surface (#2635) —
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
 * the already-mounted case.
 */

/** Window event asking a mounted Familiars surface to open the rite. */
export const SUMMON_FAMILIAR_EVENT = "cave:summon-familiar";

let summonPending = false;

export function markSummonPending(): void {
  summonPending = true;
}

export function consumeSummonPending(): boolean {
  const pending = summonPending;
  summonPending = false;
  return pending;
}

/** Navigate to the Familiars surface and open the summoning rite. */
export function requestSummonFamiliar(): void {
  if (typeof window === "undefined") return;
  markSummonPending();
  window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "agents" } }));
  window.dispatchEvent(new CustomEvent(SUMMON_FAMILIAR_EVENT));
}

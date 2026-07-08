// Onboarding auto-open gate — the single decision for whether the workspace
// should launch the first-run wizard from a /api/onboarding/status payload.
//
// The server's `complete` covers every step EXCEPT Coven Code: that tool only
// exists in the payload's `tools[]`, and the user's "skip Coven Code" choice
// lives client-side (localStorage). The wizard's finish CTA already ANDs the
// two (`effectiveComplete = complete && covenCodeSatisfied`); this gate must
// apply the same rule or the two diverge — a user missing only Coven Code had
// server `complete: true`, so onboarding never auto-opened, yet the wizard
// showed step 1 unfinished when opened manually (cave-219).

/** localStorage key recording an explicit "skip Coven Code" choice. */
export const COVEN_CODE_SKIP_KEY = "cave:onboarding:skip-coven-code";

export type OnboardingStatusPayload = {
  complete?: boolean;
  steps?: Record<string, { ok?: boolean }>;
  tools?: Array<{ id?: string; installed?: boolean; outdated?: boolean }>;
};

/** Mirrors the wizard's rule: an explicit skip, or installed and current. */
export function isCovenCodeSatisfied(
  payload: OnboardingStatusPayload,
  covenCodeSkipped: boolean,
): boolean {
  if (covenCodeSkipped) return true;
  const tool = payload.tools?.find((t) => t.id === "coven-code");
  return !!tool?.installed && !tool.outdated;
}

/**
 * First-run: auto-open onboarding if setup is missing. Keyed on the STRUCTURAL
 * steps (CLI, Coven home, runtime adapters) — not on bare `complete` — because
 * a stopped daemon flips `complete` false (daemon/familiars/binding all report
 * not-ok while it's down), and that would relaunch the full wizard for an
 * already-set-up machine on every visit. Daemon-down on a set-up machine
 * belongs to the offline banner, not the first-run flow. When the daemon IS
 * reachable, any remaining incompleteness (a missing tool or runtime, Coven
 * Code unhandled) is genuine setup work, so the wizard opens. A machine with
 * no familiars is NOT unfinished — the status route reports familiars/binding
 * as advisory since creation moved to the in-app Summoning Circle.
 */
export function shouldAutoOpenOnboarding(
  payload: OnboardingStatusPayload,
  covenCodeSkipped: boolean,
): boolean {
  if (payload.complete && isCovenCodeSatisfied(payload, covenCodeSkipped)) return false;
  const step = (key: string) => payload.steps?.[key]?.ok === true;
  const structuralMissing =
    !step("covenCli") || !step("covenHome") || !step("adapters");
  const daemonUpButUnfinished = step("daemon");
  return structuralMissing || daemonUpButUnfinished;
}

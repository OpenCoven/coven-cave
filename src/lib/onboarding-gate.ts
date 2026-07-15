// Onboarding auto-open gate — the single decision for whether the workspace
// should launch the first-run wizard from a /api/onboarding/status payload.
//
// Server `complete` is the single source of truth for setup. Coven Code is an
// ordinary optional runtime adapter — never a setup requirement. History
// (cave-219): it used to be "required + skippable", with the skip stored
// client-side and ANDed into the wizard's finish state; the gate had to
// mirror that AND or the two diverged. Demoting Coven Code removed the
// client-side AND entirely, so the gate and wizard now agree by construction.

export type OnboardingStatusPayload = {
  complete?: boolean;
  steps?: Record<string, { ok?: boolean }>;
};

/**
 * First-run: auto-open onboarding if setup is missing. Keyed on the STRUCTURAL
 * steps (CLI, Coven home, runtime adapters) — not on bare `complete` — because
 * a stopped daemon flips `complete` false (daemon/familiars/binding all report
 * not-ok while it's down), and that would relaunch the full wizard for an
 * already-set-up machine on every visit. Daemon-down on a set-up machine
 * belongs to the offline banner, not the first-run flow. When the daemon IS
 * reachable, any remaining incompleteness (a missing tool or runtime) is
 * genuine setup work, so the wizard opens. A machine with no familiars is NOT
 * unfinished — the status route reports familiars/binding as advisory since
 * creation moved to the in-app Summoning Circle.
 */
export function shouldAutoOpenOnboarding(payload: OnboardingStatusPayload): boolean {
  if (payload.complete) return false;
  const step = (key: string) => payload.steps?.[key]?.ok === true;
  const structuralMissing =
    !step("covenCli") || !step("covenHome") || !step("adapters");
  const daemonUpButUnfinished = step("daemon");
  return structuralMissing || daemonUpButUnfinished;
}

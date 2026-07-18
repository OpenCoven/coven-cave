import type { CaveProject } from "./cave-projects-types.ts";
import type { PendingFirstProjectAccessSnapshot } from "./first-project-gate-retry.ts";

type FamiliarLike = { id: string };

export type FirstProjectGatePolicyInput = {
  activeFamiliarId: string | null;
  visibleFamiliars: readonly FamiliarLike[];
  registeredProjects: readonly CaveProject[];
  pendingGrant: PendingFirstProjectAccessSnapshot | null;
  onboardingResolved: boolean;
  onboardingOpen: boolean;
  mode: string;
  familiarsLoaded: boolean;
  familiarRosterLoadedSuccessfully: boolean;
  projectsInitiallyResolved: boolean;
};

export type FirstProjectGatePolicy = {
  open: boolean;
  familiarId: string | null;
};

export function preferredFirstProjectGateFamiliarId(
  activeFamiliarId: string | null,
  visibleFamiliars: readonly FamiliarLike[],
): string | null {
  return activeFamiliarId ?? visibleFamiliars[0]?.id ?? null;
}

export function resolveFirstProjectGatePolicy(
  input: FirstProjectGatePolicyInput,
): FirstProjectGatePolicy {
  const familiarId = input.pendingGrant?.familiarId
    ?? preferredFirstProjectGateFamiliarId(input.activeFamiliarId, input.visibleFamiliars);
  const eligible = input.onboardingResolved
    && !input.onboardingOpen
    && (input.mode === "home" || input.mode === "chat")
    && input.familiarsLoaded
    && input.familiarRosterLoadedSuccessfully
    && input.projectsInitiallyResolved
    && familiarId !== null;

  return {
    open: eligible && (input.registeredProjects.length === 0 || input.pendingGrant !== null),
    familiarId,
  };
}

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
  blockChatLaunch: boolean;
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
  const blockChatLaunch = input.onboardingResolved
    && !input.onboardingOpen
    && input.familiarsLoaded
    && input.familiarRosterLoadedSuccessfully
    && input.projectsInitiallyResolved
    && familiarId !== null
    && (input.registeredProjects.length === 0 || input.pendingGrant !== null);

  return {
    open: blockChatLaunch && (input.mode === "home" || input.mode === "chat"),
    familiarId,
    blockChatLaunch,
  };
}

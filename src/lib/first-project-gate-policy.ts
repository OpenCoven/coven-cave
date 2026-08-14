import type { CaveProject } from "./cave-projects-types.ts";
import type { PendingFirstProjectAccessSnapshot } from "./first-project-gate-retry.ts";

type FamiliarLike = { id: string };

export type FirstProjectGatePolicyInput = {
  activeFamiliarId: string | null;
  visibleFamiliars: readonly FamiliarLike[];
  registeredProjects: readonly CaveProject[];
  /** Projects the target familiar can launch chat in, resolved server-side. */
  accessibleProjects?: readonly CaveProject[];
  pendingGrant: PendingFirstProjectAccessSnapshot | null;
  onboardingResolved: boolean;
  onboardingOpen: boolean;
  mode: string;
  familiarsLoaded: boolean;
  familiarRosterLoadedSuccessfully: boolean;
  projectsInitiallyResolved: boolean;
  accessibleProjectsInitiallyResolved?: boolean;
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
    ?? input.activeFamiliarId;
  const accessibleProjects = input.accessibleProjects ?? input.registeredProjects;
  const accessibleProjectsInitiallyResolved = input.accessibleProjectsInitiallyResolved ?? true;
  const blockChatLaunch = input.onboardingResolved
    && !input.onboardingOpen
    && input.familiarsLoaded
    && input.familiarRosterLoadedSuccessfully
    && input.projectsInitiallyResolved
    && accessibleProjectsInitiallyResolved
    && familiarId !== null
    // A project somewhere in the registry is not sufficient: the active
    // familiar still needs an effective grant before a chat can be launched.
    && (accessibleProjects.length === 0 || input.pendingGrant !== null);

  return {
    open: blockChatLaunch && (input.mode === "home" || input.mode === "chat"),
    familiarId,
    blockChatLaunch,
  };
}

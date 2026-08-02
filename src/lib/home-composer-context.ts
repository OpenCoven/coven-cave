import type { CaveProject } from "./cave-projects-types";
import type { Familiar } from "./types";
import { projectForRoot } from "./chat-projects.ts";

/**
 * The home composer uses the operator registry before familiar setup, then
 * switches to the server-authorized familiar view once a familiar exists.
 */
export function projectsForHomeComposerScope(
  projects: readonly CaveProject[],
  familiarId: string | null | undefined,
): CaveProject[] {
  return familiarId
    ? projects.filter((project) => project.access !== undefined)
    : [...projects];
}

/** Chat launch needs both an actual familiar and server-derived project access. */
export function isHomeComposerProjectLaunchReady(args: {
  familiarId: string | null | undefined;
  projectsLoadedSuccessfully: boolean;
  projectsLoading: boolean;
  projectsError: string | null;
  selectedProject: Pick<CaveProject, "access" | "root"> | null;
}): boolean {
  return Boolean(args.familiarId)
    && args.projectsLoadedSuccessfully
    && !args.projectsLoading
    && !args.projectsError
    && args.selectedProject?.access !== undefined
    && Boolean(args.selectedProject?.root);
}

export function resolveHomeComposerFamiliar(
  familiars: readonly Familiar[],
  activeFamiliarId: string | null,
  archivedFamiliars: Readonly<Record<string, unknown>>,
): { visibleFamiliars: Familiar[]; selectedFamiliarId: string; selectedFamiliar: Familiar | null } {
  const visibleFamiliars = familiars.filter((familiar) => !(familiar.id in archivedFamiliars));
  const activeIsArchived = activeFamiliarId != null && activeFamiliarId in archivedFamiliars;
  const selectedFamiliarId = activeFamiliarId && !activeIsArchived
    ? activeFamiliarId
    : visibleFamiliars[0]?.id ?? "";
  return {
    visibleFamiliars,
    selectedFamiliarId,
    selectedFamiliar: familiars.find((familiar) => familiar.id === selectedFamiliarId) ?? null,
  };
}

export function resolveHomeComposerProject(
  projects: readonly CaveProject[],
  selectedProjectId: string,
  noProjectId: string,
  /** Root of the most recent chat's registered project (recentChatProjectRoot):
   *  the default when the user hasn't explicitly picked, before projects[0]. */
  recentProjectRoot?: string | null,
): CaveProject | null {
  if (selectedProjectId === noProjectId) return null;
  if (selectedProjectId) {
    return projects.find((project) => project.id === selectedProjectId) ?? null;
  }
  return (
    projectForRoot(recentProjectRoot, projects.slice()) ??
    projects[0] ??
    null
  );
}

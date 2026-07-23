import type { CaveProject } from "./cave-projects-types";
import type { Familiar } from "./types";
import { projectForRoot } from "./chat-projects.ts";

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
  return (
    projects.find((project) => project.id === selectedProjectId) ??
    projectForRoot(recentProjectRoot, projects.slice()) ??
    projects[0] ??
    null
  );
}

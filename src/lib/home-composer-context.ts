import type { CaveProject } from "./cave-projects-types";
import type { Familiar } from "./types";

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
): CaveProject | null {
  if (selectedProjectId === noProjectId) return null;
  return projects.find((project) => project.id === selectedProjectId) ?? projects[0] ?? null;
}

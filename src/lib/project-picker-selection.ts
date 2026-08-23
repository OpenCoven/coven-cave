/**
 * Pure, dependency-free project picker selection resolver.
 * Imported by both ProjectPickerPopover and ProjectPicker (project-picker.tsx)
 * so trigger and row checks cannot diverge. Also imported directly by
 * project-picker.test.ts for table-driven unit coverage.
 *
 * Semantics:
 * - allProjectsEnabled requires both a non-empty label AND an action.
 * - value===null selects All projects when enabled (suppresses defaultToFirst).
 * - value===noProjectId selects No project only when allowNoProject=true;
 *   otherwise it is an invalid/missing value and trigger shows "Choose project".
 * - A known project id selects that project.
 * - A stale id resolves to null; if allowNoProject=true the No project row is
 *   checked (even when All projects is enabled); otherwise "Choose project".
 * - Without All capability, legacy null behavior: defaultToFirst picks the first
 *   project; false resolves No project when allowed, else "Choose project".
 * - Partial label-only or action-only props behave exactly as legacy (no All row).
 */

export type ProjectPickerSelectionInput<T extends { id: string }> = {
  sorted: T[];
  value: string | null;
  noProjectId: string;
  allowNoProject: boolean;
  defaultToFirst: boolean;
  allProjectsLabel: string | undefined;
  hasAllProjectsAction: boolean;
};

export type ProjectPickerSelectionResult<T extends { id: string }> = {
  /** The project object to display; null when no specific project is selected. */
  selected: T | null;
  allProjectsEnabled: boolean;
  allProjectsSelected: boolean;
  noProjectSelected: boolean;
  /** Trigger label when selected is null. */
  emptyLabel: string;
};

export function resolveProjectPickerSelection<T extends { id: string }>(
  args: ProjectPickerSelectionInput<T>,
): ProjectPickerSelectionResult<T> {
  const {
    sorted, value, noProjectId, allowNoProject, defaultToFirst,
    allProjectsLabel, hasAllProjectsAction,
  } = args;

  // Both props are required — partial props behave as legacy (no All projects).
  const allProjectsEnabled = Boolean(allProjectsLabel && hasAllProjectsAction);
  const allProjectsSelected = allProjectsEnabled && value === null;

  const isExplicitNoProject = value === noProjectId;
  const foundProject = (value !== null && !isExplicitNoProject)
    ? (sorted.find((p) => p.id === value) ?? null)
    : null;
  // Stale: a non-null, non-sentinel value that does not match any known project.
  const isStale = value !== null && !isExplicitNoProject && foundProject === null;

  // Compute the selected project object.
  let selected: T | null;
  if (isExplicitNoProject || isStale) {
    // Explicit sentinel or stale id — no project displayed.
    selected = null;
  } else if (value === null) {
    // null: All projects scope suppresses defaultToFirst; legacy path otherwise.
    selected = allProjectsSelected ? null : (defaultToFirst ? (sorted[0] ?? null) : null);
  } else {
    selected = foundProject;
  }

  // No project row checked state:
  // 1. Explicit sentinel and allowNoProject.
  // 2. Stale id and allowNoProject (regardless of All projects capability).
  // 3. null + no All capability + allowNoProject when nothing is selected.
  const noProjectSelected =
    (isExplicitNoProject && allowNoProject) ||
    (isStale && allowNoProject) ||
    (value === null && !allProjectsEnabled && selected === null && allowNoProject);

  // Empty trigger label: shown when selected is null.
  const emptyLabel = allProjectsSelected
    ? allProjectsLabel!
    : (allowNoProject ? "No project" : "Choose project");

  return { selected, allProjectsEnabled, allProjectsSelected, noProjectSelected, emptyLabel };
}

/** Stable identity for a project result's familiar access scope. */
export function projectScopeKey(familiarId: string | null): string {
  return familiarId ? `familiar:${familiarId}` : "unscoped";
}

/** True only when a successful project response belongs to the current scope. */
export function isCurrentProjectScope(
  loadedScopeKey: string | null,
  familiarId: string | null,
): boolean {
  return loadedScopeKey === projectScopeKey(familiarId);
}

/**
 * Do not hand a consumer a prior scope's projects during the render before its
 * effect can clear local state. This is intentionally independent of picker
 * readiness so every useProjects consumer fails closed by default.
 */
export function projectsForCurrentScope<T>(
  projects: T[],
  loadedScopeKey: string | null,
  familiarId: string | null,
): T[] {
  return isCurrentProjectScope(loadedScopeKey, familiarId) ? projects : [];
}

/**
 * A picker must stay unavailable while a modal is applying a new set of
 * defaults, even if the previous familiar's request had completed.
 */
export function isProjectPickerReady({
  opening,
  loadedSuccessfully,
  loading,
}: {
  opening: boolean;
  loadedSuccessfully: boolean;
  loading: boolean;
}): boolean {
  return !opening && loadedSuccessfully && !loading;
}

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

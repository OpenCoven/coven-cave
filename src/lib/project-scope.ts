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

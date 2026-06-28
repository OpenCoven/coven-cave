/**
 * Pure mapping from a settings scroll-target (a settingsGroupId) to the tab that
 * owns it, so a tabbed settings section can switch tabs when search/deep-link
 * points at a group on an inactive tab. React-free so it can be unit-tested
 * without the settings-group / tabs component modules.
 */
export function tabForScrollTarget<T extends string>(
  groupsByTab: Record<T, readonly string[]>,
  scrollTarget: string | null | undefined,
  idOf: (label: string) => string,
): T | null {
  if (!scrollTarget) return null;
  for (const tab of Object.keys(groupsByTab) as T[]) {
    if (groupsByTab[tab].some((label) => idOf(label) === scrollTarget)) return tab;
  }
  return null;
}

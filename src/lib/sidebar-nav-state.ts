/**
 * sidebar-nav-state — pure derivation of a sidebar nav row's visual state.
 *
 * A row is:
 *   - "active" when its mode is the primary workspace surface (Roles and
 *     Capabilities are sections of the Marketplace hub, so they keep the
 *     Marketplace row lit);
 *   - "split"  when its page is currently open as a secondary split tile
 *     (drag-to-split) but is NOT the primary surface — the workspace clears
 *     redundant splits, but active still wins here defensively;
 *   - "idle"   otherwise.
 *
 * Kept as a pure function (no React) so the highlight rules are unit-testable.
 */

export type SidebarRowState = "active" | "split" | "idle";

/** Modes that light up a row other than their own (hub sections → hub row). */
const MODE_ALIASES: Record<string, string> = {
  roles: "marketplace",
  capabilities: "marketplace",
};

function normalizeMode(mode: string): string {
  return MODE_ALIASES[mode] ?? mode;
}

export function sidebarRowState(
  rowId: string,
  activeMode: string,
  splitPageModes?: readonly string[],
): SidebarRowState {
  if (normalizeMode(activeMode) === rowId) return "active";
  if (splitPageModes?.some((m) => normalizeMode(m) === rowId)) return "split";
  return "idle";
}

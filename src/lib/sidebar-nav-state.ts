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

import { MODE_ALIASES, isAliasWorkspaceMode } from "./workspace-mode.ts";

export type SidebarRowState = "active" | "split" | "idle";

// Alias modes light their canonical surface's row (hub sections → hub row,
// tab aliases → host row): the calendar lives on Rituals, the Queue is a tab
// of the Tasks hub, Journal is a tab inside Memories, Roles/Capabilities are
// Marketplace hub sections, and retired "flow" remaps to Rituals in setMode
// (cave-s9p6). MODE_ALIASES is the workspace-wide alias→canonical table.
function normalizeMode(mode: string): string {
  return isAliasWorkspaceMode(mode) ? MODE_ALIASES[mode] : mode;
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

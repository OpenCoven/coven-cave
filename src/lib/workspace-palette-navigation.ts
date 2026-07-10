import {
  WORKSPACE_PALETTE_PAGE_DEFINITIONS,
  type WorkspacePageDefinition,
  type WorkspacePageId,
} from "./workspace-page-registry.ts";
import type { WorkspaceMode } from "./workspace-mode.ts";

// Temporary until Task 6 mounts FlowView in the Workspace renderer. Keep Flow
// registered, but do not emit a palette route that currently falls through to Home.
export const CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS: readonly WorkspacePageDefinition[] =
  Object.freeze(WORKSPACE_PALETTE_PAGE_DEFINITIONS.filter(({ id }) => id !== "flow"));

const ROUTABLE_WORKSPACE_PALETTE_PAGE_IDS = new Set<WorkspacePageId>(
  CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS.map(({ id }) => id),
);

export function isRoutableWorkspacePaletteMode(
  pageId: WorkspacePageId,
): pageId is WorkspaceMode {
  return ROUTABLE_WORKSPACE_PALETTE_PAGE_IDS.has(pageId);
}

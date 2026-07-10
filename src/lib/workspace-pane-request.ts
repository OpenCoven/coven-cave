import type {
  WorkspacePageId,
  WorkspacePageVariant,
} from "./workspace-page-registry.ts";
import { workspacePageDefinition } from "./workspace-page-registry.ts";

export type WorkspacePaneRequest = {
  instanceId: string;
  pageId: WorkspacePageId;
  requestedPageId: WorkspacePageId;
  variant: WorkspacePageVariant;
};

export function normalizeWorkspacePaneRequest(
  instanceId: string,
  requestedPageId: string,
): WorkspacePaneRequest | null {
  const definition = workspacePageDefinition(requestedPageId);
  if (!definition) return null;
  return {
    instanceId,
    pageId: definition.canonicalId,
    requestedPageId: definition.id,
    variant: definition.variant,
  };
}

export function workspacePaneRequestKey(request: WorkspacePaneRequest): string {
  return `${request.pageId}:${request.variant}`;
}

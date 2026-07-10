import type {
  WorkspacePageId,
  WorkspacePageVariant,
} from "./workspace-page-registry.ts";
import {
  workspacePageDefinition,
  workspacePageKey,
} from "./workspace-page-registry.ts";

export type WorkspacePaneRequest = {
  readonly instanceId: string;
  readonly pageId: WorkspacePageId;
  readonly requestedPageId: WorkspacePageId;
  readonly variant: WorkspacePageVariant;
};

export function normalizeWorkspacePaneRequest(
  instanceId: string,
  requestedPageId: string,
): WorkspacePaneRequest | null {
  const definition = workspacePageDefinition(requestedPageId);
  if (!definition) return null;
  return Object.freeze({
    instanceId,
    pageId: definition.canonicalId,
    requestedPageId: definition.id,
    variant: definition.variant,
  });
}

export function workspacePaneRequestKey(
  request: WorkspacePaneRequest,
): `${WorkspacePageId}:${WorkspacePageVariant}` {
  return workspacePageKey({
    canonicalId: request.pageId,
    variant: request.variant,
  });
}

import {
  workspacePageDefinition,
  workspacePageKey,
  type WorkspacePageId,
  type WorkspacePageVariant,
} from "./workspace-page-registry.ts";

export type WorkspacePaneRequest = {
  readonly instanceId: string;
  readonly pageId: WorkspacePageId;
  readonly requestedPageId: WorkspacePageId;
  readonly variant: WorkspacePageVariant;
  /** The user just opened this pane (a split drop), rather than a link or a
   *  saved layout restoring it. A pane that starts something interactive,
   *  such as a shell, may take focus only then (#5807). */
  readonly openedByUser?: true;
};

/** The same request, marked as one the user just opened (#5807). */
export function openedByUser(request: WorkspacePaneRequest | null): WorkspacePaneRequest | null {
  return request ? Object.freeze({ ...request, openedByUser: true as const }) : null;
}

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

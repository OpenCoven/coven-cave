import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkspacePaneRequest,
  workspacePaneRequestKey,
} from "./workspace-pane-request.ts";
import type { WorkspacePaneRequest } from "./workspace-pane-request.ts";
import type {
  WorkspacePageId,
  WorkspacePageVariant,
} from "./workspace-page-registry.ts";
import {
  BUILT_IN_WORKSPACE_PAGE_IDS,
  workspacePageDefinition,
} from "./workspace-page-registry.ts";

function assertWorkspacePaneRequestIsReadonly(request: WorkspacePaneRequest): void {
  // @ts-expect-error normalized pane request identity is readonly
  request.instanceId = "pane-corrupted";
  // @ts-expect-error normalized pane request identity is readonly
  request.pageId = "board";
  // @ts-expect-error normalized pane request identity is readonly
  request.requestedPageId = "board";
  // @ts-expect-error normalized pane request identity is readonly
  request.variant = "default";
}
void assertWorkspacePaneRequestIsReadonly;

test("normalizes Group to the canonical Chat page while retaining its request", () => {
  assert.deepEqual(normalizeWorkspacePaneRequest("pane-group", "groupchat"), {
    instanceId: "pane-group",
    pageId: "chat",
    requestedPageId: "groupchat",
    variant: "group",
  });
});

test("normalizes direct Chat as the default Chat variant", () => {
  assert.deepEqual(normalizeWorkspacePaneRequest("pane-chat", "chat"), {
    instanceId: "pane-chat",
    pageId: "chat",
    requestedPageId: "chat",
    variant: "default",
  });
});

test("keys requests by canonical page and variant instead of instance", () => {
  const directChat = normalizeWorkspacePaneRequest("pane-chat", "chat");
  const firstGroup = normalizeWorkspacePaneRequest("pane-group-1", "groupchat");
  const secondGroup = normalizeWorkspacePaneRequest("pane-group-2", "groupchat");

  assert.ok(directChat);
  assert.ok(firstGroup);
  assert.ok(secondGroup);
  const directChatKey: `${WorkspacePageId}:${WorkspacePageVariant}` =
    workspacePaneRequestKey(directChat);
  assert.equal(directChatKey, "chat:default");
  assert.equal(workspacePaneRequestKey(firstGroup), "chat:group");
  assert.notEqual(workspacePaneRequestKey(directChat), workspacePaneRequestKey(firstGroup));
  assert.equal(workspacePaneRequestKey(firstGroup), workspacePaneRequestKey(secondGroup));
});

test("normalizes every alias from registry metadata and retains the requested id", () => {
  const aliases = BUILT_IN_WORKSPACE_PAGE_IDS.map((id) => {
    const definition = workspacePageDefinition(id);
    assert.ok(definition);
    return definition;
  }).filter(({ id, canonicalId, variant }) => canonicalId !== id || variant !== "default");

  assert.ok(aliases.length > 0);
  for (const definition of aliases) {
    assert.deepEqual(normalizeWorkspacePaneRequest(`pane-${definition.id}`, definition.id), {
      instanceId: `pane-${definition.id}`,
      pageId: definition.canonicalId,
      requestedPageId: definition.id,
      variant: definition.variant,
    });
  }
});

test("round-trips a dynamic role surface with default variant identity", () => {
  const request = normalizeWorkspacePaneRequest("pane-researcher", "surface:researcher");

  assert.deepEqual(request, {
    instanceId: "pane-researcher",
    pageId: "surface:researcher",
    requestedPageId: "surface:researcher",
    variant: "default",
  });
  assert.ok(request);
  assert.equal(workspacePaneRequestKey(request), "surface:researcher:default");
});

test("rejects unknown and empty role-surface page ids", () => {
  assert.equal(normalizeWorkspacePaneRequest("pane-unknown", "not-a-workspace"), null);
  assert.equal(normalizeWorkspacePaneRequest("pane-empty-surface", "surface:"), null);
});

test("preserves instance ids exactly", () => {
  const instanceId = "  pane:group/alpha 🐈  ";
  const request = normalizeWorkspacePaneRequest(instanceId, "groupchat");

  assert.ok(request);
  assert.equal(request.instanceId, instanceId);
});

test("freezes normalized pane request identity against key corruption", () => {
  const request = normalizeWorkspacePaneRequest("pane-group", "groupchat");
  assert.ok(request);
  const originalKey = workspacePaneRequestKey(request);

  assert.ok(Object.isFrozen(request));
  assert.throws(
    () => Object.assign(request, {
      instanceId: "pane-corrupted",
      pageId: "board",
      requestedPageId: "familiar-work-queue",
      variant: "queue",
    }),
    TypeError,
  );
  assert.deepEqual(request, {
    instanceId: "pane-group",
    pageId: "chat",
    requestedPageId: "groupchat",
    variant: "group",
  });
  assert.equal(workspacePaneRequestKey(request), originalKey);
});

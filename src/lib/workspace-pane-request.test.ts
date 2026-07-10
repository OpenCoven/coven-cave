import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWorkspacePaneRequest,
  workspacePaneRequestKey,
} from "./workspace-pane-request.ts";

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
  assert.equal(workspacePaneRequestKey(directChat), "chat:default");
  assert.equal(workspacePaneRequestKey(firstGroup), "chat:group");
  assert.notEqual(workspacePaneRequestKey(directChat), workspacePaneRequestKey(firstGroup));
  assert.equal(workspacePaneRequestKey(firstGroup), workspacePaneRequestKey(secondGroup));
});

test("normalizes every alias from registry metadata and retains the requested id", () => {
  const aliases = [
    ["groupchat", "chat", "group"],
    ["calendar", "inbox", "calendar"],
    ["roles", "marketplace", "roles"],
    ["capabilities", "marketplace", "capabilities"],
    ["familiar-work-queue", "board", "queue"],
    ["journal", "grimoire", "journal"],
  ] as const;

  for (const [requestedPageId, pageId, variant] of aliases) {
    const request = normalizeWorkspacePaneRequest(`pane-${requestedPageId}`, requestedPageId);
    assert.ok(request);
    assert.equal(request.requestedPageId, requestedPageId);
    assert.equal(request.pageId, pageId);
    assert.equal(request.variant, variant);
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

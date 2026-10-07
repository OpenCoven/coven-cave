import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeWorkspacePaneRequest,
  openedByUser,
  workspacePaneRequestKey,
} from "./workspace-pane-request.ts";

test("normalized requests preserve requested aliases and canonical page identity", () => {
  const group = normalizeWorkspacePaneRequest("pane-group", "groupchat");
  assert.ok(group);
  assert.deepEqual(group, {
    instanceId: "pane-group",
    pageId: "chat",
    requestedPageId: "groupchat",
    variant: "group",
  });
  assert.equal(workspacePaneRequestKey(group), "chat:group");
  assert.ok(Object.isFrozen(group));
});

test("aliases sharing a canonical surface remain distinct split tiles", () => {
  const chat = normalizeWorkspacePaneRequest("pane-chat", "chat");
  const group = normalizeWorkspacePaneRequest("pane-group", "groupchat");
  const code = normalizeWorkspacePaneRequest("pane-code", "code");
  const activity = normalizeWorkspacePaneRequest("pane-activity", "github");
  assert.ok(chat && group && code && activity);
  assert.notEqual(workspacePaneRequestKey(chat), workspacePaneRequestKey(group));
  assert.notEqual(workspacePaneRequestKey(code), workspacePaneRequestKey(activity));
});

test("unknown pages cannot create a pane request", () => {
  assert.equal(normalizeWorkspacePaneRequest("pane-unknown", "not-a-page"), null);
});

test("a request the user just opened is marked so, without changing its identity (#5807)", () => {
  const restored = normalizeWorkspacePaneRequest("pane-term", "terminal");
  assert.ok(restored);
  assert.equal(restored.openedByUser, undefined, "a link or a saved layout is not the user opening it");
  const opened = openedByUser(restored);
  assert.ok(opened);
  assert.equal(opened.openedByUser, true);
  assert.equal(opened.instanceId, restored.instanceId);
  assert.equal(workspacePaneRequestKey(opened), workspacePaneRequestKey(restored), "same split tile");
  assert.ok(Object.isFrozen(opened));
  assert.equal(openedByUser(null), null, "an unknown page stays unknown");
});

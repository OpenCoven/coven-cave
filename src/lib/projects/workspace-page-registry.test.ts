import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_WORKSPACE_PAGE_IDS,
  workspacePageDefinition,
  workspacePageKey,
} from "./workspace-page-registry.ts";
import {
  CANONICAL_WORKSPACE_MODES,
  MODE_ALIASES,
  isAliasWorkspaceMode,
  resolveWorkspaceModeAlias,
  type WorkspaceMode,
} from "./workspace-mode.ts";

test("the registry exhaustively resolves every workspace mode", () => {
  const modes: readonly WorkspaceMode[] = [
    ...CANONICAL_WORKSPACE_MODES,
    ...(Object.keys(MODE_ALIASES) as (keyof typeof MODE_ALIASES)[]),
  ];
  for (const mode of modes) {
    const definition = workspacePageDefinition(mode);
    assert.ok(definition, `${mode} needs a registry definition`);

    if (isAliasWorkspaceMode(mode)) {
      assert.equal(definition.canonicalId, resolveWorkspaceModeAlias(mode));
    } else {
      assert.equal(definition.canonicalId, mode);
    }
  }
});

test("the registry includes standalone split pages and preserves alias variants", () => {
  for (const page of ["settings", "dashboard", "memory", "terminal"]) {
    assert.ok(workspacePageDefinition(page), `${page} needs a registry definition`);
  }

  const chat = workspacePageDefinition("chat");
  const group = workspacePageDefinition("groupchat");
  const code = workspacePageDefinition("code");
  const activity = workspacePageDefinition("github");
  assert.ok(chat && group && code && activity);
  assert.notEqual(workspacePageKey(chat), workspacePageKey(group));
  assert.notEqual(workspacePageKey(code), workspacePageKey(activity));
});

test("dynamic role rooms resolve without turning unknown pages into Home", () => {
  const dynamic = workspacePageDefinition("surface:research-desk");
  assert.ok(dynamic);
  assert.equal(dynamic.canonicalId, "surface:research-desk");
  assert.equal(dynamic.title, "Research Desk");
  assert.equal(workspacePageDefinition("not-a-page"), null);
});

test("the ordered built-in registry is immutable", () => {
  assert.ok(BUILT_IN_WORKSPACE_PAGE_IDS.includes("settings"));
  assert.ok(BUILT_IN_WORKSPACE_PAGE_IDS.includes("terminal"));
  assert.ok(Object.isFrozen(BUILT_IN_WORKSPACE_PAGE_IDS));
});

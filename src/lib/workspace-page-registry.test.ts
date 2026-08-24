import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILT_IN_WORKSPACE_PAGE_IDS,
  WORKSPACE_CANONICAL_PAGE_DEFINITIONS,
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
  assert.equal(dynamic.palette, "hidden");
  assert.equal(dynamic.statusContext, "contextual");
  assert.equal(workspacePageDefinition("not-a-page"), null);
});

test("the ordered built-in registry is immutable", () => {
  assert.ok(BUILT_IN_WORKSPACE_PAGE_IDS.includes("settings"));
  assert.ok(BUILT_IN_WORKSPACE_PAGE_IDS.includes("terminal"));
  assert.ok(Object.isFrozen(BUILT_IN_WORKSPACE_PAGE_IDS));
});

test("literal definitions classify palette and status context explicitly", () => {
  for (const id of BUILT_IN_WORKSPACE_PAGE_IDS) {
    const definition = workspacePageDefinition(id);
    assert.ok(definition, `${id} needs a registry definition`);
    assert.ok(["primary", "secondary", "hidden"].includes(definition.palette));
    assert.ok(["persistent", "contextual", "hidden"].includes(definition.statusContext));
  }

  assert.equal(workspacePageDefinition("home")?.palette, "primary");
  assert.equal(workspacePageDefinition("chat")?.palette, "primary");
  assert.equal(workspacePageDefinition("groupchat")?.palette, "hidden");
  assert.equal(workspacePageDefinition("calendar")?.palette, "hidden");
  assert.equal(workspacePageDefinition("marketplace")?.palette, "secondary");
  assert.equal(workspacePageDefinition("browser")?.palette, "secondary");
  assert.equal(workspacePageDefinition("home")?.statusContext, "persistent");
  assert.equal(workspacePageDefinition("inbox")?.statusContext, "persistent");
  assert.equal(workspacePageDefinition("settings")?.statusContext, "contextual");
  assert.equal(workspacePageDefinition("memory")?.statusContext, "hidden");
  assert.equal(workspacePageDefinition("terminal")?.statusContext, "hidden");
});

test("canonical built-in definitions stay unique and alias-free", () => {
  const canonicalIds = WORKSPACE_CANONICAL_PAGE_DEFINITIONS.map(({ id, canonicalId }) => {
    assert.equal(id, canonicalId);
    return id;
  });
  const canonicalIdSet = new Set<string>(canonicalIds);

  assert.equal(new Set(canonicalIds).size, canonicalIds.length);
  for (const alias of Object.keys(MODE_ALIASES) as (keyof typeof MODE_ALIASES)[]) {
    const definition = workspacePageDefinition(alias);
    assert.ok(definition);
    assert.equal(canonicalIdSet.has(definition.id), false, `${alias} should not appear as a canonical destination`);
  }
});

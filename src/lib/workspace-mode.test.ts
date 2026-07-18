import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANONICAL_WORKSPACE_MODES,
  MODE_ALIASES,
  isAliasWorkspaceMode,
  isWorkspaceMode,
  resolveWorkspaceModeAlias,
} from "./workspace-mode.ts";

// The alias table is the single source of truth for where every compatibility
// mode lands (issue #3283, cave-m4ih.3). These tests pin its invariants;
// workspace-alias-modes.test.ts pins the Workspace wiring to it.

test("every alias resolves to a canonical mode, never to another alias", () => {
  for (const [alias, target] of Object.entries(MODE_ALIASES)) {
    assert.ok(
      (CANONICAL_WORKSPACE_MODES as readonly string[]).includes(target),
      `alias "${alias}" must land on a canonical surface, got "${target}"`,
    );
    assert.ok(!isAliasWorkspaceMode(target), `alias "${alias}" must not chain to another alias`);
  }
});

test("canonical and alias vocabularies are disjoint", () => {
  for (const mode of CANONICAL_WORKSPACE_MODES) {
    assert.ok(!isAliasWorkspaceMode(mode), `canonical mode "${mode}" must not also be an alias`);
  }
});

test("isWorkspaceMode accepts the full vocabulary and nothing else", () => {
  for (const mode of CANONICAL_WORKSPACE_MODES) {
    assert.ok(isWorkspaceMode(mode), `canonical "${mode}" is a workspace mode`);
  }
  for (const alias of Object.keys(MODE_ALIASES)) {
    assert.ok(isWorkspaceMode(alias), `alias "${alias}" stays a valid workspace mode`);
  }
  // Retired or foreign mode strings must be rejected (the persisted
  // last-surface restore and ?mode= deep links validate through this guard).
  for (const retired of ["projects", "code", "terminal", "evals", "retro", "workflows", "", "surface:threads", "__proto__", "constructor"]) {
    assert.ok(!isWorkspaceMode(retired), `"${retired}" must not validate as a workspace mode`);
  }
});

test("resolveWorkspaceModeAlias maps aliases through the table and canonical modes to themselves", () => {
  for (const mode of CANONICAL_WORKSPACE_MODES) {
    assert.equal(resolveWorkspaceModeAlias(mode), mode);
  }
  for (const [alias, target] of Object.entries(MODE_ALIASES)) {
    assert.equal(resolveWorkspaceModeAlias(alias as keyof typeof MODE_ALIASES), target);
  }
});

test("the documented alias landings hold", () => {
  assert.equal(MODE_ALIASES.groupchat, "chat", "Group Chat is a tab inside Chat");
  assert.equal(MODE_ALIASES.journal, "grimoire", "Journal is a tab inside Memories");
  assert.equal(MODE_ALIASES.flow, "inbox", "retired Flow lands on Rituals");
  assert.equal(MODE_ALIASES.calendar, "inbox", "Calendar is a Rituals tab");
  assert.equal(MODE_ALIASES["familiar-work-queue"], "board", "the Queue is a Tasks tab");
  assert.equal(MODE_ALIASES.roles, "marketplace", "Roles is a Marketplace hub section");
  assert.equal(MODE_ALIASES.capabilities, "marketplace", "Capabilities is a Marketplace hub section");
});

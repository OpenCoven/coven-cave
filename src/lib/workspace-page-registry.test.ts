import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceMode } from "./workspace-mode.ts";
import {
  BUILT_IN_WORKSPACE_PAGE_IDS,
  WORKSPACE_COMPANION_PAGE_DEFINITIONS,
  WORKSPACE_DAILY_PAGE_DEFINITIONS,
  WORKSPACE_FOOTER_PAGE_DEFINITIONS,
  WORKSPACE_NAVIGATION_PAGE_DEFINITIONS,
  WORKSPACE_PALETTE_PAGE_DEFINITIONS,
  isWorkspacePageId,
  workspacePageDefinition,
  workspacePageKey,
} from "./workspace-page-registry.ts";

const EXPECTED_BUILT_IN_IDS = [
  "agents",
  "home",
  "chat",
  "groupchat",
  "board",
  "calendar",
  "inbox",
  "browser",
  "github",
  "roles",
  "marketplace",
  "flow",
  "submissions",
  "capabilities",
  "familiar-work-queue",
  "journal",
  "grimoire",
  "settings",
  "dashboard",
  "salem",
  "memory",
  "terminal",
] as const;

const WORKSPACE_MODES: readonly WorkspaceMode[] = [
  "agents",
  "home",
  "chat",
  "groupchat",
  "board",
  "calendar",
  "inbox",
  "browser",
  "github",
  "roles",
  "marketplace",
  "flow",
  "submissions",
  "capabilities",
  "familiar-work-queue",
  "journal",
  "grimoire",
];

test("built-in workspace page ids are exhaustive, ordered, and unique", () => {
  assert.deepEqual(BUILT_IN_WORKSPACE_PAGE_IDS, EXPECTED_BUILT_IN_IDS);
  assert.equal(new Set(BUILT_IN_WORKSPACE_PAGE_IDS).size, BUILT_IN_WORKSPACE_PAGE_IDS.length);
});

test("consumer page lists are derived from registry navigation metadata", () => {
  assert.deepEqual(WORKSPACE_DAILY_PAGE_DEFINITIONS.map(({ id }) => id), [
    "home",
    "chat",
    "board",
    "inbox",
  ]);
  assert.deepEqual(WORKSPACE_NAVIGATION_PAGE_DEFINITIONS.map(({ id }) => id), [
    "home",
    "chat",
    "board",
    "inbox",
    "github",
    "marketplace",
    "journal",
    "grimoire",
  ]);
  assert.deepEqual(
    WORKSPACE_PALETTE_PAGE_DEFINITIONS.map(({ id }) => id),
    EXPECTED_BUILT_IN_IDS.slice(0, 17),
  );
  assert.deepEqual(WORKSPACE_FOOTER_PAGE_DEFINITIONS.map(({ id }) => id), [
    "settings",
    "dashboard",
  ]);
  assert.deepEqual(WORKSPACE_COMPANION_PAGE_DEFINITIONS.map(({ id }) => id), [
    "salem",
    "memory",
    "terminal",
  ]);
});

test("workspace aliases resolve to their canonical page variants", () => {
  assert.deepEqual(workspacePageDefinition("groupchat"), {
    id: "groupchat",
    title: "Group",
    canonicalId: "chat",
    variant: "group",
    nav: "hidden",
    split: "contextual",
    landmark: "Chat / Group",
  });
  assert.deepEqual(workspacePageDefinition("familiar-work-queue"), {
    id: "familiar-work-queue",
    title: "Queue",
    canonicalId: "board",
    variant: "queue",
    nav: "hidden",
    split: "contextual",
    landmark: "Tasks / Queue",
  });
  assert.deepEqual(workspacePageDefinition("calendar"), {
    id: "calendar",
    title: "Calendar",
    canonicalId: "inbox",
    variant: "calendar",
    nav: "hidden",
    split: "always",
    landmark: "Schedules / Calendar",
  });
  assert.deepEqual(workspacePageDefinition("roles"), {
    id: "roles",
    title: "Roles",
    canonicalId: "marketplace",
    variant: "roles",
    nav: "hidden",
    split: "always",
    landmark: "Marketplace / Roles",
  });
  assert.deepEqual(workspacePageDefinition("capabilities"), {
    id: "capabilities",
    title: "Capabilities",
    canonicalId: "marketplace",
    variant: "capabilities",
    nav: "hidden",
    split: "always",
    landmark: "Marketplace / Capabilities",
  });
  assert.deepEqual(workspacePageDefinition("journal"), {
    id: "journal",
    title: "Journal",
    canonicalId: "grimoire",
    variant: "journal",
    nav: "quiet",
    split: "contextual",
    landmark: "Grimoire / Journal",
  });
});

test("flow remains its own canonical page", () => {
  const flow = workspacePageDefinition("flow");
  assert.ok(flow);
  assert.equal(flow.canonicalId, "flow");
  assert.equal(flow.variant, "default");
  assert.equal(workspacePageKey(flow), "flow:default");
});

test("footer and companion pages carry their registry metadata", () => {
  for (const id of ["settings", "dashboard"] as const) {
    const definition = workspacePageDefinition(id);
    assert.ok(definition);
    assert.equal(definition.nav, "footer");
    assert.equal(definition.split, "always");
  }

  for (const id of ["salem", "memory", "terminal"] as const) {
    const definition = workspacePageDefinition(id);
    assert.ok(definition);
    assert.equal(definition.nav, "companion");
    assert.equal(definition.split, "contextual");
  }
});

test("every WorkspaceMode resolves and unknown ids return null", () => {
  for (const mode of WORKSPACE_MODES) {
    assert.ok(workspacePageDefinition(mode), `${mode} should resolve`);
    assert.ok(isWorkspacePageId(mode), `${mode} should be a workspace page id`);
  }

  assert.equal(workspacePageDefinition("not-a-workspace"), null);
  assert.ok(!isWorkspacePageId("not-a-workspace"));
});

test("dynamic role surfaces resolve without requiring prior registration", () => {
  const definition = workspacePageDefinition("surface:researcher");
  assert.deepEqual(definition, {
    id: "surface:researcher",
    title: "Researcher",
    canonicalId: "surface:researcher",
    variant: "default",
    nav: "dynamic",
    split: "contextual",
    landmark: "Researcher",
  });
  assert.ok(isWorkspacePageId("surface:researcher"));
  assert.ok(definition);
  assert.equal(workspacePageKey(definition), "surface:researcher:default");
});

test("an empty role-surface suffix is rejected", () => {
  assert.equal(workspacePageDefinition("surface:"), null);
  assert.ok(!isWorkspacePageId("surface:"));
});

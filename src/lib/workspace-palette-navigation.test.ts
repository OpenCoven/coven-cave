import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORKSPACE_PALETTE_PAGE_DEFINITIONS,
  type WorkspacePageId,
} from "./workspace-page-registry.ts";
import type { WorkspaceMode } from "./workspace-mode.ts";
import {
  CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS,
  isRoutableWorkspacePaletteMode,
} from "./workspace-palette-navigation.ts";

const EXPECTED_CURRENT_PAGE_IDS: readonly WorkspaceMode[] = [
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
  "submissions",
  "capabilities",
  "familiar-work-queue",
  "journal",
  "grimoire",
];

test("current palette definitions preserve registry order while Flow awaits its renderer", () => {
  assert.deepEqual(
    CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS.map(({ id }) => id),
    EXPECTED_CURRENT_PAGE_IDS,
  );
  assert.deepEqual(
    CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS,
    WORKSPACE_PALETTE_PAGE_DEFINITIONS.filter(({ id }) => id !== "flow"),
  );
  for (const definition of CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS) {
    assert.equal(
      definition,
      WORKSPACE_PALETTE_PAGE_DEFINITIONS.find(({ id }) => id === definition.id),
      `${definition.id} should reuse its registry definition`,
    );
  }
  assert.ok(Object.isFrozen(CURRENT_WORKSPACE_PALETTE_PAGE_DEFINITIONS));
});

test("the routing guard narrows only currently emitted palette modes", () => {
  const emittedPageIds: WorkspacePageId[] = ["home", "groupchat", "journal"];
  for (const pageId of emittedPageIds) {
    assert.equal(isRoutableWorkspacePaletteMode(pageId), true, `${pageId} should route`);
    if (isRoutableWorkspacePaletteMode(pageId)) {
      const narrowedMode: WorkspaceMode = pageId;
      assert.equal(narrowedMode, pageId);
    }
  }

  const unsupportedPageIds: WorkspacePageId[] = [
    "flow",
    "settings",
    "dashboard",
    "terminal",
    "salem",
    "memory",
    "surface:researcher",
  ];
  for (const pageId of unsupportedPageIds) {
    assert.equal(isRoutableWorkspacePaletteMode(pageId), false, `${pageId} should not route`);
  }
});

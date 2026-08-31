// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The project-grouped thread rail (chat-project-sidebar.tsx) is retired
// (cave-fh9so, cave-4er6q); the docked rail lives in workspace-sidebar.tsx
// and is covered by its own specs. This file keeps only the migration-era
// regression assertions on the surviving live files.

const chatSurface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const railController = readFileSync(new URL("../lib/use-workspace-rail-controller.ts", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
// The inspector right panel is retired: Git/Changes lands on the code rail's
// Changes tab, Inspect lands on the promoted Familiar chat tab, and Debug is
// owned by ChatView's modal (chat-view.tsx listens for cave:debug-open).
assert.match(
  railController,
  /const openChanges = useCallback\(\(\) => \{[\s\S]*?rail\.setActiveTab\("changes"\)/,
  "The shared rail controller maps changes-open to the code rail's Changes tab",
);
assert.match(
  railController,
  /addEventListener\("cave:changes-open", openChanges\)/,
  "The shared rail controller listens for cave:changes-open",
);
assert.match(
  chatSurface,
  /const onInspectorOpen = \(\) => selectScope\("familiar"\)/,
  "ChatSurface maps inspector-open to the Familiar chat tab",
);
const chatView = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
assert.match(
  chatView,
  /addEventListener\("cave:debug-open", onDebugOpen\)/,
  "ChatView owns the cave:debug-open bridge (debug modal)",
);
assert.match(
  chatRouter,
  /if \(sessionsLoaded === false\) return;\s*sidebarPrefsLoadedRef\.current = true;/,
  "ChatRouter hydrates raw sidebar preferences after the first session attempt without waiting for projects",
);
// The project-grouped rail is retired (cave-fh9so); the disclosure-key
// hydration/migration/persistence that only served it must not survive as
// dead state the retired rail's storage keeps feeding.
assert.doesNotMatch(
  chatRouter,
  /expandedKeys|PROJECT_SIDEBAR_EXPANSION_VERSION|migrateOrganizationExpansionKeys|useAutoExpandNewGroups|organizationExpansionKey/,
  "ChatRouter no longer hydrates, migrates, or persists the retired rail's disclosure keys",
);
assert.match(
  chatRouter,
  /function selectionForProjectRoot\([\s\S]*normalizeChatProjectRoot\(projectRoot\)[\s\S]*entry\.runtimeHost === normalizedHost[\s\S]*selectionKey\(group\.projectId, group\.projectRoot, group\.runtimeHost\)/,
  "ChatRouter maps the active host and project root to the matching rail folder selection",
);
assert.match(
  chatRouter,
  /const syncSidebarProjectRoot = useCallback\([\s\S]*setSelection\(selectionForProjectRoot\(/,
  "ChatRouter still follows the active project root as the list's selection",
);
assert.match(
  chatRouter,
  /onProjectRootChange=\{syncSidebarProjectRoot\}/,
  "ChatView must report project-root changes back to the rail owner",
);
assert.match(
  chatRouter,
  /<ChatList[\s\S]*selection=\{selection\}[\s\S]*onSelectionChange=\{setSelection\}/,
  "ChatRouter passes its project selection into ChatList",
);
assert.match(
  chatList,
  /selection: ProjectSelection;[\s\S]*onSelectionChange: \(selection: ProjectSelection\) => void;/,
  "ChatList requires Router-owned project selection props",
);
assert.doesNotMatch(
  chatList,
  /expandedKeys|onToggleExpanded|hideRail/,
  "ChatList carries no disclosure or rail-hiding props for the retired project rail",
);
// The project-grouped rail is retired; ChatList still receives the router's
// selection state for its own grouping (cave-fh9so).
assert.match(
  chatSurface,
  /<SidebarChatsSection[\s\S]*activeSessionId=\{railActiveSessionId\}/,
  "the docked rail tracks the open session",
)
assert.doesNotMatch(
  chatList,
  /PROJECT_SIDEBAR_KEYS|migrateOrganizationExpansionKeys|useAutoExpandNewGroups/,
  "ChatList must not hydrate, migrate, auto-expand, or persist Router-owned project disclosure state",
);
// The open conversation row announces itself to assistive tech (was visual-only:
// a background tint + accent bar with no aria-current).
assert.match(
  chatList,
  /aria-current=\{!selectMode && isActive \? "true" : undefined\}/,
  "the active conversation row is aria-current (not just visually highlighted)",
);

console.log("chat-thread-rail.test.ts: ok");

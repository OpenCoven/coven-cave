// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(
  new URL("../lib/workspace-mode.ts", import.meta.url),
  "utf8",
);

assert.match(
  workspaceMode,
  /\|\s*"agents"/,
  "WorkspaceMode union keeps \"agents\" for internal familiar detail flows",
);

assert.match(
  workspace,
  /useState<WorkspaceMode>\("home"\)/,
  "Default workspace mode should land on Home after removing Familiars from Work nav",
);

assert.match(
  workspace,
  /import \{ FamiliarsView \} from "@\/components\/familiars-view"/,
  "workspace.tsx imports FamiliarsView",
);

assert.match(
  workspace,
  /mode === "agents" \? \(\s*<FamiliarsView/,
  "workspace.tsx renders FamiliarsView when mode === \"agents\"",
);

assert.match(
  workspace,
  /<FamiliarsView[\s\S]*activeFamiliar=\{active\}/,
  "Workspace passes the selected familiar into the Familiars page",
);

assert.match(
  workspace,
  /railTab === "browser" \|\| railTab === "salem" \|\| \(mode !== "browser" && mode !== "agents"\)/,
  "Companion rail is hidden on Familiars and Browser unless a floating rail tab is selected",
);

assert.match(
  workspace,
  /hideChatTab=\{mode === "chat"\}/,
  "Workspace should hide the companion rail Chat tab while the main surface is already Chats",
);

assert.match(
  workspace,
  /if \(!activeId\) \{\s*queueMicrotask\(\(\) => shellRef\.current\?\.closeFamiliar\(\)\);\s*return;\s*\}/,
  "Workspace collapses the companion panel when no familiar is selected so empty rails do not crowd every surface",
);

assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "calendar", "inbox", "library", "browser", "terminal",/,
  "SURFACE_ORDER should omit the Familiars surface from Work shortcuts",
);

// After the top-bar streamline: no breadcrumb, no Home button, no brand
// mark. The sidebar carries section + familiar identity instead.
assert.doesNotMatch(
  workspace,
  /surfaceLabel|subContext|SURFACE_LABELS|onOpenHome/,
  "Workspace no longer computes breadcrumb labels for the top bar",
);

assert.doesNotMatch(
  topBar,
  /top-bar__home-btn|top-bar__brand|top-bar__crumb/,
  "TopBar drops the brand/home/breadcrumb chrome — sidebar carries identity and nav",
);

assert.doesNotMatch(
  sidebar,
  /\{ id: "agents", label: "Familiars"/,
  "Sidebar should not expose a Familiars subpage in Work",
);

assert.doesNotMatch(
  sidebar,
  /<FamiliarDock/,
  "Sidebar no longer renders the familiar dock (scope moved to the top-bar switcher)",
);

assert.match(
  topBar,
  /<FamiliarSwitcher/,
  "The top bar renders the familiar profile switcher",
);

assert.match(
  workspace,
  /onSelectFamiliar=\{selectFamiliarScope\}/,
  "Workspace wires the top-bar familiar switcher into nullable familiar scope state",
);

assert.doesNotMatch(
  workspace,
  /FamiliarAvatarRail|familiarRail=\{|sidebar-trigger-rail/,
  "Workspace no longer mounts the far-left familiar mini panel",
);

assert.match(
  sidebar,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1", description:/,
  "Sidebar Home keeps its shortcut hint",
);

assert.match(
  sidebar,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7", description:/,
  "Sidebar Browser shifts to ⌘7 after removing Familiars from Work",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8", description:/,
  "Sidebar Terminal takes the final ⌘8 shortcut",
);

console.log("workspace-familiars-landing: all assertions passed");

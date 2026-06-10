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
  /import \{ AgentsView \} from "@\/components\/agents-view"/,
  "workspace.tsx imports AgentsView",
);

assert.match(
  workspace,
  /mode === "agents" \? \(\s*<AgentsView/,
  "workspace.tsx renders AgentsView when mode === \"agents\"",
);

assert.match(
  workspace,
  /<AgentsView[\s\S]*activeFamiliar=\{active\}/,
  "Workspace passes the selected familiar into the Familiars page",
);

assert.match(
  workspace,
  /const showCompanionRail = railTab === "salem" \|\| \(mode !== "browser" && mode !== "agents"\)/,
  "Companion rail is hidden on Familiars and Browser unless Salem is selected",
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

assert.match(
  sidebar,
  /function FamiliarScopeSelect/,
  "Sidebar top slot renders the familiar scope selector in place of search",
);

assert.match(
  workspace,
  /onFamiliarScopeChange=\{selectFamiliarScope\}/,
  "Workspace wires the sidebar familiar scope selector into nullable familiar scope state",
);

assert.doesNotMatch(
  workspace,
  /FamiliarAvatarRail|familiarRail=\{|sidebar-trigger-rail/,
  "Workspace no longer mounts the far-left familiar mini panel",
);

assert.match(
  sidebar,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1" \}/,
  "Sidebar Home keeps its shortcut hint",
);

assert.match(
  sidebar,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7" \}/,
  "Sidebar Browser shifts to ⌘7 after removing Familiars from Work",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8" \}/,
  "Sidebar Terminal takes the final ⌘8 shortcut",
);

console.log("workspace-agents-landing: all assertions passed");

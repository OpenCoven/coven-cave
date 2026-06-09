// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspaceMode = readFileSync(
  new URL("../lib/workspace-mode.ts", import.meta.url),
  "utf8",
);

assert.match(
  workspaceMode,
  /\|\s*"agents"/,
  "WorkspaceMode union must include \"agents\"",
);

assert.match(
  workspace,
  /useState<WorkspaceMode>\("agents"\)/,
  "Default workspace mode must be \"agents\" (replaces home as landing tab)",
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
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "agents", "chat", "board", "calendar", "inbox", "library", "browser",/,
  "SURFACE_ORDER keeps Home before the Familiars surface",
);

assert.match(
  workspace,
  /agents: "Familiars"/,
  "SURFACE_LABELS labels the page Familiars",
);

assert.match(
  sidebar,
  /\{ id: "agents", label: "Familiars", iconName: "ph:users-three", group: "work", kbd: "⌘2" \}/,
  "Sidebar FOLDER_MODES labels the page Familiars",
);

assert.match(
  sidebar,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1" \}/,
  "Sidebar Home keeps its shortcut hint",
);

assert.match(
  sidebar,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘8" \}/,
  "Sidebar Browser shifted to ⌘8",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools" \}/,
  "Sidebar Terminal kept but without shortcut hint",
);

console.log("workspace-agents-landing: all assertions passed");

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

// The "Coven" surface (docs-pane) was purged — its docs/feedback/social live as
// default Browser tabs now. Guard that the surface stays gone.
assert.doesNotMatch(
  workspace,
  /CovenPane|docs-pane/,
  "Workspace should no longer reference the removed Coven (docs-pane) surface",
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

// The right companion rail was removed in favour of drag-to-split, so the
// workspace no longer computes rail visibility (showCompanionRail), a rail Chat
// tab, or a per-familiar rail-open restore effect.

assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser", "terminal",/,
  "SURFACE_ORDER ascends with the merged sidebar top-to-bottom order (⌘1..⌘6)",
);

// ⌘[ / ⌘] cycle to the previous / next surface through SURFACE_ORDER (wraps).
assert.match(
  workspace,
  /e\.key === "\[" \|\| e\.key === "\]"[\s\S]{0,450}?SURFACE_ORDER\[next\]/,
  "⌘[ / ⌘] step through SURFACE_ORDER and setMode to the neighbouring surface",
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
  /<FamiliarQuickSwitch/,
  "The top bar renders the familiar quick-switch strip (recent/pinned avatars + switcher)",
);

assert.match(
  workspace,
  /onSelectFamiliar=\{selectFamiliarScope\}/,
  "Workspace wires the top-bar familiar switcher into nullable familiar scope state",
);

assert.match(
  workspace,
  /const \[scopeIds, setScopeIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/,
  "Workspace should SSR-render the familiar scope as an empty set so server/client first render match",
);
assert.match(
  workspace,
  /const activeId = scopeIds\.size === 1 \? \[\.\.\.scopeIds\]\[0\]! : null/,
  "activeId is the derived single-primary (lone scoped id, else null)",
);
assert.doesNotMatch(
  workspace,
  /useState<Set<string>>\(\(\) => new Set\(getFamiliarScope\(\)\)\)/,
  "Workspace must not read localStorage in the scope useState initializer",
);
assert.match(
  workspace,
  /setScopeIds\(new Set\(getFamiliarScope\(\)\)\);[\s\S]*setActiveFamiliarHydrated\(true\);/,
  "Workspace should restore the persisted familiar scope after mount",
);
assert.match(
  workspace,
  /if \(!activeFamiliarHydrated\) return;[\s\S]*setFamiliarScope\(\[\.\.\.scopeIds\]\)/,
  "Workspace should not write scope storage until after the mount restore runs",
);
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void refreshDaemonStatus\(\), 5000, \{\s*pauseWhileInputActive: true,?\s*\}\)/,
  "Workspace pauses the daemon-status poll while a mobile text input is active",
);
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void loadSessions\(\), 4000, \{\s*pauseWhileInputActive: true,?\s*\}\)/,
  "Workspace pauses the heavy sessions poll while a mobile text input is active",
);
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void refreshEscalations\(\), 30_000, \{\s*pauseWhileInputActive: true,?\s*\}\)/,
  "Workspace pauses the escalation poll while a mobile text input is active",
);
assert.match(
  workspace,
  /usePausablePoll\(\(\) => void refreshOpenTaskCards\(\), 60_000, \{\s*pauseWhileInputActive: true,?\s*\}\)/,
  "Workspace pauses the task-card poll while a mobile text input is active",
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
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘5", description:/,
  "Sidebar Browser is the first Tools shortcut, on ⌘5",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘6", description:/,
  "Sidebar Terminal follows Browser on ⌘6",
);

console.log("workspace-familiars-landing: all assertions passed");

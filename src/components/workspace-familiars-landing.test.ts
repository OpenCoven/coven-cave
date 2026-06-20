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
  "Workspace should hide the companion rail Chat tab while the main surface is already Familiars",
);

assert.match(
  workspace,
  /if \(!activeId\) \{\s*queueMicrotask\(\(\) => shellRef\.current\?\.closeFamiliar\(\)\);\s*return;\s*\}/,
  "Workspace collapses the companion panel when no familiar is selected so empty rails do not crowd every surface",
);

assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "calendar", "inbox", "browser", "terminal", "code",/,
  "SURFACE_ORDER ascends with the sidebar top-to-bottom order (⌘1..⌘8)",
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
  /const \[activeId, setActiveId\] = useState<string \| null>\(null\)/,
  "Workspace should SSR-render active familiar as null so server/client first render match",
);
assert.doesNotMatch(
  workspace,
  /useState<string \| null>\(\(\) => getActiveFamiliar\(\)\)/,
  "Workspace must not read localStorage in the active familiar useState initializer",
);
assert.match(
  workspace,
  /setActiveId\(getActiveFamiliar\(\)\);[\s\S]*setActiveFamiliarHydrated\(true\);/,
  "Workspace should restore the persisted active familiar after mount",
);
assert.match(
  workspace,
  /if \(!activeFamiliarHydrated\) return;[\s\S]*setActiveFamiliar\(activeId\)/,
  "Workspace should not write active familiar storage until after the mount restore runs",
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
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘6", description:/,
  "Sidebar Browser is the first Tools shortcut, on ⌘6",
);

assert.match(
  sidebar,
  /\{ id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘7", description:/,
  "Sidebar Terminal follows Browser on ⌘7",
);

console.log("workspace-familiars-landing: all assertions passed");

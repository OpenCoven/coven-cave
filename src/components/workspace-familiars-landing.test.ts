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

// Home-first boot: the app opens on the Home overview; Chat is one step away
// and the chat Back control still returns to Home by default.
assert.match(
  workspace,
  /const \[mode, setModeRaw\] = useState<CaveMode>\("home"\)/,
  "Default workspace mode lands on Home (home-first boot)",
);
assert.match(
  workspace,
  /const \[lastNonChatMode, setLastNonChatMode\] = useState<CaveMode>\("home"\)/,
  "the chat Back control still returns to Home by default",
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
  /import \{[\s\S]*FamiliarsView[\s\S]*\} from "@\/components\/lazy-surfaces"/,
  "workspace.tsx imports FamiliarsView through the lazy surface boundary",
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

// Chat is the default boot surface and stays eager. Every mode/open-gated
// workspace host crosses the shared next/dynamic boundary instead.
assert.match(
  workspace,
  /import \{ ChatSurface \} from "@\/components\/chat-surface"/,
  "ChatSurface stays eager for the Chat-first boot path",
);
assert.match(
  workspace,
  /import \{ HomeComposer \} from "@\/components\/home-composer"/,
  "HomeComposer stays eager for the adjacent critical path",
);
for (const component of [
  "CommandPalette",
  "FamiliarsView",
  "GrimoireView",
  "InboxEscalationsView",
  "MobileHandoffModal",
  "NewReminderModal",
  "OnboardingOverlay",
  "OpenCovenSubmissionPage",
  "RailInspector",
  "SalemChatPanel",
  "ShortcutsSheet",
]) {
  assert.match(
    workspace,
    new RegExp(`import \\{[\\s\\S]*${component}[\\s\\S]*\\} from "@/components/lazy-surfaces"`),
    `${component} is imported through the lazy surface boundary`,
  );
}
for (const gate of [
  /\{paletteOpen && \(\s*<CommandPalette/,
  /\{shortcutsOpen && <ShortcutsSheet/,
  /\{reminderModalOpen && \(\s*<NewReminderModal/,
  /\{mobileHandoffOpen && \(\s*<MobileHandoffModal/,
]) {
  assert.match(workspace, gate, "lazy modal chunks load only after their open intent");
}
assert.match(
  workspace,
  /\{\(onboardingOpen \|\| onboardingMounted\) && \(\s*<OnboardingOverlay[\s\S]*open=\{onboardingOpen\}/,
  "onboarding loads on first open but remains mounted so job polling and one-shot refs survive close/reopen",
);

// The right companion rail was removed in favour of drag-to-split, so the
// workspace no longer computes rail visibility (showCompanionRail), a rail Chat
// tab, or a per-familiar rail-open restore effect.

assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser",\s*\]/,
  "SURFACE_ORDER ascends with the merged sidebar top-to-bottom order (⌘1..⌘5)",
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
  /const requestedActiveId = scopeIds\.size === 1 \? \[\.\.\.scopeIds\]\[0\]! : null/,
  "Workspace derives the requested single-primary familiar id from the scope set",
);
assert.match(
  workspace,
  /import \{[\s\S]*resolveLoadedActiveFamiliarId,[\s\S]*resolveWorkspaceActiveFamiliarId,[\s\S]*\} from "@\/lib\/active-familiar";[\s\S]*const loadedActiveId = resolveLoadedActiveFamiliarId\(requestedActiveId, visibleFamiliars\);[\s\S]*const activeId = resolveWorkspaceActiveFamiliarId\(\s*requestedActiveId,\s*visibleFamiliars,\s*familiarsLoaded,\s*familiarRosterLoadedSuccessfully,\s*\);/,
  "workspace keeps the requested familiar through roster hydration and only consumes the loaded fallback once the roster has successfully loaded",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*if \(\s*!activeFamiliarHydrated\s*\|\|\s*!familiarsLoaded\s*\|\|\s*!familiarRosterLoadedSuccessfully\s*\|\|\s*requestedActiveId === null\s*\|\|\s*requestedActiveId === loadedActiveId\s*\) return;\s*setScopeIds\(loadedActiveId \? new Set\(\[loadedActiveId\]\) : new Set\(\)\);\s*\}, \[activeFamiliarHydrated, familiarsLoaded, familiarRosterLoadedSuccessfully, requestedActiveId, loadedActiveId\]\);/,
  "Workspace only heals and persists a stale single-familiar selection after the async roster has loaded successfully",
);
assert.match(
  workspace,
  /const active = visibleFamiliars\.find\(\(f\) => f\.id === activeId\) \?\? null;/,
  "Workspace detail surfaces read the active familiar from the loaded non-archived roster only",
);
assert.match(
  workspace,
  /const calendarFamiliarId = activeId \?\? visibleFamiliars\[0\]\?\.id \?\? null;/,
  "calendar fallback prefers the first loaded non-archived familiar",
);
assert.match(
  workspace,
  /const \{[\s\S]*open: firstProjectGateOpen,[\s\S]*familiarId: projectGateFamiliarId,[\s\S]*blockChatLaunch: chatProjectBlocked,[\s\S]*\} = resolveFirstProjectGatePolicy\(\{[\s\S]*visibleFamiliars,[\s\S]*familiarRosterLoadedSuccessfully,[\s\S]*\}\);/,
  "the first-project gate target, visibility, and chat-block state are derived together from the loaded non-archived roster through the shared policy helper",
);
assert.match(
  workspace,
  /const chatProjectBlockedRef = useRef\(chatProjectBlocked\);[\s\S]*chatProjectBlockedRef\.current = chatProjectBlocked;/,
  "Workspace mirrors the mode-independent chat-blocked condition into a ref for central new-chat guards",
);
assert.match(
  workspace,
  /if \(chatProjectBlockedRef\.current\) \{[\s\S]*if \(familiarId\) setActiveId\(familiarId\);[\s\S]*setMode\("home"\);[\s\S]*return;[\s\S]*\}/,
  "startFamiliarChat bounces blocked launches to Home so the first-project gate becomes visible without queuing a chat",
);
assert.doesNotMatch(
  workspace,
  /const activeId = scopeIds\.size === 1 \? \[\.\.\.scopeIds\]\[0\]! : null/,
  "Workspace should not use an unchecked persisted familiar id directly once the loaded roster is known",
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
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", kbd: "⌘1", description:/,
  "Sidebar Home keeps its shortcut hint",
);

assert.match(
  sidebar,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", navHidden: true \}/,
  "Browser is kept for ⌘5/palette but navHidden from the sidebar rows",
);

assert.doesNotMatch(sidebar, /id:\s*"terminal"/, "Sidebar does not expose Terminal as a standalone destination");

console.log("workspace-familiars-landing: all assertions passed");

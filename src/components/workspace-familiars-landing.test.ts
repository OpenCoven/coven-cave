// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
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

// Home-first boot: the app opens on the Home overview; Chat is one step away.
assert.match(
  workspace,
  /const \[mode, setModeRaw\] = useState<CaveMode>\("home"\)/,
  "Default workspace mode lands on Home (home-first boot)",
);
assert.doesNotMatch(workspace, /lastNonChatMode/, "Workspace should not track an unused chat-return surface");

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
  "AskSalemView",
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
  "onboarding loads on first open but remains mounted so local refs survive close/reopen while the server owns job progress",
);
assert.match(
  workspace,
  /const openOnboarding = useCallback\(\(\) => \{\s*setOnboardingOpen\(true\);/s,
  "shared openOnboarding opens onboarding manually after normal startup",
);
assert.match(
  workspace,
  /const openCreate = \(\) => \{\s*setOnboardingOpen\(true\);/s,
  "the cave:onboarding-open bridge opens onboarding manually",
);
assert.doesNotMatch(workspace, /fetch\("\/api\/onboarding\/bootstrap"/, "Workspace does not repeat the server startup bootstrap request");
assert.match(
  workspace,
  /onDismiss=\{\(\) => \{\s*setOnboardingMounted\(true\);[\s\S]*closeOnboarding\(\);/s,
  "manual overlay dismissal retains its lazy host before closing onboarding",
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
  navigation,
  /\{ id: "agents", label: "Familiars"/,
  "The navigation registry should not expose a Familiars subpage",
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
  "workspace keeps the requested familiar through roster hydration and clears it only after a successful roster proves it stale",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*if \(\s*!activeFamiliarHydrated\s*\|\|\s*!familiarsLoaded\s*\|\|\s*!familiarRosterLoadedSuccessfully\s*\|\|\s*requestedActiveId === null\s*\|\|\s*requestedActiveId === loadedActiveId\s*\) return;\s*setScopeIds\(loadedActiveId \? new Set\(\[loadedActiveId\]\) : new Set\(\)\);\s*\}, \[activeFamiliarHydrated, familiarsLoaded, familiarRosterLoadedSuccessfully, requestedActiveId, loadedActiveId\]\);/,
  "Workspace only clears and persists a stale single-familiar selection after the async roster has loaded successfully",
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
  /actorHasProjectAccess === false[\s\S]*actorHasProjectAccess === undefined && chatProjectBlockedRef\.current[\s\S]*if \(familiarId\) setActiveId\(familiarId\);[\s\S]*setMode\("home"\);[\s\S]*return false;/,
  "startFamiliarChat bounces blocked launches to Home so the first-project gate becomes visible without queuing a chat",
);
assert.match(
  workspace,
  /const addSplitTarget = useCallback\(\(target: WorkspacePaneRequest, side: "left" \| "right" = "right"\) => \{[\s\S]*if \(chatProjectBlockedRef\.current && splitTargetRendersMode\(target, "chat"\)\) \{[\s\S]*setMode\("home"\);[\s\S]*return;[\s\S]*\}[\s\S]*setSplitSide\(side\);/,
  "Workspace blocks chat-rendering split targets under the first-project gate and reroutes the primary pane to Home",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*if \(!chatProjectBlocked\) return;[\s\S]*setSplitTargets\(\(prev\) => \{[\s\S]*prev\.filter\(\(target\) => !splitTargetRendersMode\(target, "chat"\)\)[\s\S]*return next\.length === prev\.length \? prev : next;[\s\S]*\}\);\s*\}, \[chatProjectBlocked\]\);/,
  "Workspace drops any already-open chat split tiles once the shared gate condition turns on",
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
  /if \(storage === null\) \{[\s\S]*?blockWorkspaceContextPersistence\(["']Couldn't restore saved workspace context\. Using your familiar scope\.[\s\S]*?\}/,
  "mount restore treats a missing browser storage adapter as a failed restore and falls back to the legacy familiar scope",
);
assert.match(
  workspace,
  /catch \(err\) \{[\s\S]*?blockWorkspaceContextPersistence\([\s\S]*?readWorkspaceContext failed on mount:[\s\S]*?err[\s\S]*?\)/,
  "mount restore shares the thrown read failure path with the null-adapter path",
);
assert.match(
  workspace,
  /setActiveFamiliarHydrated\(true\)[\s\S]{0,50}setWorkspaceContextHydrated\(true\)/,
  "mount restore always completes hydration flags even when readWorkspaceContext fails",
);
assert.match(
  workspace,
  /if \(!workspaceContextPersistenceBlocked\) \{[\s\S]*?if \(storage === null\) \{[\s\S]*?blockWorkspaceContextPersistence\(["']Couldn't save workspace context\.[\s\S]*?\}/,
  "persist blocks versioned writes and announces save failure when the browser storage adapter is missing",
);
assert.match(
  workspace,
  /if \(!workspaceContextPersistenceBlocked\) \{[\s\S]*?try \{[\s\S]*?writeWorkspaceContext\(storage, \{[\s\S]*?projectId: selectedWorkspaceProjectId,[\s\S]*?familiarIds: \[\.\.\.scopeIds\],[\s\S]*?\}\)[\s\S]*?\} catch \(err\) \{[\s\S]*?blockWorkspaceContextPersistence\([\s\S]*?writeWorkspaceContext failed during persist:[\s\S]*?err[\s\S]*?\)/,
  "persist still catches thrown writes and routes them through the shared blocked/announce helper",
);
assert.match(
  workspace,
  /setFamiliarScope\(\[\.\.\.scopeIds\]\)/,
  "persist continues setFamiliarScope even when versioned persistence is blocked (legacy mirror not suppressed)",
);
assert.match(
  workspace,
  /useProjectFamiliars\(\{ projectId: selectedWorkspaceProject\?\.id \?\? null \}\)/,
  "workspace starts useProjectFamiliars from the verified project ID only — stale/unverified persisted IDs do not trigger a fetch",
);
assert.match(
  workspace,
  /reconcileCrewForProject\([\s\S]*scopeIds[\s\S]*projectCrewRecords\.map\(\(familiar\) => familiar\.id\)/,
  "workspace removes ineligible selected familiars only after verified eligibility",
);
assert.match(
  workspace,
  /resolveActingFamiliar\(workspaceFamiliarScope, eligibleFamiliarIds\)/,
  "workspace derives one actor without a first-member fallback",
);
assert.match(
  workspace,
  /let crewReadFailed = storage === null;/,
  "selectWorkspaceProject treats a missing browser storage adapter as a read failure",
);
assert.match(
  workspace,
  /if \(storage === null\) \{[\s\S]*?setWorkspaceContextPersistenceBlocked\(true\)[\s\S]*?\} else \{[\s\S]*?readWorkspaceCrew\(storage, projectId\)/,
  "selectWorkspaceProject blocks versioned persistence and falls back to the aggregate crew when browser storage is missing",
);
assert.match(
  workspace,
  /announce\(crewReadFailed\s*\?[\s\S]*?Couldn't restore project context[\s\S]*?: changeMessage\)/,
  "selectWorkspaceProject emits one combined message instead of a separate restore failure announcement",
);
assert.match(
  workspace,
  /setScopeIds\(new Set\(storedCrew \?\? \[\]\)\)/,
  "selectWorkspaceProject falls back to the aggregate crew when readWorkspaceCrew fails",
);
assert.doesNotMatch(
  workspace,
  /if \(!id\) return;[\s\S]*getLastSurface\(id\)/,
  "main context selection no longer restores an unrelated familiar surface",
);
assert.match(
  workspace,
  /This view is not filtered by project yet/,
  "non-pilot surfaces do not imply filtering that Stage 1 has not implemented",
);
// Both rail components receive the full project/crew/notice context so
// workspaceContextReady becomes true in SidebarRailHeader.
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]{0,3000}projectId=\{selectedWorkspaceProjectId\}/,
  "SidebarMinimal receives selectedWorkspaceProjectId",
);
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]{0,3000}project=\{selectedWorkspaceProject\}/,
  "SidebarMinimal receives selectedWorkspaceProject",
);
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]{0,3000}projects=\{registeredProjects\}/,
  "SidebarMinimal receives registeredProjects",
);
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]{0,3000}projectCrew=\{resolvedProjectCrew\}/,
  "SidebarMinimal receives resolvedProjectCrew",
);
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]{0,3000}projectId=\{selectedWorkspaceProjectId\}/,
  "WorkspaceSidebar receives selectedWorkspaceProjectId",
);
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]{0,3000}project=\{selectedWorkspaceProject\}/,
  "WorkspaceSidebar receives selectedWorkspaceProject",
);
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]{0,3000}projects=\{registeredProjects\}/,
  "WorkspaceSidebar receives registeredProjects",
);
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]{0,3000}projectCrew=\{resolvedProjectCrew\}/,
  "WorkspaceSidebar receives resolvedProjectCrew",
);
const workspaceSidebarMount = workspace.match(/<WorkspaceSidebar[\s\S]*?\/>/)?.[0] ?? "";
assert.match(
  workspaceSidebarMount,
  /projectCrew=\{resolvedProjectCrew\}[\s\S]{0,200}selectedFamiliarIds=\{scopeIds\}/,
  "WorkspaceSidebar receives the full shell familiar set rather than a collapsed first member",
);
// ── effectiveProjectCrewLoading: both rails get the fail-closed value ────────
// When a project ID is selected but the registry is still loading, has not
// loaded successfully, has errored, or has gone stale (selected project null),
// the raw projectCrewLoading from the hook is null/false (hook disabled), so an
// unguarded pass-through would show the selector as idle. effectiveProjectCrewLoading
// forces it to true (disabled) until registry and crew are both verified.
assert.match(
  workspace,
  /const effectiveProjectCrewLoading/,
  "workspace derives effectiveProjectCrewLoading for fail-closed rail behavior",
);
assert.match(
  workspace,
  /selectedWorkspaceProjectId !== null && \([\s\S]*projectsLoading[\s\S]*\|\| !projectsLoadedSuccessfully[\s\S]*\|\| projectsError !== null[\s\S]*\|\| selectedWorkspaceProject === null[\s\S]*\)/,
  "effectiveProjectCrewLoading forces true when a selected project's registry is loading, unverified, errored, or stale",
);
assert.match(
  workspace,
  /\?\s*true\s*:\s*projectCrewLoading;/,
  "effectiveProjectCrewLoading falls back to raw projectCrewLoading after the selected project is verified",
);
assert.match(
  workspace,
  /<SidebarMinimal[\s\S]{0,3000}projectCrewLoading=\{effectiveProjectCrewLoading\}/,
  "SidebarMinimal receives effectiveProjectCrewLoading, not raw projectCrewLoading",
);
assert.match(
  workspace,
  /<WorkspaceSidebar[\s\S]{0,3000}projectCrewLoading=\{effectiveProjectCrewLoading\}/,
  "WorkspaceSidebar receives effectiveProjectCrewLoading, not raw projectCrewLoading",
);
assert.doesNotMatch(
  workspace,
  /projectCrewLoading=\{projectCrewLoading\}/,
  "neither rail receives the raw projectCrewLoading directly — both use the effective value",
);
// ── eligibleFamiliarIds: fail-closed derivation ───────────────────────────────
// No selected ID + verified roster → all familiars eligible; selected + verified
// registry + crew → project crew; any retained-but-unverified source → [].
assert.match(
  workspace,
  /const eligibleWorkspaceFamiliars = selectedWorkspaceProjectId === null[\s\S]{0,100}familiarRosterLoadedSuccessfully[\s\S]{0,100}resolvedFamiliars[\s\S]{0,40}: \[\]/,
  "global eligibility requires a currently successful familiar roster",
);
assert.match(
  workspace,
  /projectsLoadedSuccessfully[\s\S]{0,500}selectedWorkspaceProject !== null[\s\S]{0,240}projectCrewLoadedSuccessfully[\s\S]{0,240}projectCrewError === null[\s\S]{0,160}\? resolvedProjectCrew\.filter[\s\S]{0,100}: \[\]/,
  "project eligibility is [] unless roster, registry, and crew are currently verified",
);
assert.match(
  workspace,
  /const eligibleFamiliarIds = eligibleWorkspaceFamiliars\.map\(\(familiar\) => familiar\.id\)/,
  "actor resolution and the chooser share one verified eligible list",
);
// ── stale project reset: restores All-projects crew before clearing ───────────
// Without this, setScopeIds would remain at the stale project's crew and then
// writeWorkspaceContext (which fires on scopeIds/selectedWorkspaceProjectId change)
// would persist that crew under the null key, corrupting All-projects state.
assert.match(
  workspace,
  /let crewReadFailed = storage === null;/,
  "stale project reset treats a missing browser storage adapter as a read failure",
);
assert.match(
  workspace,
  /if \(storage === null\) \{[\s\S]*?setWorkspaceContextPersistenceBlocked\(true\)[\s\S]*?\} else \{[\s\S]*?readWorkspaceCrew\(storage, null\)/,
  "stale project reset blocks versioned persistence and falls back to the aggregate crew when browser storage is missing",
);
assert.match(
  workspace,
  /announce\(crewReadFailed\s*\?[\s\S]*?Couldn't restore project context[\s\S]*?: "Selected project is no longer available\. Showing all projects\."\)/,
  "stale project reset emits one combined message instead of a separate restore failure announcement",
);
assert.match(
  workspace,
  /setScopeIds\(new Set\(allProjectsCrew \?\? \[\]\)\)[\s\S]{0,100}setSelectedWorkspaceProjectId\(null\)/,
  "stale project reset falls back to the aggregate crew and clears the project ID even when storage is missing",
);
// ── required props: both sidebar components prove full wiring via tsc ─────────
// Both only mount inside Workspace, which provides every context value, so tsc
// can verify complete wiring. asserting the absence of `?` in the prop block
// is the source-of-truth check that the contract has been locked down.
const sidebarMinimalSrc = readFileSync(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const workspaceSidebarSrc = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

for (const [label, src] of [
  ["SidebarMinimalProps", sidebarMinimalSrc],
  ["WorkspaceSidebar Props", workspaceSidebarSrc],
]) {
  // Scope checks to the Task 6 props block to avoid false matches in other types.
  const task6Block =
    src.match(/\/\/ ── Project \/ workspace context \(Task 6\)([\s\S]*?)(?=\n\}|\n  \/\/ ─)/)?.[0] ?? src;
  for (const required of [
    "projects:",
    "projectId:",
    "project:",
    "projectLoading:",
    "projectError:",
    "reloadProjects:",
    "onProjectChange:",
    "projectCrew:",
    "projectCrewLoading:",
    "projectCrewError:",
    "reloadProjectCrew:",
    "contextNotice:",
  ]) {
    const name = required.replace(":", "");
    // The prop must appear as a required (non-optional) field: no `?:` suffix.
    assert.match(
      task6Block,
      new RegExp(`  ${name}(?!\\?):`, ""),
      `${label}.${required} is required in the Task 6 block (no ? modifier)`,
    );
    assert.doesNotMatch(
      task6Block,
      new RegExp(`  ${name}\\?:`),
      `${label}.${required} must not be optional in the Task 6 block`,
    );
  }
  // createProjectOrThrow stays optional — creation can be legitimately absent.
  assert.match(
    task6Block,
    /createProjectOrThrow\?:/,
    `${label}.createProjectOrThrow remains optional (creation not always available)`,
  );
}
const workspaceSidebarTask6Block =
  workspaceSidebarSrc.match(/\/\/ ── Project \/ workspace context \(Task 6\)([\s\S]*?)(?=\n\}|\n  \/\/ ─)/)?.[0] ?? workspaceSidebarSrc;
assert.match(
  workspaceSidebarSrc,
  /selectedFamiliarIds: ReadonlySet<string>;/,
  "WorkspaceSidebar.selectedFamiliarIds is required in the Task 6 block (no ? modifier)",
);
// b7ecf460e ("decouple heartbeat from daemon diagnostics") retired the 5s
// usePausablePoll for daemon status: the connection supervisor owns its own
// cadence and backoff now, so the workspace only delegates to it. That commit
// updated daemon-start-button and settings-overview but missed this file, and
// the stale assertion sat red until the frontend gate ran again.
assert.match(
  workspace,
  /createDaemonConnectionSupervisor\(\{/,
  "Workspace delegates daemon status to the connection supervisor",
);
assert.match(
  workspace,
  /await daemonConnectionSupervisorRef\.current\?\.refresh\(\{\s*fresh: opts\?\.fresh === true \|\| opts\?\.trusted === true,?\s*\}\)/,
  "refreshDaemonStatus is a thin delegate to the supervisor, not its own fetch",
);
assert.doesNotMatch(
  workspace,
  /usePausablePoll\(\(\) => void refreshDaemonStatus\(\)/,
  "the retired 5s daemon-status poll must not come back — that is the decoupling",
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
assert.match(
  workspace,
  /readSurfaceResource<[\s\S]*?>\("board:cards"\)/,
  "Workspace shares the board landing resource for task badges and deadlines",
);
const openTaskRefresh = workspace.match(
  /const refreshOpenTaskCards = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[\]\);/,
)?.[0];
assert.ok(openTaskRefresh, "Workspace keeps a bounded task-card refresh callback");
assert.doesNotMatch(
  openTaskRefresh,
  /fetch\("\/api\/board"/,
  "Workspace must not bypass board request coalescing with an independent raw fetch",
);

assert.doesNotMatch(
  workspace,
  /FamiliarAvatarRail|familiarRail=\{|sidebar-trigger-rail/,
  "Workspace no longer mounts the far-left familiar mini panel",
);

assert.match(
  navigation,
  /\{ id: "home", label: "Home", iconName: "ph:house-bold", kbd: "⌘1", description:/,
  "Home keeps its canonical shortcut hint",
);

assert.match(
  navigation,
  /\{ id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", group: "work", navHidden: true \}/,
  "Browser is kept for ⌘5/palette but navHidden from rendered navigation rows",
);

assert.doesNotMatch(navigation, /id:\s*"terminal"/, "Navigation does not expose Terminal as a standalone destination");

// ── Task 6: storage corruption guard ─────────────────────────────────────────
// workspaceContextPersistenceBlocked: boolean state, initially false.
assert.match(
  workspace,
  /const \[workspaceContextPersistenceBlocked, setWorkspaceContextPersistenceBlocked\] = useState\(false\)/,
  "workspaceContextPersistenceBlocked state is declared as boolean, initially false",
);
// Persist effect blocks writes on a missing adapter, not just on thrown writes.
assert.match(
  workspace,
  /if \(!workspaceContextPersistenceBlocked\) \{[\s\S]*?if \(storage === null\) \{[\s\S]*?blockWorkspaceContextPersistence\(["']Couldn't save workspace context\./,
  "persist effect announces and blocks versioned writes when browser storage is missing",
);
// workspaceContextPersistenceBlocked is in the persist effect's dependency array.
assert.match(
  workspace,
  /blockWorkspaceContextPersistence,\s*selectedWorkspaceProjectId,\s*scopeIds,\s*workspaceContextHydrated,\s*workspaceContextPersistenceBlocked/,
  "persist effect dependency array includes the blocked flag and shared helper",
);
// setFamiliarScope (legacy mirror) runs unconditionally outside the gate.
assert.match(
  workspace,
  /setFamiliarScope\(\[\.\.\.scopeIds\]\);/,
  "setFamiliarScope (legacy mirror) still runs even when versioned persistence is blocked",
);
// Mount restore failure shares the null-adapter and thrown-read paths.
assert.match(
  workspace,
  /if \(storage === null\) \{[\s\S]*?blockWorkspaceContextPersistence\(["']Couldn't restore saved workspace context\. Using your familiar scope\./,
  "mount restore treats a missing adapter as a failed restore",
);
assert.match(
  workspace,
  /catch \(err\) \{[\s\S]*?blockWorkspaceContextPersistence\([\s\S]*?readWorkspaceContext failed on mount:[\s\S]*?err[\s\S]*?\)/,
  "mount restore routes thrown reads through the shared failure helper",
);
// writeWorkspaceContext failure still blocks and announces via the shared helper.
assert.match(
  workspace,
  /catch \(err\) \{[\s\S]*?blockWorkspaceContextPersistence\([\s\S]*?writeWorkspaceContext failed during persist:[\s\S]*?err[\s\S]*?\)/,
  "writeWorkspaceContext failure sets workspaceContextPersistenceBlocked",
);
// selectWorkspaceProject readWorkspaceCrew failure treats null storage as a read failure.
assert.match(
  workspace,
  /let crewReadFailed = storage === null;/,
  "selectWorkspaceProject marks a missing adapter as a crew read failure",
);
assert.match(
  workspace,
  /if \(storage === null\) \{[\s\S]*?setWorkspaceContextPersistenceBlocked\(true\)[\s\S]*?\} else \{[\s\S]*?readWorkspaceCrew\(storage, projectId\)/,
  "selectWorkspaceProject blocks persistence and falls back to the aggregate crew when storage is missing",
);
// Stale reset readWorkspaceCrew failure treats null storage as a read failure.
assert.match(
  workspace,
  /let crewReadFailed = storage === null;/,
  "stale reset marks a missing adapter as a crew read failure",
);
assert.match(
  workspace,
  /if \(storage === null\) \{[\s\S]*?setWorkspaceContextPersistenceBlocked\(true\)[\s\S]*?\} else \{[\s\S]*?readWorkspaceCrew\(storage, null\)/,
  "stale reset blocks persistence and falls back to the aggregate crew when storage is missing",
);
// No double-announce: both callbacks now emit one combined message after branching.
assert.match(
  workspace,
  /announce\(crewReadFailed\s*\?[\s\S]*?Couldn't restore project context[\s\S]*?: changeMessage\)/,
  "selectWorkspaceProject emits a single combined project-context message",
);
assert.match(
  workspace,
  /announce\(crewReadFailed\s*\?[\s\S]*?Couldn't restore project context[\s\S]*?: "Selected project is no longer available\. Showing all projects\."\)/,
  "stale reset emits a single combined project-context message",
);

console.log("workspace-familiars-landing: all assertions passed");

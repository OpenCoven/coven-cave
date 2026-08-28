// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const sidebarMinimal = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const shellNavigation = await readFile(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

// workspace-sidebar.tsx feature assertions
assert.match(workspaceSidebar, /deriveChatProjectGroups\(applyProjectOverrides/, "should group by project with overrides");
assert.match(
  shellNavigation,
  /\.cnav__error-text\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/,
  "the sidebar keeps the actionable project-registration error readable instead of ellipsizing it",
);
assert.match(workspaceSidebar, /deriveChatRecencyBuckets\(/, "should derive time buckets for Recent view");
assert.doesNotMatch(workspaceSidebar, /<Tabs<ChatSidebarView>|label:\s*"Projects"/, "the redundant Projects grouping tab is removed");
// The Organize menu went with the search row (cave-fh9so). It was the rail's
// DUPLICATE of a control ChatList still owns, so archived chats stay reachable
// from the Sessions list view — see chat-list.tsx's own showArchived state.
assert.doesNotMatch(
  workspaceSidebar,
  /<PopoverLabel>Chat visibility<\/PopoverLabel>/,
  "the embedded list carries no duplicate visibility menu",
)
// Search went with the old search row (cave-fh9so). The recency grouping it
// used to bypass is now the only view, and it still filters directly rather
// than through a second store.
assert.match(
  workspaceSidebar,
  /filterVisibleChatSessions\(/,
  "the recency list keeps direct chat filtering",
)
assert.doesNotMatch(workspaceSidebar, /function bareTime\(/, "sidebar should remove the dead bareTime compatibility helper");
assert.match(workspaceSidebar, /const minuteTick = useMinuteTick\(\);/, "sidebar should subscribe to the shared minute tick");
assert.match(
  workspaceSidebar,
  /const now = useMemo\(\(\) => Date\.now\(\), \[minuteTick\]\);/,
  "now should be one memoized clock snapshot derived from minuteTick, not a bare per-render Date.now()",
);
assert.match(workspaceSidebar, /const recentBuckets = useMemo\([\s\S]*?\[recentSessions, now\],/, "recent buckets should re-derive from the same memoized now used for row times and attention descriptions");
assert.match(workspaceSidebar, /bareTimeAt\(session\.updated_at \|\| session\.created_at, now\)/, 'row times should render through bareTimeAt on the current render clock');
assert.ok((workspaceSidebar.match(/<ThreadRow/g) ?? []).length >= 2, "attention and recency rows should render ThreadRow");
assert.match(workspaceSidebar, /const sessionProjectById = useMemo\(\(\) => \{[\s\S]*?for \(const group of groups\)/, "recent-row project lookup derives from override-aware groups");
assert.match(workspaceSidebar, /indent="flat"\s*\n\s*project=\{sessionProjectById\.get\(session\.id\) \?\? null\}/, "recent rows pass project identity");
assert.match(workspaceSidebar, /cnav__thread-proj[\s\S]*?<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\} size="sm"/, "renders ProjectAvatar tile in flat rows with the explicit project color");
assert.match(workspaceSidebar, /<span className="sr-only">\{`Project \$\{project\.name\} `\}<\/span>/, "project name is announced for AT even when the visual tile collapses");
assert.doesNotMatch(workspaceSidebar, /cnav__footer|cnav__user-plan/, "should not render user plan footer");
assert.doesNotMatch(workspaceSidebar, /cnav__group-name|cnav__group-meta|renderProjectGroup/, "the redundant project grouping branch is removed");
// Quick actions are New chat alone: the Scheduled/Plugins icon chips and the
// band that carried them are retired (both destinations live in the Home rail's
// list), so the only navigation shortcut left is the standalone-host Home
// button. The header hosts the familiar switcher.
assert.doesNotMatch(workspaceSidebar, /cnav__mini-row|cnav__mini|cnav__utilities/, "the utilities band and its icon chips are retired");
assert.doesNotMatch(workspaceSidebar, /scheduledCount/, "the Scheduled chip's badge prop goes with it");
// The Home escape hatch and its one-destination navigate callback are gone:
// Home is a permanent row in the sidebar directly above this list, so a second
// control for it was the same duplication the Home/Chat tabs were (cave-fh9so).
assert.doesNotMatch(
  workspaceSidebar,
  /type WorkspaceSidebarMode/,
  "the embedded list declares no navigation mode of its own",
)
assert.doesNotMatch(workspaceSidebar, /onNavigate/, "the embedded list has no Home escape hatch — Home is a sidebar row above it");
assert.doesNotMatch(workspaceSidebar, /cave:navigate-mode/, "workspace-sidebar should not dispatch raw mode events for its own navigation buttons");
// The Chats primary-nav header keeps a labeled familiar switcher near thread
// navigation (#2747, restored by cave-l3ay after #2750 briefly removed it as a
// supposed duplicate).
assert.doesNotMatch(workspaceSidebar, /<SidebarRailHeader/, "the embedded list mounts no header — its host renders the one copy");
const sidebarRailHeaderBlock = sidebarMinimal.match(/<SidebarRailHeader[\s\S]*?\/>/)?.[0] ?? "";
assert.match(
  sidebarRailHeaderBlock,
  /selectedFamiliarIds=\{selectedFamiliarIds\}/,
  "the shared familiar-scope set reaches the header without collapsing to a first member",
);
assert.doesNotMatch(workspaceSidebar, /cnav__eyebrow/, "the old Recent eyebrow stays retired");
assert.match(workspaceSidebar, /ph:git-pull-request/, "should support PR glyph on thread rows");
// Hover row-actions order: bookmark (pin) → archive → delete, so archive sits
// to the RIGHT of the bookmark button. The archive button flips to unarchive
// on archived rows, and the sidebar options menu exposes Show archived
// (default-off wiring is pinned in chat-siderail-hide-archived.test.ts).
assert.match(
  workspaceSidebar,
  /onClick=\{onTogglePin\}[\s\S]*?onClick=\{onToggleArchive\}[\s\S]*?onClick=\{onRequestDelete\}/,
  "row actions must order bookmark → archive → delete",
);
assert.match(
  workspaceSidebar,
  /name=\{archived \? "ph:arrow-counter-clockwise" : "ph:archive"\}/,
  "the archive button must flip to unarchive on archived rows",
);
assert.match(workspaceSidebar, /Show archived/, "the sidebar options menu must expose Show archived");
// Outer CSS classes for e2e compat
assert.match(workspaceSidebar, /workspace-sidebar chat-sidebar/, "outer div must include both CSS classes for e2e compat");
assert.doesNotMatch(workspaceSidebar, /workspace-sidebar__rail|chat-sidebar__rail/, "chat sidebar no longer renders a collapsed rail child");
// The search placeholder must fit the panel's ~200px minimum width (the old
// "Search projects or threads…" clipped); the control now filters chats only.
// The search field went with the old search row; the header is a title row
// with a single collapse control now (cave-fh9so). ChatList keeps its own
// search on the Sessions list view.
assert.doesNotMatch(
  workspaceSidebar,
  /placeholder="Search chats…"/,
  "the embedded list carries no search field of its own",
)

// One sidebar, no swap: the session rail is docked in the chat surface beside
// the conversation rather than replacing the global nav (cave-fh9so).
assert.match(
  workspace,
  /const contextualNav = sidebar;/,
  "the shell always receives the one sidebar",
)
assert.doesNotMatch(workspace, /const list = mode === "chat" \? chatSidebar : undefined;/, "workspace should not mount Chats in the list slot");
// cave-fh9so: with one shared sidebar there is no contextual nav to activate.
assert.match(workspace, /navPolicy="remembered"/, "every surface takes the remembered nav preference");
assert.doesNotMatch(workspace, /navPolicy=\{mode === "chat" \? "visit-collapsed" : "remembered"\}/, "chat mode should not use the obsolete visit-collapsed policy");
assert.doesNotMatch(workspace, /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/, "chat mode should not reserve a persistent list pane");
assert.match(workspace, /nav=\{contextualNav\}\s*list=\{undefined\}/, "workspace passes contextual nav and no list content");
assert.match(workspace, /onToggleList=\{undefined\}/, "top bar exposes no list toggle");
assert.match(workspace, /navDrawerOpen=\{navDrawerOpen\}\s*listDrawerOpen=\{false\}/, "top bar only reflects the mobile nav drawer");
// No separate chat-sidebar block survives; the rail's wiring lives in the chat
// surface (cave-fh9so).
assert.doesNotMatch(workspace, /const chatSidebar =/, "no second sidebar element survives");
// Instant highlight (n-1 bug): the active session must come from mirrored
// state — optimistic at click time, reconciled by ChatRouter's
// onActiveSessionChange — never from a render-time routerRef read, which
// always lagged one update behind the deferred openSession() hop.
assert.match(chatSurface, /activeSessionId=\{railActiveSessionId\}/, "the docked rail highlight reads the mirrored active-session state");
assert.doesNotMatch(workspace, /activeSessionId=\{routerRef\.current\?\.currentSessionId\(\) \?\? null\}/, "no sidebar may read the router handle during render for the active session");
assert.match(workspace, /const openFamiliarSession = useCallback\(\(sessionId: string[\s\S]*?setActiveChatSessionId\(sessionId\);/, "opening a session sets the highlight optimistically at click time");
assert.match(workspace, /onActiveSessionChange=\{setActiveChatSessionId\}/, "ChatRouter reconciles the mirrored state (new-chat promotion, back-to-list)");
assert.doesNotMatch(workspace, /dismissListMobile/, "nothing targets the unused list drawer");
assert.ok((workspace.match(/dismissNavMobile/g) ?? []).length >= 5, "workspace actions dismiss the mobile nav drawer");
// Session opens come from the docked rail inside the chat surface now, which
// is display:none on mobile — there is no drawer to dismiss from there.
assert.match(chatSurface, /openSessionInSplit\(session\.id\)/, "the docked rail can open a session in a split");
assert.match(workspace, /const startWorkspaceChat = useCallback\(\(request: AgentsNewChatRequest = \{\}\) => \{[\s\S]*?dismissNavMobile\(\);/, "starting a new chat dismisses the mobile nav drawer");
assert.match(workspace, /onNewChat=\{startWorkspaceChat\}/, "the sidebar delegates new-chat launches to the shared gate");
// Home is a destination row now, so its mobile dismissal rides the shared
// onModeChange handler rather than a bespoke onNavigate callback.
assert.match(workspace, /onModeChange=\{\(m\) => \{[\s\S]*?dismissNavMobile\(\);/, "sidebar destination taps dismiss the mobile nav drawer");
assert.match(workspace, /onOpenUrl=\{\(url\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?openUrlInApp\(url\);[\s\S]*?\}\}/, "sidebar PR links dismiss the mobile nav drawer before opening");
assert.match(workspace, /onOpenSettings=\{\(\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?nextRouter\.push\("\/settings"\);[\s\S]*?\}\}/, "chat sidebar settings dismisses the mobile nav drawer");
assert.doesNotMatch(workspace, /hideThreadRail/, "ChatSurface shows its docked thread rail — suppressing it left the chat page with no list");
assert.doesNotMatch(workspace, /const exitChatMode = useCallback/, "workspace should not keep an unused chat-exit helper");
assert.doesNotMatch(workspace, /lastNonChatMode/, "workspace should not track an unused prior-surface exit contract");
// chat-view wiring (unchanged — just verify it still exists)
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture failing project root on 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement add-project recovery");

// ChatView uses the stable Workspace callback directly without introducing a
// second global refresh mechanism.
assert.doesNotMatch(
  chatView,
  /cave:sessions-refresh/,
  "ChatView does not introduce a second global sessions-refresh mechanism",
);
assert.doesNotMatch(
  workspace,
  /cave:sessions-refresh/,
  "Workspace keeps the callback chain as the single explicit refresh mechanism",
);
assert.match(
  workspace,
  /const capturedActiveId = activeIdRef\.current;\s*\n\s*const capturedScopeKey = chatAttentionProjectionScopeKey\(capturedActiveId\);[\s\S]*?const scope = capturedActiveId/,
  "loadSessions captures the current familiar and attention projection scope from activeIdRef",
);
assert.match(
  workspace,
  /const loadSessions = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[\]\);/,
  "loadSessions has stable empty callback dependencies",
);
assert.match(
  workspace,
  /useEffect\(\(\) => \{\s*\n\s*void loadSessions\(\);\s*\n\s*\}, \[activeId, loadSessions\]\);/,
  "mount and each active familiar scope change explicitly reload sessions once",
);

console.log("workspace-sidebar-wiring.test.ts passed");

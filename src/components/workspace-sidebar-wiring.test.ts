// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// workspace-sidebar.tsx feature assertions
assert.match(workspaceSidebar, /deriveChatProjectGroups\(applyProjectOverrides/, "should group by project with overrides");
assert.match(workspaceSidebar, /handleRegister/, "should offer register-as-project for unregistered roots");
assert.match(workspaceSidebar, /Register \$\{label\} as a project/, "register label must be accessible");
assert.match(workspaceSidebar, /deriveChatRecencyBuckets\(/, "should derive time buckets for Recent view");
assert.match(workspaceSidebar, /Organize sidebar/, "should expose Organize sidebar menu");
assert.match(workspaceSidebar, /readChatSidebarView\(\)/, "organize mode should hydrate from persisted pref");
assert.match(workspaceSidebar, /relativeTime\(iso, Date\.now\(\), "bare"\)/, 'row times should use bare density');
assert.ok((workspaceSidebar.match(/<ThreadRow/g) ?? []).length >= 2, "both view branches should render ThreadRow");
assert.match(workspaceSidebar, /const sessionProjectById = useMemo\(\(\) => \{[\s\S]*?for \(const group of groups\)/, "recent-row project lookup derives from override-aware groups");
assert.match(workspaceSidebar, /indent="flat"\s*\n\s*project=\{sessionProjectById\.get\(session\.id\) \?\? null\}/, "recent rows pass project identity");
assert.match(workspaceSidebar, /cnav__thread-proj[\s\S]*?<ProjectAvatar name=\{project\.name\} root=\{project\.root\} color=\{project\.color\} size="sm"/, "renders ProjectAvatar tile in flat rows with the explicit project color");
assert.match(workspaceSidebar, /<span className="sr-only">\{project\.name\}<\/span>/, "project name is announced for AT");
assert.doesNotMatch(workspaceSidebar, /cnav__footer|cnav__user-plan/, "should not render user plan footer");
// Project group headers: two-line label (bold name over activity meta) with the
// user-set project color on the avatar; the meta line subsumes the count badge.
assert.match(workspaceSidebar, /function groupMeta\(group: ChatProjectGroup\): string \{[\s\S]*?running > 0[\s\S]*?"chat" : "chats"/, "group meta reports running count or chat count");
assert.match(workspaceSidebar, /<ProjectAvatar name=\{label\} root=\{group\.projectRoot\} color=\{group\.projectColor\} size="sm" className="cnav__folder" \/>/, "group header avatar uses the explicit project color");
assert.match(workspaceSidebar, /<span className="cnav__group-text">[\s\S]*?cnav__group-name[\s\S]*?<span className="cnav__group-meta">\{groupMeta\(group\)\}<\/span>/, "group header stacks name over the activity meta line");
assert.doesNotMatch(workspaceSidebar, /cnav__count/, "the count badge is retired — the meta line carries the count");
// One-row quick actions: New chat + the Scheduled/Plugins icon chips share a
// single row (no stacked mini-row), and the header hosts the familiar switcher.
assert.doesNotMatch(workspaceSidebar, /cnav__mini-row/, "the stacked mini-row is retired — quick actions are one row");
assert.match(workspaceSidebar, /aria-label=\{scheduledCount \? `Scheduled \(\$\{scheduledCount\}\)` : "Scheduled"\}/, "Scheduled shortcut is an icon chip with an accessible name");
assert.match(workspaceSidebar, /type WorkspaceSidebarMode = "home" \| "inbox" \| "marketplace";/, "sidebar navigation callback should accept only Home, Scheduled, and Plugins destinations");
assert.match(workspaceSidebar, /onClick=\{\(\) => onNavigate\("home"\)\}/, "Home button should navigate through the explicit sidebar callback");
assert.match(workspaceSidebar, /onClick=\{\(\) => onNavigate\("inbox"\)\}/, "Scheduled button should navigate through the explicit sidebar callback");
assert.match(workspaceSidebar, /onClick=\{\(\) => onNavigate\("marketplace"\)\}/, "Plugins button should navigate through the explicit sidebar callback");
assert.doesNotMatch(workspaceSidebar, /cave:navigate-mode/, "workspace-sidebar should not dispatch raw mode events for its own navigation buttons");
// The Chats primary-nav header keeps a labeled familiar switcher near thread
// navigation (#2747, restored by cave-l3ay after #2750 briefly removed it as a
// supposed duplicate).
assert.match(workspaceSidebar, /<header className="cnav__header">[\s\S]*?<FamiliarSwitcher/, "the chat sidebar header hosts the familiar switcher");
assert.doesNotMatch(workspaceSidebar, /cnav__eyebrow/, "the old Recent eyebrow stays retired");
assert.match(workspaceSidebar, /ph:git-pull-request/, "should support PR glyph on thread rows");
assert.match(workspaceSidebar, /scheduledCount/, "should accept scheduledCount prop");
// Outer CSS classes for e2e compat
assert.match(workspaceSidebar, /workspace-sidebar chat-sidebar/, "outer div must include both CSS classes for e2e compat");
assert.doesNotMatch(workspaceSidebar, /workspace-sidebar__rail|chat-sidebar__rail/, "chat sidebar no longer renders a collapsed rail child");
// The search placeholder must fit the panel's ~200px minimum width (the old
// "Search projects or threads…" clipped); the aria-label keeps the full scope.
assert.match(workspaceSidebar, /placeholder="Search chats…"/, "search placeholder fits the narrow panel");
assert.match(workspaceSidebar, /aria-label="Search projects and threads"/, "search keeps its descriptive accessible name");
assert.match(workspace, /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/, "workspace selects Chats as the contextual primary nav");
assert.doesNotMatch(workspace, /const list = mode === "chat" \? chatSidebar : undefined;/, "workspace should not mount Chats in the list slot");
assert.match(workspace, /navPolicy=\{mode === "chat" \? "chat-contextual" : "remembered"\}/, "chat mode activates the contextual nav policy");
assert.doesNotMatch(workspace, /navPolicy=\{mode === "chat" \? "visit-collapsed" : "remembered"\}/, "chat mode should not use the obsolete visit-collapsed policy");
assert.doesNotMatch(workspace, /listPolicy=\{mode === "chat" \? "persistent" : "collapsible"\}/, "chat mode should not reserve a persistent list pane");
assert.match(workspace, /nav=\{contextualNav\}\s*list=\{undefined\}/, "workspace passes contextual nav and no list content");
assert.match(workspace, /onToggleList=\{undefined\}/, "top bar exposes no list toggle");
assert.match(workspace, /navDrawerOpen=\{navDrawerOpen\}\s*listDrawerOpen=\{false\}/, "top bar only reflects the mobile nav drawer");
const chatSidebarBlock = workspace.match(/const chatSidebar =[\s\S]*?const contextualNav =/)?.[0] ?? "";
assert.ok(chatSidebarBlock, "workspace should keep the chat sidebar wiring together");
assert.doesNotMatch(chatSidebarBlock, /dismissListMobile/, "chat sidebar callbacks should not dismiss the list drawer");
assert.ok((chatSidebarBlock.match(/dismissNavMobile/g) ?? []).length >= 6, "chat sidebar actions dismiss the mobile nav drawer");
assert.match(workspace, /onOpenSession=\{\(session\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?\}\}/, "opening a chat session dismisses the mobile nav drawer");
assert.match(workspace, /onOpenSessionInSplit=\{\(session\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?\}\}/, "opening a split chat dismisses the mobile nav drawer");
assert.match(workspace, /onNewChat=\{\(projectRoot\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?\}\}/, "starting a new chat dismisses the mobile nav drawer");
assert.match(workspace, /onNavigate=\{\(nextMode\) => \{[\s\S]*?setMode\(nextMode\);[\s\S]*?dismissNavMobile\(\);[\s\S]*?\}\}/, "sidebar Home, Scheduled, and Plugins routes dismiss the mobile nav drawer");
assert.match(workspace, /onOpenUrl=\{\(url\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?openUrlInApp\(url\);[\s\S]*?\}\}/, "sidebar PR links dismiss the mobile nav drawer before opening");
assert.match(workspace, /onOpenSettings=\{\(\) => \{[\s\S]*?dismissNavMobile\(\);[\s\S]*?nextRouter\.push\("\/settings"\);[\s\S]*?\}\}/, "chat sidebar settings dismisses the mobile nav drawer");
assert.match(workspace, /hideThreadRail/, "ChatSurface keeps its internal thread rail hidden");
assert.doesNotMatch(workspace, /const exitChatMode = useCallback/, "workspace should not keep an unused chat-exit helper");
assert.doesNotMatch(workspace, /lastNonChatMode/, "workspace should not track an unused prior-surface exit contract");
// chat-view wiring (unchanged — just verify it still exists)
assert.match(chatView, /setProjectAccessRoot/, "chat-view should capture failing project root on 403");
assert.match(chatView, /async function handleAddProject/, "chat-view should implement add-project recovery");

console.log("workspace-sidebar-wiring.test.ts passed");

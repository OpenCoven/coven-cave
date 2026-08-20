import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Familiars-first Chats home (cave-ru7ay): the home lists familiars, tapping
// one opens its chat, and session selection lives in the config popover.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");
const familiarThreads = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift");
const familiarList = await read("apps/ios/CovenCave/CovenCave/Views/FamiliarsListView.swift");

// --- The project-scoped familiar chat helpers -------------------------------
// Tapping a familiar should only consider the active project's direct/server
// activity.
assert.match(
  model,
  /func directThreads\(for familiarId: String, in context: ProjectContext\) -> \[ChatThread\]/,
  "AppModel's direct-thread helpers must consume an explicit project context",
);
assert.match(
  model,
  /func landingDirectThread\(for familiarId: String, in context: ProjectContext\) -> ChatThread\?/,
  "AppModel's landing-thread helper must consume an explicit project context",
);
assert.match(
  model,
  /func projectLandingDirectThread[\s\S]{0,320}?landingDirectThread\(for: familiarId, in: projectContext\)/,
  "the active-project landing thread must delegate to the context-aware helper",
);
assert.match(
  model,
  /func serverOnlySessions\(for familiarId: String, in context: ProjectContext\) -> \[SessionRow\]/,
  "server-only session helpers must consume an explicit project context",
);
assert.match(
  model,
  /func globalServerOnlySessions\(for familiarId: String\) -> \[SessionRow\]/,
  "everywhere search keeps an explicit global server-only helper",
);
assert.match(
  model,
  /func projectRecentThreads\(limit: Int = 5\) -> \[ChatThread\]/,
  "AppModel exposes project-scoped recents for the drawer",
);
assert.match(
  model,
  /func validatedOpenContext\(for thread: ChatThread\) -> ProjectContext\?[\s\S]*func canOpen\(_ thread: ChatThread\) -> Bool/,
  "AppModel must expose a pure thread-open validation helper",
);
assert.match(
  model,
  /func threadOpenFailure\(for thread: ChatThread\) -> ThreadOpenFailure\?/,
  "AppModel must expose thread-open failures for recovery UI",
);
assert.match(
  model,
  /var projectMostRecentThread: ChatThread\?/,
  "AppModel exposes the most recent visible project thread",
);
assert.match(
  familiarList,
  /struct FamiliarsListPresentation[\s\S]*visibleFamiliars = app\.projectFamiliars/,
  "FamiliarsListView should always derive its roster from the active project's familiar membership",
);
assert.match(
  familiarList,
  /showsCachedAccessBanner = app\.projectMembershipLoaded && app\.familiarsError != nil/,
  "cached membership refresh failures should surface a stale-data banner instead of falling back globally",
);
assert.match(
  familiarList,
  /"No familiars have access"/,
  "a registered project with an empty roster should explain that no familiars have access",
);
assert.match(
  familiarList,
  /"No recovery familiars"/,
  "the Unassigned roster should use recovery-specific empty-state copy",
);
assert.match(
  familiarList,
  /FamiliarDetailStatsModel\.make\(app: app, familiar: familiar, context: scopedContext\)/,
  "familiar detail stats should be derived from the explicit active project context",
);
assert.match(
  familiarList,
  /app\.lastActivity\(for: familiar\.id, in: \$0\)/,
  "familiar detail activity should stay scoped to the explicit project context",
);
assert.match(
  familiarList,
  /return "No activity yet"/,
  "familiar detail stats should fall back cleanly when the active project has no activity for a familiar",
);

const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

// --- The home is a familiar list --------------------------------------------
assert.doesNotMatch(
  home,
  /ForEach\(recentThreads\)/,
  "the cross-familiar recents section is gone",
);
assert.doesNotMatch(
  home,
  /struct FamiliarRailItem/,
  "the horizontal rail item is gone",
);
assert.match(
  home,
  /ForEach\(filteredFamiliars\) \{ familiar in\s*\n\s*FamiliarConversationRow\(familiar: familiar\)/,
  "the list renders one conversation row per familiar",
);
assert.match(
  home,
  /private var filteredFamiliars: \[Familiar\] \{[\s\S]{0,220}app\.projectFamiliars/,
  "the visible familiar list is scoped to the active project",
);
assert.match(
  home,
  /private var activeProjectContext: ProjectContext \{[\s\S]*app\.projectContext \?\? \.unassigned[\s\S]*\}/,
  "ChatsHome must snapshot the active project context for thread-history routing",
);
assert.match(
  home,
  /\.onChange\(of: activeProjectContext\.id\) \{[\s\S]*handleProjectContextChange\(\)/,
  "ChatsHome must explicitly react when the active project id changes",
);
assert.match(
  home,
  /private func handleProjectContextChange\(\) \{[\s\S]*detailPath = \[\][\s\S]*selection = nil[\s\S]*selectMostRecentThreadIfNeeded\(\)/,
  "project switches must clear stale sidebar/detail selection before seeding the next project's default chat",
);
assert.match(
  home,
  /FamiliarConversationRow[\s\S]*?\.tag\(ChatRoute\.familiar\(familiar\)\)/,
  "familiar rows are tagged so the sidebar selection drives the detail column",
);

// The row carries the iMessage payload: who, what was last said, and when.
assert.match(home, /struct FamiliarConversationRow: View/, "a familiar conversation row exists");
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?AvatarView\(familiar: familiar/,
  "the row shows the familiar's avatar",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.projectLandingDirectThread\(for: familiar\.id\)[\s\S]*?app\.projectServerOnlySessions\(for: familiar\.id\)/,
  "the row must consider both local and server-only project activity",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.projectHasUnread\(familiar\.id\)/,
  "the row keeps the unread indicator scoped to the active project",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.projectLastActivity\(for: familiar\.id\)/,
  "the row timestamp must reflect the active project's latest local or server activity",
);

// --- One tap lands in the conversation ---------------------------------------
// The detail column resolves a familiar to its chat. FamiliarThreadsView is no
// longer the tap target; it becomes the session picker (Task 4).
assert.match(
  home,
  /case \.familiar\(let familiar\):\s*\n\s*familiarChat\(familiar\)/,
  "selecting a familiar shows its chat, not a thread list",
);
assert.match(
  home,
  /private func familiarChat[\s\S]{0,500}?app\.projectLandingDirectThread\(for: familiar\.id\)[\s\S]*?app\.projectServerOnlySessions\(for: familiar\.id\)\.first/,
  "the detail pane must fall back to the active project's newest server-only session",
);
assert.match(
  home,
  /private func chatDestination\([\s\S]*_ thread: ChatThread,[\s\S]*app\.threadOpenFailure\(for: thread\)[\s\S]*ThreadOpenRecoveryView/,
  "ChatsHome must gate ChatView behind the shared thread-open validator",
);
assert.match(
  home,
  /private struct FamiliarServerLandingView: View[\s\S]*?app\.openServerSession\(session, familiarId: familiar\.id\)/,
  "server-only familiar landings must materialize the project-scoped session before opening chat",
);
assert.match(
  home,
  /private struct FamiliarServerLandingView: View[\s\S]*app\.threadOpenFailure\(for: thread\)[\s\S]*ThreadOpenRecoveryView/,
  "server-only familiar landings must recover instead of mounting an invalid sendable chat",
);
assert.match(
  home,
  /private func selectMostRecentThreadIfNeeded\(\) \{[\s\S]{0,700}projectThreads[\s\S]{0,220}projectLastActivity[\s\S]{0,220}open\(\.familiar\(familiar\)\)|open\(\.thread\(mostRecentGroupThread\)\)/,
  "default selection must compare active-project familiar activity against group threads",
);

const chat = await read("apps/ios/CovenCave/CovenCave/Views/ChatView.swift");

// --- Session selection lives in the config card ------------------------------
// The card already holds Model / Runtime / Inventory; Session joins them,
// mirroring the Project row that is already scoped to the conversation.
assert.match(
  chat,
  /sessionDetailsCard[\s\S]*?sessionDetailRow\(\s*\n?\s*"Session"/,
  "the config card exposes a Session row",
);
assert.match(
  chat,
  /"Session",[\s\S]{0,200}?showsChevron: true/,
  "the Session row is tappable",
);
assert.match(
  chat,
  /showSessionPicker\s*=\s*true/,
  "tapping the Session row opens the picker",
);
assert.match(
  chat,
  /\.sheet\(isPresented: \$showSessionPicker\)[\s\S]{0,500}?FamiliarThreadsView\([\s\S]*projectContext: visibleThreadContext/,
  "the picker is FamiliarThreadsView pinned to the visible thread context",
);
assert.match(
  home,
  /FamiliarThreadsView\(familiar: familiar,\s*projectContext: activeProjectContext,\s*path: \$detailPath/,
  "ChatsHome must pass its active project context into FamiliarThreadsView",
);
assert.match(
  familiarThreads,
  /let projectContext: ProjectContext/,
  "FamiliarThreadsView accepts an explicit project context",
);
assert.match(
  familiarThreads,
  /app\.directThreads\(for: familiar\.id,\s*in: projectContext\)[\s\S]*app\.serverOnlySessions\(for: familiar\.id,\s*in: projectContext\)/,
  "FamiliarThreadsView must derive local and server rows from its explicit project context",
);
assert.match(
  familiarThreads,
  /private func chooseIfOpenable\(_ thread: ChatThread\) \{[\s\S]*guard app\.canOpen\(thread\) else \{[\s\S]*app\.threadOpenFailure\(for: thread\)[\s\S]*showToast/,
  "FamiliarThreadsView must validate a thread before choosing it from the session picker",
);
assert.match(
  familiarThreads,
  /case \.local\(let thread\):\s*\n\s*chooseIfOpenable\(thread\)[\s\S]*case \.server\(let session\):[\s\S]*chooseIfOpenable\(app\.openServerSession\(session, familiarId: familiar\.id\)\)/,
  "local and server rows in FamiliarThreadsView must share the same open validation path",
);
assert.match(
  familiarThreads,
  /app\.markFamiliarViewed\(\[familiar\.id\],\s*in: projectContext\)/,
  "FamiliarThreadsView must clear unread state in its explicit project context",
);

console.log("ios-chat-familiars-home.test.mjs: ok");

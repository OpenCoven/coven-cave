// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const chatList = await readFile(new URL("./chat-list.tsx", import.meta.url), "utf8");
const projectsView = await readFile(new URL("./projects-view.tsx", import.meta.url), "utf8");

assert.match(
  workspace,
  /const locallyDeletedSessionIdsRef = useRef<Set<string>>\(new Set\(\)\)/,
  "Workspace should keep local delete tombstones beside shared session state",
);

assert.match(
  workspace,
  /const baseSessions = filterDeletedSessions\(\(json\.sessions \?\? \[\]\) as SessionRow\[\], locallyDeletedSessionIdsRef\.current\)/,
  "Workspace should filter every sessions/list response before it reaches shared state",
);

assert.match(
  workspace,
  /const visibleBaseSessions = filterDeletedSessions\(baseSessions, locallyDeletedSessionIdsRef\.current\)[\s\S]*?attachGitHubTaskContext\(visibleBaseSessions, tasks\)/,
  "GitHub task enrichment should not reintroduce locally deleted sessions",
);

assert.match(
  workspace,
  /if \(!res\.ok \|\| !json\.ok\) \{[\s\S]*?throw new Error\(json\.error \?\? "delete failed"\)/,
  "Workspace delete should fail closed before hiding a row or invalidating cache",
);

assert.match(
  workspace,
  /const handleSessionsDeleted = useCallback\(\(sessionIds: readonly string\[\]\) => \{[\s\S]*?recordDeletedSessionIds\(locallyDeletedSessionIdsRef\.current, sessionIds\)[\s\S]*?setSessions\(\(currentSessions\) => \{[\s\S]*?filterDeletedSessions\(/,
  "Workspace should own the confirmed-delete transition and remove ids from shared sessions",
);

assert.match(
  workspace,
  /for \(const sessionId of confirmedIds\) invalidateConversation\(sessionId\);\s*void loadSessions\(\)/,
  "Workspace should invalidate confirmed ids and then refresh once in the background",
);

assert.match(workspace, /handleSessionsDeleted\(\[session\.id\]\)/, "sidebar deletion uses the shared boundary");
assert.match(workspace, /onSessionsDeleted=\{handleSessionsDeleted\}/, "nested chat surfaces receive the shared boundary");

assert.equal(
  chatSurface.match(/onSessionsDeleted=\{onSessionsDeleted\}/g)?.length,
  2,
  "ChatSurface threads the boundary to both Projects and ChatRouter",
);
assert.equal(
  chatRouter.match(/onSessionsDeleted=\{onSessionsDeleted\}/g)?.length,
  3,
  "ChatRouter threads the boundary to the list, primary chat, and split-pane chats",
);

for (const [name, source] of [
  ["ChatView", chatView],
  ["ChatList", chatList],
  ["ProjectsView", projectsView],
]) {
  assert.match(
    source,
    /onSessionsDeleted: \(sessionIds: readonly string\[\]\) => void/,
    `${name} requires the shared delete boundary so a new caller cannot silently omit it`,
  );
}

const chatViewDelete = chatView.match(/const deleteChat = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(chatViewDelete, /if \(!res\.ok \|\| !json\.ok\) \{[\s\S]*?return;[\s\S]*?onSessionsDeleted\(\[sessionId\]\)/);
assert.doesNotMatch(chatViewDelete, /invalidateConversation|onSessionsChanged/, "header delete delegates reconciliation only after success");

const chatListDelete = chatList.match(/const deleteSession = async[\s\S]*?\n  \};/)?.[0] ?? "";
assert.match(chatListDelete, /if \(!res\.ok \|\| !json\.ok\) \{[\s\S]*?return;[\s\S]*?onSessionsDeleted\(\[sessionId\]\)/);
assert.doesNotMatch(chatListDelete, /invalidateConversation|onSessionsChanged/, "list delete delegates reconciliation only after success");

// The Projects access page no longer deletes sessions itself, but its props
// contract still requires the shared boundary so a future caller can't omit
// it; the delete FLOWS live in ChatView/ChatList/Workspace, asserted above.
assert.doesNotMatch(projectsView, /invalidateConversation/, "Projects delegates cache invalidation to Workspace");
assert.match(chatList, /successfulSessionIds\([\s\S]*?if \(deletedIds\.length > 0\) onSessionsDeleted\(deletedIds\)/);

assert.match(
  workspaceSidebar,
  /const \[deleteError, setDeleteError\] = useState<string \| null>\(null\)/,
  "WorkspaceSidebar should retain failed deletes as visible row errors",
);

assert.match(
  workspaceSidebar,
  /catch \(err\) \{[\s\S]*?setDeleteError\(err instanceof Error \? err\.message : "delete failed"\)/,
  "WorkspaceSidebar should surface delete failures instead of clearing the row",
);

console.log("workspace-session-delete.test.ts passed");

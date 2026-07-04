// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Locks the guarantee that chat-mode thread lists are filtered by the selected
// familiar. Chat mode now owns the unified project/thread navigator through
// WorkspaceSidebar, while ChatSurface/ChatRouter still render the transcript
// and compact in-thread list. This pins each load-bearing seam — a regression
// at any one of them would let another familiar's threads leak into chat mode.
// Mirrors the idiom in board-view-familiar-scope.test.ts.
// (`filterVisibleChatSessions` itself is behaviorally tested in
// chat-projects.test.ts.)

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = await readFile(new URL("./chat-list.tsx", import.meta.url), "utf8");
const workspaceSidebar = await readFile(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

// 1. Workspace feeds the *selected* familiar into the chat surface.
//    `active` is the single-selected familiar (null for All / multiselect).
assert.match(
  workspace,
  /mode === "chat" \? \([\s\S]*?<ChatSurface[\s\S]*?activeFamiliar=\{active\}/,
  "workspace must pass the active (selected) familiar into ChatSurface",
);

// 2. ChatSurface forwards that familiar (and the sessions) into ChatRouter on the
//    compact chat-mode path — without the familiar prop the list can't scope.
assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*?familiar=\{activeFamiliar\}[\s\S]*?sessions=\{sessions\}[\s\S]*?compact=\{compactRail\}/,
  "ChatSurface must forward activeFamiliar + sessions into ChatRouter (compact on the chat-mode ChatSidebar path)",
);

// 3. ChatRouter scopes the sidebar/thread list to the familiar (null = show all,
//    the deliberate escape hatch for the All-familiars scope).
assert.match(
  chatRouter,
  /filterVisibleChatSessions\(sessions, familiar\?\.id \?\? null\)/,
  "ChatRouter must derive the thread rail via filterVisibleChatSessions keyed on the familiar",
);

// 4. ChatList (the rendered thread list) re-applies the same familiar scope, so
//    even a directly-mounted list can't show another familiar's threads.
assert.match(
  chatList,
  /return filterVisibleChatSessions\(rows, familiar\?\.id \?\? null\);/,
  "ChatList must filter its visible rows by the familiar",
);

// 5. The chat-mode left project navigator (WorkspaceSidebar) counts per-project
//    sessions too, so its project list + count badges must be scoped to the same
//    familiar — otherwise "proj 4" tallies every familiar's chats next to a
//    familiar-filtered thread list.
assert.match(
  workspace,
  /const chatSidebar = \([\s\S]*?<WorkspaceSidebar[\s\S]*?activeFamiliarId=\{activeId\}/,
  "workspace must pass the active familiar id into the chat-mode WorkspaceSidebar",
);

// 6. WorkspaceSidebar scopes the sessions that drive its project list + per-project
//    counts/rows to the active familiar (null = count everything), then derives
//    the project tiles and rows from that scoped set.
assert.match(
  workspaceSidebar,
  /filterVisibleChatSessions\(sessions, activeFamiliarId \?\? null\)/,
  "WorkspaceSidebar must derive visibleSessions from the active familiar",
);
assert.match(
  workspaceSidebar,
  /deriveChatProjectGroups\(applyProjectOverrides\(visibleSessions, overrides\), projects\)/,
  "WorkspaceSidebar project list + counts must come from the familiar-scoped sessions",
);
assert.match(
  workspaceSidebar,
  /group\.sessions\.length/,
  "WorkspaceSidebar per-project rows/counts must use grouped familiar-scoped sessions",
);

console.log("code-surface-familiar-scope.test.ts: ok");

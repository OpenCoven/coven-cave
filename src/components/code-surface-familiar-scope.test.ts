// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Locks the guarantee that the Code surface's thread list is filtered by the
// selected familiar. The Code page (mode "code") renders a `ChatSurface
// surface="code"` whose thread rail + list come from `filterVisibleChatSessions`
// keyed off the active familiar. This is a multi-component prop chain, so this
// test pins each load-bearing seam — a regression at any one of them would let
// another familiar's threads leak into the Code page. Mirrors the idiom in
// board-view-familiar-scope.test.ts. (`filterVisibleChatSessions` itself is
// behaviorally tested in chat-projects.test.ts.)

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatList = await readFile(new URL("./chat-list.tsx", import.meta.url), "utf8");
const codeSidebar = await readFile(new URL("./code-sidebar.tsx", import.meta.url), "utf8");

// 1. Workspace feeds the *selected* familiar into the Code surface's chat pane.
//    `active` is the single-selected familiar (null for All / multiselect).
assert.match(
  workspace,
  /surface="code"[\s\S]*?activeFamiliar=\{active\}/,
  "workspace must pass the active (selected) familiar into the Code surface ChatSurface",
);

// 2. ChatSurface forwards that familiar (and the sessions) into ChatRouter on the
//    Code surface (compact) path — without the familiar prop the list can't scope.
assert.match(
  chatSurface,
  /<ChatRouter[\s\S]*?familiar=\{activeFamiliar\}[\s\S]*?sessions=\{sessions\}[\s\S]*?compact=\{compactRail\}/,
  "ChatSurface must forward activeFamiliar + sessions into ChatRouter (compact on the Code surface / chat-mode ChatSidebar)",
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

// 5. The Code surface's left project navigator (CodeSidebar) counts per-project
//    sessions too, so its project list + count badges must be scoped to the same
//    familiar — otherwise "proj 4" tallies every familiar's chats next to a
//    familiar-filtered thread list.
assert.match(
  workspace,
  /<CodeSidebar[\s\S]*?activeFamiliarId=\{activeId\}/,
  "workspace must pass the active familiar id into CodeSidebar",
);

// 6. CodeSidebar scopes the sessions that drive its project list + per-project
//    counts/rows to the active familiar (null = count everything), then derives
//    the project tiles and rows from that scoped set.
assert.match(
  codeSidebar,
  /const scopedSessions = useMemo\(\s*\(\)\s*=>\s*activeFamiliarId\s*\?\s*sessions\.filter\(\(session\) => session\.familiarId === activeFamiliarId\)\s*:\s*sessions/,
  "CodeSidebar must derive scopedSessions from the active familiar",
);
assert.match(
  codeSidebar,
  /deriveComuxProjects\(scopedSessions\)/,
  "CodeSidebar project list + counts must come from the familiar-scoped sessions",
);
assert.match(
  codeSidebar,
  /sessionsForProject\(scopedSessions, project\)/,
  "CodeSidebar per-project rows must use the familiar-scoped sessions",
);

console.log("code-surface-familiar-scope.test.ts: ok");

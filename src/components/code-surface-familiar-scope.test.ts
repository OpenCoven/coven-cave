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
  /<ChatRouter[\s\S]*?familiar=\{activeFamiliar\}[\s\S]*?sessions=\{sessions\}[\s\S]*?compact=\{isCodeSurface\}/,
  "ChatSurface must forward activeFamiliar + sessions into ChatRouter (compact on the Code surface)",
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

console.log("code-surface-familiar-scope.test.ts: ok");

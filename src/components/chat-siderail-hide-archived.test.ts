// @ts-nocheck
//
// Guard: archived chats never render in the siderail.
//
// Two layers keep an archived chat out of every rail:
//  1. `filterVisibleChatSessions` (the shared visibility filter every rail —
//     ChatProjectSidebar via chat-list/chat-router, WorkspaceSidebar — builds
//     from) drops `archived_at` rows by DEFAULT; only an explicit
//     `{ includeArchived: true }` opts back in.
//  2. chat-list's own "Show archived" toggle opts the MAIN list in, but its
//     sidebar groups are built from an archive-free `railSessions` view, so
//     toggling archived chats visible in the list can't leak them into the
//     rail.
//
// Source-string pins, same convention as chat-thread-rail.test.ts. The
// behavioral half (default drop / opt-in keep) lives in
// src/lib/chat-projects.test.ts.
//
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatProjects = readFileSync(new URL("../lib/chat-projects.ts", import.meta.url), "utf8");
const chatList = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const chatRouter = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const workspaceSidebar = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

// 1. The shared filter is archive-free by default, with an explicit opt-in.
assert.match(
  chatProjects,
  /const includeArchived = opts\?\.includeArchived \?\? false;/,
  "filterVisibleChatSessions must default to excluding archived chats",
);
assert.match(
  chatProjects,
  /\.filter\(\(session\) => includeArchived \|\| !session\.archived_at\)/,
  "the filter must drop archived_at rows unless the caller opts in",
);

// 2. chat-list: the list's toggle opts in explicitly…
assert.match(
  chatList,
  /filterVisibleChatSessions\(rows, familiar\?\.id \?\? null, \{ includeArchived: showArchived \}\)/,
  "the main chat list passes its Show-archived toggle through the opt-in",
);

// …but the rail builds from an archive-free view of the same rows.
assert.match(
  chatList,
  /const railSessions = useMemo\(\(\) => mine\.filter\(\(s\) => !s\.archived_at\), \[mine\]\);/,
  "the siderail's session source strips archived rows even while the toggle is on",
);
assert.match(
  chatList,
  /const sidebarGroups = useMemo\(\(\) => deriveChatProjectGroups\(applyProjectOverrides\(railSessions, projectOverrides\), projects\)/,
  "sidebar groups must derive from the archive-free railSessions view",
);

// 3. The other rails build from the shared filter WITHOUT the archived opt-in,
//    so they inherit the archive-free default.
assert.match(
  chatRouter,
  /filterVisibleChatSessions\(sessions, familiar\?\.id \?\? null\)/,
  "chat-router's rail source uses the default (archive-free) filter",
);
assert.doesNotMatch(
  chatRouter,
  /includeArchived: true/,
  "chat-router never opts rails into archived rows",
);
assert.match(
  workspaceSidebar,
  /filterVisibleChatSessions\(sessions, activeFamiliarId \?\? null\)/,
  "the workspace siderail uses the default (archive-free) filter",
);
assert.doesNotMatch(
  workspaceSidebar,
  /includeArchived/,
  "the workspace siderail never opts into archived rows",
);

console.log("chat-siderail-hide-archived.test.ts: ok");

// @ts-nocheck
//
// Guard: archived chats stay out of every siderail unless the user explicitly
// opts in.
//
// Layers that keep an archived chat out of the rails by default:
//  1. `filterVisibleChatSessions` (the shared visibility filter every rail —
//     ChatProjectSidebar via chat-list/chat-router, WorkspaceSidebar — builds
//     from) drops `archived_at` rows by DEFAULT; only an explicit
//     `{ includeArchived: true }` opts back in.
//  2. chat-list's own "Show archived" toggle opts the MAIN list in, but its
//     sidebar groups are built from an archive-free `railSessions` view, so
//     toggling archived chats visible in the list can't leak them into the
//     rail.
//  3. WorkspaceSidebar (the chat sidepanel) stays archive-free; archive
//     visibility exists only in the main Sessions list, which routes
//     `includeArchived` through the shared filter.
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

// 3. chat-router builds its rail from the shared filter WITHOUT the archived
//    opt-in, so it inherits the archive-free default.
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

// 4. WorkspaceSidebar (the chat sidepanel) always uses the archive-free
//    shared default; archived visibility exists only on the Sessions page.
assert.doesNotMatch(
  workspaceSidebar,
  /const \[showArchived, setShowArchived\]/,
  "the Chat side rail must not own an archived-visibility toggle",
);
assert.match(
  workspaceSidebar,
  /const visibleSessions = useMemo\(\s*\(\) =>\s*filterVisibleChatSessions\(sessions, activeFamiliarId \?\? null\),\s*\[sessions, activeFamiliarId\],\s*\);/,
  "the Chat side rail must derive visible sessions with the archive-free default",
);
assert.doesNotMatch(
  workspaceSidebar,
  /filterVisibleChatSessions\([\s\S]*?\{\s*includeArchived:/,
  "the Chat side rail must never opt its visible-session filter into archived rows",
);
assert.doesNotMatch(
  workspaceSidebar,
  /\/api\/sessions\/list\?includeArchived=1/,
  "the Chat side rail must not fetch archived rows",
);
assert.doesNotMatch(
  workspaceSidebar,
  /PopoverLabel/,
  "the Chat side rail must not include the removed archive-visibility Popover",
);
assert.doesNotMatch(
  workspaceSidebar,
  /ph:dots-three-bold/,
  "the Chat side rail must not include the removed archive-visibility trigger",
);
assert.match(
  workspaceSidebar,
  /async function setSessionArchived\(session: SessionRow, archived: boolean\) \{[\s\S]*?if \(!res\.ok \|\| !json\.ok\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?onSessionsChanged\?\.\(\);[\s\S]*?\}/,
  "the archive success path must refresh sessions after a successful response",
);

console.log("chat-siderail-hide-archived.test.ts: ok");

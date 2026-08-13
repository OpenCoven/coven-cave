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
//  3. WorkspaceSidebar (the chat sidepanel) has its own "Show archived"
//     option: OFF by default (archive-free), and only its explicit toggle
//     routes `includeArchived` through the shared filter.
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

// 4. WorkspaceSidebar (the chat sidepanel) has its own explicit "Show
//    archived" option: the toggle defaults OFF, its state is the only thing
//    that routes includeArchived through the shared filter, and the opt-in
//    fetch is gated behind the same toggle.
assert.match(
  workspaceSidebar,
  /const \[showArchived, setShowArchived\] = useState\(false\);/,
  "the sidepanel's Show-archived option must default off (archive-free)",
);
assert.match(
  workspaceSidebar,
  /filterVisibleChatSessions\(rows, activeFamiliarId \?\? null, \{ includeArchived: showArchived \}\)/,
  "the sidepanel passes its Show-archived option through the shared filter's opt-in",
);
assert.match(
  workspaceSidebar,
  /if \(!showArchived\) \{\s*\n\s*setArchivedRows\(\[\]\);/,
  "turning Show archived off must clear the fetched archived rows",
);
assert.match(
  workspaceSidebar,
  /\/api\/sessions\/list\?includeArchived=1/,
  "archived rows load via the explicit includeArchived fetch (the workspace poll stays archive-free)",
);

console.log("chat-siderail-hide-archived.test.ts: ok");

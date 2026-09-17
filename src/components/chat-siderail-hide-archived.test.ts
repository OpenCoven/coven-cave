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
//  3. WorkspaceSidebar (the chat sidepanel) is archive-free by design: it
//     owns no "Show archived" toggle, never fetches archived rows, and never
//     routes an archive opt-in through the shared filter — the default
//     archive-free view is the only one it can have (cave-zdbij).
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
//    …now through visibleChatSessions (cave-dkdev), the shared selector the
//    workspace sidebar also calls. The archive opt-in is still the caller's and
//    still explicit; only the composition moved behind one name, so the two
//    surfaces can no longer disagree about which chats exist.
assert.match(
  chatList,
  /visibleChatSessions\(sessions, familiar\?\.id \?\? null, \{[\s\S]*?showArchived,/,
  "the main chat list passes its Show-archived toggle through the opt-in",
);

// …but the rail builds from an archive-free view of the same rows.
assert.match(
  chatList,
  /const railSessions = useMemo\(\(\) => withoutArchivedChatSessions\(mine\), \[mine\]\)/,
  "the siderail's session source strips archived rows even while the toggle is on",
);
assert.match(
  chatList,
  /deriveChatListProjectGroups\(\s*filtered,\s*railSessions,\s*projects,\s*projectIndex,\s*projectOverrides/,
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

// 4. WorkspaceSidebar (the chat sidepanel) owns no archive-visibility
//    control at all: no toggle state, no archived-row state, no opt-in fetch,
//    and no archive opt-in routed through the shared filter. Archive
//    visibility belongs to ChatList (the Sessions list) alone.
assert.doesNotMatch(
  workspaceSidebar,
  /const \[showArchived, setShowArchived\]|const showArchived =/,
  "the Chat side rail must not own an archive-visibility toggle",
);
assert.doesNotMatch(
  workspaceSidebar,
  /archivedRows|archiveNonce/,
  "the Chat side rail must not keep archived-row or archive-fetch state",
);
assert.doesNotMatch(
  workspaceSidebar,
  /includeArchived: showArchived|includeArchived: true/,
  "the Chat side rail must use the archive-free shared visibility default",
);
assert.doesNotMatch(
  workspaceSidebar,
  /\/api\/sessions\/list\?includeArchived=1/,
  "the Chat side rail must not fetch archived rows",
);
assert.match(
  workspaceSidebar,
  /visibleChatSessions\(normalizedSessions, activeFamiliarId \?\? null\)/,
  "the Chat side rail derives its rows through the shared filter's archive-free default",
);

console.log("chat-siderail-hide-archived.test.ts: ok");

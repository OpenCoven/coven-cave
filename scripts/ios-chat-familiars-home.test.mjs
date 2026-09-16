import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// The familiars-first home is intentionally migrated to individual global
// conversations. Exact participant identity and the in-chat session picker stay.
const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/${p}`, import.meta.url), "utf8");
const model = await read("State/AppModel.swift");
const familiarThreads = await read("Views/FamiliarThreadsView.swift");
const home = await read("Views/ChatsHomeView.swift");
const chat = await read("Views/ChatView.swift");
const projection = await read("State/ChatListSnapshot.swift");

for (const name of ["directThreads", "landingDirectThread", "serverOnlySessions"]) {
  assert.match(
    model,
    new RegExp(`func ${name}\\(for familiarId: String, in context: ProjectContext\\)`),
    `${name} must continue accepting an exact conversation context`,
  );
}
assert.match(model, /func threadOpenFailure\(for thread: ChatThread\) -> ThreadOpenFailure\?/);
assert.match(model, /func globalServerOnlySessions\(for familiarId: String\) -> \[SessionRow\]/);
assert.match(home, /ChatListSnapshot\(\s*threads: app\.chatThreads,\s*sessions: app\.chatServerSessions,/);
assert.match(home, /ForEach\(snapshot\.entries\)/, "home renders real resumable conversations");
assert.match(home, /\.tag\(ChatRoute\.thread\(thread\)\)/, "local rows select their exact conversation");
assert.doesNotMatch(home, /filteredFamiliars|FamiliarConversationRow|handleProjectContextChange/);
assert.match(home, /ServerSessionRow\(session: session\)/, "unhydrated desktop chats remain visible");
assert.match(home, /requestOpenServerSession\(session, fallbackFamiliarId: session\.familiarId\)/);
assert.match(projection, /represented\.contains\(SessionIdentity/, "hydrated sessions are deduplicated");
assert.match(projection, /thread\.familiarIds\.contains\(familiarId\)/, "only actual participant bindings suppress server rows");
assert.doesNotMatch(projection, /thread\.messages/, "list sorting and filtering never scan transcripts");
assert.match(home, /struct ThreadRow[\s\S]*?thread\.messages\.last/, "each row observes its own preview");
assert.match(home, /struct ThreadRow[\s\S]*?app\.seenBoundary\(for: thread\)/, "unread uses the conversation context");
assert.match(home, /parts\.append\("unread"\)/, "unread is announced, not only colored");
assert.match(home, /app\.threadDrafts\[thread\.id\]/, "unsent drafts remain discoverable");
assert.match(
  home,
  /private func selectMostRecentThreadIfNeeded\(\)[\s\S]*guard sizeClass == \.regular,[\s\S]*selection == nil/,
  "only an empty wide detail may auto-select; iPhone keeps its conversation list",
);
assert.match(
  home,
  /private func chatDestination\([\s\S]*_ thread: ChatThread,[\s\S]*app\.threadOpenFailure\(for: thread\)[\s\S]*ThreadOpenRecoveryView/,
  "malformed conversation metadata cannot silently become sendable",
);

assert.match(chat, /sessionDetailsCard[\s\S]*?sessionDetailRow\(\s*"Conversation"/);
assert.match(chat, /"Conversation",[\s\S]{0,200}?showsChevron: true/);
assert.match(chat, /showSessionPicker\s*=\s*true/);
assert.match(
  chat,
  /\.sheet\(isPresented: \$showSessionPicker\)[\s\S]{0,500}?FamiliarThreadsView\([\s\S]*projectContext: visibleThreadContext/,
  "the in-chat session picker is pinned to the visible conversation",
);
assert.match(familiarThreads, /let projectContext: ProjectContext/);
assert.match(
  familiarThreads,
  /app\.directThreads\(for: familiar\.id,\s*in: projectContext\)[\s\S]*app\.serverOnlySessions\(for: familiar\.id,\s*in: projectContext\)/,
);
assert.match(
  familiarThreads,
  /private func chooseIfOpenable\(_ thread: ChatThread\)[\s\S]*guard app\.canOpen\(thread\)[\s\S]*showToast/,
);
assert.match(
  familiarThreads,
  /case \.local\(let thread\):\s*chooseIfOpenable\(thread\)[\s\S]*case \.server\(let session\):[\s\S]*chooseIfOpenable\(app\.openServerSession\(session, familiarId: familiar\.id\)\)/,
);
assert.doesNotMatch(familiarThreads, /app\.markFamiliarViewed\(/,
  "opening the session picker does not read every listed conversation");
assert.doesNotMatch(familiarThreads, /requestOpenDestination\(/, "New chat never changes shell scope");
for (const action of ["setThreadPinned", "setThreadMuted", "setThreadArchived", "renameThread", "duplicateThread", "exportThreadsZip", "deleteThread"]) {
  assert.ok(home.includes(action), `${action} remains reachable on the global chat list`);
}
assert.match(familiarThreads, /app\.deleteThreads\(selectedIds\)/, "session selection retains bulk deletion");

console.log("ios-chat-familiars-home.test.mjs: ok");

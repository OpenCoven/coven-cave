import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/${p}`, import.meta.url), "utf8");

const model = await read("State/AppModel.swift");
// Unread = activity newer than last viewed; new familiars seeded so the backlog
// isn't all flagged on first launch.
assert.match(model, /var familiarViews: \[String: Date\] = \[:\]/, "AppModel should track per-familiar last-viewed times");
assert.match(
  model,
  /private func familiarViewKey\(for familiarId: String, in context: ProjectContext\?\) -> String/,
  "AppModel should key unread state by familiar and optional project context",
);
assert.match(
  model,
  /func projectHasUnread\(_ familiarId: String\) -> Bool \{[\s\S]*projectLastActivity\(for: familiarId\)[\s\S]*activity > seen/,
  "project unread badges should compare project activity against the scoped seen time",
);
assert.match(model, /func markFamiliarViewed\(_ ids: \[String\]\)/, "AppModel should expose markFamiliarViewed");
assert.match(model, /func markFamiliarViewed\(_ ids: \[String\], in context: ProjectContext\?\)/, "AppModel should expose explicit scoped unread updates");
assert.match(model, /private func seedFamiliarViews\(_ ids: \[String\], in context: ProjectContext\?\)/, "AppModel should seed new familiars as seen per context");
assert.match(model, /seedFamiliarViews\(nextFamiliars\.map\(\\\.id\), in: nil\)/, "project-context loads should seed the global familiar view map");
assert.match(model, /loadFamiliarViews\(\)/, "init should load persisted views");
assert.match(model, /cave-familiar-views\.json/, "views should persist to disk");

assert.match(model, /var threadViews: \[String: Date\] = \[:\]/,
  "read acknowledgements must have conversation-level identity");
assert.match(model, /func markThreadViewed\(_ thread: ChatThread,/);
assert.match(model, /projectContextDefaults\.set\(seen, forKey: Self\.threadViewKey\(thread\.id\)\)/,
  "conversation read state must persist independently of familiar-wide migration baselines");

// Opening one conversation must not acknowledge other conversations.
const chat = await read("Views/ChatView.swift");
assert.match(chat, /app\.markThreadViewed\(thread\)/, "opening a chat acknowledges only that conversation");
assert.doesNotMatch(chat, /app\.markFamiliarViewed\(/);
const threads = await read("Views/FamiliarThreadsView.swift");
assert.doesNotMatch(threads, /app\.markFamiliarViewed\(/,
  "browsing the session picker is not reading every conversation");

// The Chats row shows an accent unread dot.
const home = await read("Views/ChatsHomeView.swift");
// The rail avatar is now the only place this renders: FamiliarRow carried a
// second copy on one line, and it went with the reorder sheet (cave-ios-reorder).
// \s* between the calls so the rail's multi-line chain matches too.
assert.match(
  home,
  /if hasUnread \{\s*Circle\(\)\s*\.fill\(accentColor\)/,
  "the conversation row shows an accent unread dot",
);
assert.match(home, /app\.seenBoundary\(for: thread\)/, "unread comes from the exact conversation context");
assert.match(home, /app\.markThreadViewed\(thread, through: activityAt\)/);
assert.match(home, /if hasUnread \{ parts\.append\("unread"\) \}/, "VoiceOver should announce unread");

console.log("ios-unread-badges: ok");

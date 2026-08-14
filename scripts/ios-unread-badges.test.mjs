import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (p) => readFile(new URL(`../apps/ios/CovenCave/CovenCave/${p}`, import.meta.url), "utf8");

const model = await read("State/AppModel.swift");
// Unread = activity newer than last viewed; new familiars seeded so the backlog
// isn't all flagged on first launch.
assert.match(model, /var familiarViews: \[String: Date\] = \[:\]/, "AppModel should track per-familiar last-viewed times");
assert.match(
  model,
  /func hasUnread\(_ familiarId: String\) -> Bool \{[\s\S]*lastActivity\(for: familiarId\)[\s\S]*activity > seen/,
  "hasUnread should compare lastActivity against the seen time",
);
assert.match(model, /func markFamiliarViewed\(_ ids: \[String\]\)/, "AppModel should expose markFamiliarViewed");
assert.match(model, /private func seedFamiliarViews\(_ ids: \[String\]\)/, "AppModel should seed new familiars as seen");
assert.match(model, /seedFamiliarViews\(familiars\.map\(\\\.id\)\)/, "loadFamiliars should seed views");
assert.match(model, /loadFamiliarViews\(\)/, "init should load persisted views");
assert.match(model, /cave-familiar-views\.json/, "views should persist to disk");

// Opening a chat or a familiar's threads marks it read.
const chat = await read("Views/ChatView.swift");
assert.match(chat, /app\.markFamiliarViewed\(thread\.familiarIds\)/, "opening a chat marks its familiars read");
const threads = await read("Views/FamiliarThreadsView.swift");
assert.match(threads, /app\.markFamiliarViewed\(\[familiar\.id\]\)/, "opening a familiar's threads marks it read");

// The Chats row shows an accent unread dot.
const home = await read("Views/ChatsHomeView.swift");
// The rail avatar is now the only place this renders: FamiliarRow carried a
// second copy on one line, and it went with the reorder sheet (cave-ios-reorder).
// \s* between the calls so the rail's multi-line chain matches too.
assert.match(
  home,
  /if app\.hasUnread\(familiar\.id\) \{\s*Circle\(\)\s*\.fill\(chrome\.accent\)/,
  "the familiar rail avatar should show an accent unread dot",
);
assert.match(home, /if app\.hasUnread\(familiar\.id\) \{ parts\.append\("unread"\) \}/, "VoiceOver should announce unread");

console.log("ios-unread-badges: ok");

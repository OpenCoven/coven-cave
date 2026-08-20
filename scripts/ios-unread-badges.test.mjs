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

// Opening a chat or a familiar's threads marks it read.
const chat = await read("Views/ChatView.swift");
assert.match(chat, /app\.markFamiliarViewed\(\s*thread\.familiarIds,\s*in: app\.projectContext\(for: thread\)\s*\)/, "opening a chat marks its familiars read in that thread's project context");
const threads = await read("Views/FamiliarThreadsView.swift");
assert.match(
  threads,
  /app\.markFamiliarViewed\(\[familiar\.id\],\s*in: projectContext\)/,
  "opening a familiar's threads marks it read in the explicit picker context",
);

// The Chats row shows an accent unread dot.
const home = await read("Views/ChatsHomeView.swift");
// The rail avatar is now the only place this renders: FamiliarRow carried a
// second copy on one line, and it went with the reorder sheet (cave-ios-reorder).
// \s* between the calls so the rail's multi-line chain matches too.
assert.match(
  home,
  /if app\.projectHasUnread\(familiar\.id\) \{\s*Circle\(\)\s*\.fill\(chrome\.accent\)/,
  "the familiar row avatar should show an accent unread dot",
);
assert.match(home, /if app\.projectHasUnread\(familiar\.id\) \{ parts\.append\("unread"\) \}/, "VoiceOver should announce unread");

console.log("ios-unread-badges: ok");

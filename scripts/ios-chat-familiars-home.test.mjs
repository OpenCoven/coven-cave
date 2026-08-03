import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Familiars-first Chats home (cave-ru7ay): the home lists familiars, tapping
// one opens its chat, and session selection lives in the config popover.
const read = (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const model = await read("apps/ios/CovenCave/CovenCave/State/AppModel.swift");

// --- The familiar's current chat -------------------------------------------
// Tapping a familiar needs one session to land on. Reuses directThreads(for:),
// which already sorts pinned-first then newest-updated.
assert.match(
  model,
  /func landingDirectThread\(for familiarId: String\) -> ChatThread\?/,
  "AppModel exposes the familiar's landing thread",
);
assert.match(
  model,
  /func landingDirectThread[\s\S]{0,320}?directThreads\(for: familiarId\)/,
  "it reuses directThreads(for:) rather than re-sorting",
);
assert.match(
  model,
  /func landingDirectThread[\s\S]{0,320}?\.first \{[^}]*archived/,
  "an archived thread is never the landing target",
);

const home = await read("apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift");

// --- The home is a familiar list --------------------------------------------
assert.doesNotMatch(
  home,
  /ForEach\(recentThreads\)/,
  "the cross-familiar recents section is gone",
);
assert.doesNotMatch(
  home,
  /struct FamiliarRailItem/,
  "the horizontal rail item is gone",
);
assert.match(
  home,
  /ForEach\(filteredFamiliars\) \{ familiar in\s*\n\s*FamiliarConversationRow\(familiar: familiar\)/,
  "the list renders one conversation row per familiar",
);
assert.match(
  home,
  /FamiliarConversationRow[\s\S]*?\.tag\(ChatRoute\.familiar\(familiar\)\)/,
  "familiar rows are tagged so the sidebar selection drives the detail column",
);

// The row carries the iMessage payload: who, what was last said, and when.
assert.match(home, /struct FamiliarConversationRow: View/, "a familiar conversation row exists");
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?AvatarView\(familiar: familiar/,
  "the row shows the familiar's avatar",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.landingDirectThread\(for: familiar\.id\)/,
  "the row derives its preview from the familiar's landing thread",
);
assert.match(
  home,
  /struct FamiliarConversationRow[\s\S]*?app\.hasUnread\(familiar\.id\)/,
  "the row keeps the unread indicator the rail had",
);

// --- One tap lands in the conversation ---------------------------------------
// The detail column resolves a familiar to its chat. FamiliarThreadsView is no
// longer the tap target; it becomes the session picker (Task 4).
assert.match(
  home,
  /case \.familiar\(let familiar\):\s*\n\s*familiarChat\(familiar\)/,
  "selecting a familiar shows its chat, not a thread list",
);
assert.match(
  home,
  /private func familiarChat[\s\S]{0,400}?app\.landingDirectThread\(for: familiar\.id\)/,
  "the chat resolves through the familiar's landing thread",
);
assert.match(
  home,
  /private func familiarChat[\s\S]{0,600}?ContentUnavailableView/,
  "a familiar with no thread gets a start-a-chat placeholder, not a blank pane",
);

console.log("ios-chat-familiars-home.test.mjs: ok");

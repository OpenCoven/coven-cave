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
  /func mostRecentDirectThread\(for familiarId: String\) -> ChatThread\?/,
  "AppModel exposes the familiar's most recent direct thread",
);
assert.match(
  model,
  /func mostRecentDirectThread[\s\S]{0,240}?directThreads\(for: familiarId\)/,
  "it reuses directThreads(for:) rather than re-sorting",
);
assert.match(
  model,
  /func mostRecentDirectThread[\s\S]{0,240}?\.first \{ !\$0\.archived \}/,
  "an archived thread is never the landing target",
);

console.log("ios-chat-familiars-home.test.mjs: ok");

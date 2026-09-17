import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url), "utf8",
);
const rowBlock = home.match(/ForEach\(snapshot\.entries\) \{ entry in[\s\S]*?\n            \}/)?.[0];
assert.ok(rowBlock, "the conversation ForEach block must exist");
assert.match(rowBlock, /\.contextMenu \{ threadActions\(thread, activityAt: entry\.updatedAt\) \}/);
assert.match(rowBlock, /\.swipeActions\(edge: \.leading\)[\s\S]{0,180}setThreadPinned/);
assert.match(rowBlock, /\.swipeActions\(edge: \.trailing[\s\S]{0,500}setThreadArchived/);
assert.match(rowBlock, /pendingDelete = thread/, "deletion requires confirmation");
const actions = home.slice(home.indexOf("private func threadActions"), home.indexOf("private func consumeGlobalRequests"));
assert.match(actions, /markThreadViewed\(thread, through: activityAt\)/,
  "Mark read acknowledges only this conversation, through its displayed activity");
assert.match(actions, /Label\("Mark read"/);
assert.match(home, /presentNewChat\(fixedFamiliarId: familiar\.id\)/,
  "contextual New chat keeps exact familiar identity");
console.log("ios-familiar-row-actions: ok");

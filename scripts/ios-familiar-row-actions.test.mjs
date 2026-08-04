import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url),
  "utf8",
);

// Familiar rows carry quick actions. Every assertion below is anchored inside
// the familiar ForEach block: an earlier version of this test chained
// `[\s\S]*` across the whole file and passed by matching a leading swipe on
// THREAD rows against a "New chat" label in the rail's context menu — three
// unrelated constructs that merely appeared in that order. Anchor, then match.
const rowBlock = home.match(/ForEach\(filteredFamiliars\) \{ familiar in[\s\S]*?\n            \}/)?.[0];
assert.ok(rowBlock, "the familiar ForEach block should be findable");

assert.match(
  home,
  /private func startNewChat\(with familiar: Familiar\) \{[\s\S]*presentNewChat\(familiarIds: \[familiar\.id\]\)/,
  "startNewChat should open project-aware New Chat with the familiar preselected",
);

assert.match(
  rowBlock,
  /\.swipeActions\(edge: \.leading\)[\s\S]{0,220}?startNewChat\(with: familiar\)[\s\S]{0,120}?Label\("New chat"/,
  "leading swipe should start a new chat",
);

assert.match(
  rowBlock,
  /\.swipeActions\(edge: \.trailing[\s\S]{0,260}?app\.hasUnread\(familiar\.id\)[\s\S]{0,200}?markFamiliarViewed\(\[familiar\.id\]\)/,
  "trailing swipe should mark read when unread",
);

assert.match(
  rowBlock,
  /\.contextMenu \{[\s\S]{0,400}?startNewChat\(with: familiar\)[\s\S]{0,300}?Mark all read/,
  "the context menu should offer New chat and Mark all read",
);

console.log("ios-familiar-row-actions: ok");

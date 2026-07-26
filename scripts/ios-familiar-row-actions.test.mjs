import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const home = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatsHomeView.swift", import.meta.url),
  "utf8",
);

// Familiar rows gain quick actions (parity with thread rows).
assert.match(
  home,
  /private func startNewChat\(with familiar: Familiar\) \{[\s\S]*startFreshThread\(familiarIds: \[familiar\.id\]\)[\s\S]*open\(\.thread\(thread\)\)/,
  "startNewChat should open a fresh thread with the familiar",
);

// The familiar NavigationLink has a leading swipe to start a new chat…
assert.match(
  home,
  /\.swipeActions\(edge: \.leading[\s\S]*startNewChat\(with: familiar\)[\s\S]*Label\("New chat"/,
  "leading swipe should start a new chat",
);
// …a trailing swipe to mark read when unread…
assert.match(
  home,
  /\.swipeActions\(edge: \.trailing[\s\S]*app\.hasUnread\(familiar\.id\)[\s\S]*markFamiliarViewed\(\[familiar\.id\]\)/,
  "trailing swipe should mark read when unread",
);
// …and a context menu mirroring both.
assert.match(
  home,
  /\.contextMenu \{[\s\S]*startNewChat\(with: familiar\)[\s\S]*Mark all read/,
  "the context menu should offer New chat and Mark all read",
);

console.log("ios-familiar-row-actions: ok");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatView.swift", import.meta.url),
  "utf8",
);

// The pushed conversation is a full-screen surface (like Messages): the root
// tab bar yields to the composer instead of stacking beneath it.
assert.match(
  chatView,
  /\.toolbar\(\.hidden, for: \.tabBar\)/,
  "ChatView should hide the root tab bar while a conversation is open",
);

console.log("ios-chat-hides-tab-bar.test.mjs: ok");

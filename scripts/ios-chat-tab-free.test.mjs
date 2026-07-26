import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatView = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatView.swift", import.meta.url),
  "utf8",
);
const rootView = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/RootView.swift", import.meta.url),
  "utf8",
);

// Conversations no longer need a per-view tab-bar workaround because the
// connected shell has no native tab container.
assert.doesNotMatch(
  chatView,
  /\.toolbar\(\.hidden, for: \.tabBar\)/,
  "ChatView should not depend on a removed native tab bar",
);
assert.doesNotMatch(rootView, /\bTabView\b/, "RootView should not mount a native tab container");
assert.doesNotMatch(rootView, /\bTab\("/, "RootView should not declare native tabs");

console.log("ios-chat-tab-free.test.mjs: ok");

import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const chatView = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatView.swift", import.meta.url),
  "utf8",
);

assert.doesNotMatch(chatView, /showSearch/, "ChatView should not keep per-thread search sheet state");
assert.doesNotMatch(chatView, /searchScrollTarget/, "ChatView should not keep search scroll target state");
assert.doesNotMatch(chatView, /highlightedMessageId/, "ChatView should not keep search highlight state");
assert.doesNotMatch(chatView, /Search this chat/, "ChatView should not render a per-thread search button");
assert.doesNotMatch(chatView, /ThreadSearchView/, "ChatView should not mount ThreadSearchView");

await assert.rejects(
  access(new URL("../apps/ios/CovenCave/CovenCave/Views/ThreadSearchView.swift", import.meta.url)),
  "ThreadSearchView should be removed with the per-thread search feature",
);

console.log("ios-chat-thread-no-search.test.mjs: ok");

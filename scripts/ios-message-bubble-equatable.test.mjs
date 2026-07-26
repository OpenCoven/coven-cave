import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chatView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/ChatView.swift"),
  "utf8",
);
const messageBubble = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/MessageBubble.swift"),
  "utf8",
);
const runner = fs.readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");

assert.match(
  chatView,
  /MessageBubble\([\s\S]*?\)\s*\.equatable\(\)\s*\.id\(message\.id\)/,
  "ChatView should skip re-rendering bubbles whose render inputs are unchanged",
);

assert.match(
  messageBubble,
  /extension MessageBubble: Equatable/,
  "MessageBubble should define its render-input equality contract",
);

assert.match(
  messageBubble,
  /lhs\.familiar == rhs\.familiar/,
  "familiar presentation changes should invalidate an equatable bubble",
);

assert.match(
  messageBubble,
  /lhs\.colorScheme == rhs\.colorScheme/,
  "light and dark appearance changes should invalidate an equatable bubble",
);

assert.match(
  messageBubble,
  /lhs\.chrome == rhs\.chrome/,
  "theme palette changes should invalidate an equatable bubble",
);

assert.doesNotMatch(
  messageBubble,
  /lhs\.familiar\?\.id == rhs\.familiar\?\.id/,
  "familiar equality must not ignore refreshed names, avatars, or colours",
);

assert.match(
  runner,
  /"scripts\/ios-message-bubble-equatable\.test\.mjs"/,
  "mobile test suite should run the message-bubble equality regression",
);

console.log("ios-message-bubble-equatable.test.mjs: ok");

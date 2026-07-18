import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chatView = fs.readFileSync(
  path.join(root, "apps/ios/CovenCave/CovenCave/Views/ChatView.swift"),
  "utf8",
);
const runner = fs.readFileSync(path.join(root, "scripts/run-tests.mjs"), "utf8");

assert.match(
  chatView,
  /@State private var draftPersistenceTask: Task<Void, Never>\?/,
  "ChatView should debounce draft persistence instead of writing UserDefaults on every keystroke",
);

assert.match(
  chatView,
  /private let draftPersistenceDelay: UInt64 = 250_000_000/,
  "ChatView should keep draft persistence delayed by 250ms",
);

assert.match(
  chatView,
  /private func scheduleDraftPersistence\(_ value: String\)[\s\S]*draftPersistenceTask\?\.cancel\(\)[\s\S]*Task \{ \[draftKey\] in[\s\S]*try\? await Task\.sleep\(nanoseconds: draftPersistenceDelay\)/,
  "draft edits should schedule one delayed persistence task, replacing older edits",
);

assert.match(
  chatView,
  /\.onChange\(of: draft\) \{ _, value in\s*scheduleDraftPersistence\(value\)\s*\}/,
  "draft onChange should only schedule debounced persistence",
);

assert.doesNotMatch(
  chatView,
  /\.onChange\(of: draft\) \{[\s\S]{0,260}UserDefaults\.standard\.(?:set|removeObject)/,
  "draft onChange must not touch UserDefaults synchronously on the typing path",
);

assert.match(
  chatView,
  /\.onDisappear \{[\s\S]*flushDraftPersistence\(\)/,
  "leaving the chat should flush the latest draft immediately",
);

assert.match(
  runner,
  /"scripts\/ios-chat-draft-lag\.test\.mjs"/,
  "mobile test suite should run the iOS chat draft lag regression",
);

console.log("ios-chat-draft-lag.test.mjs: ok");

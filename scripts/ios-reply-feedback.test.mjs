import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chat = await readFile(
  new URL("../apps/ios/CovenCave/CovenCave/Views/ChatView.swift", import.meta.url),
  "utf8",
);

// When streaming ends with a real assistant reply, fire a success haptic — but
// not for a user cancel or an error placeholder.
assert.match(
  chat,
  /onChange\(of: thread\.isStreaming\)[\s\S]*if !streaming \{[\s\S]*last\.role == \.assistant, !last\.isError,[\s\S]*!last\.text\.trimmingCharacters[\s\S]*Haptics\.success\(\)/,
  "reply completion should fire Haptics.success() only for a real assistant message",
);

console.log("ios-reply-feedback: ok");

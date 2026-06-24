import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const bubble = await read(`${iosRoot}/Views/MessageBubble.swift`);
const chat = await read(`${iosRoot}/Views/ChatView.swift`);

assert.match(
  bubble,
  /var onForward: \(\(DisplayMessage\) -> Void\)\? = nil/,
  "MessageBubble should expose an optional forward action with the original message",
);

assert.match(
  bubble,
  /Label\("Forward to Familiar", systemImage: "arrowshape\.turn\.up\.right"\)/,
  "message context menu should offer Forward to Familiar",
);

assert.match(
  chat,
  /@State private var forwardingMessage: DisplayMessage\?/,
  "ChatView should keep the message being forwarded while the familiar picker is open",
);

assert.match(
  chat,
  /onForward: \{ beginForward\(\$0\) \}/,
  "ChatView should wire message forward actions into the picker flow",
);

assert.match(
  chat,
  /private func forwardSenderName\(for message: DisplayMessage\) -> String \{[\s\S]*case \.user:[\s\S]*return "You"[\s\S]*case \.assistant:[\s\S]*app\.familiar[\s\S]*displayName[\s\S]*case \.system:[\s\S]*return "System"/,
  "forwarding should attribute the original sender as You, the familiar display name, or System",
);

assert.match(
  chat,
  /private func forwardPrompt\(for message: DisplayMessage, to familiar: Familiar\) -> String \{[\s\S]*Original sender:[\s\S]*Source thread:[\s\S]*Original role:[\s\S]*Forwarded message:/,
  "forward prompt should carry sender, source thread, role, and full message context",
);

assert.match(
  chat,
  /let destination = app\.directThread\(for: familiar\.id\)[\s\S]*destination\.send\(prompt,[\s\S]*displayText: displayText,[\s\S]*client: client/,
  "forwarding should send the context prompt to the selected familiar's direct thread with a compact visible label",
);

assert.match(
  chat,
  /app\.requestOpen\(destination\)/,
  "after forwarding, iOS should open the destination familiar thread",
);

console.log("ios-message-forwarding.test.mjs: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const destinations = source.match(/const DESTINATIONS:[\s\S]*?\n\];/)?.[0] ?? "";

assert.match(
  destinations,
  /id: "chat"[\s\S]*label: "Chat"/,
  "HomeComposer should keep Chat as a launch destination",
);

assert.match(
  destinations,
  /id: "board"[\s\S]*label: "Tasks"/,
  "HomeComposer should keep Tasks as a launch destination",
);

assert.match(
  destinations,
  /id: "reminder"[\s\S]*label: "Reminder"/,
  "HomeComposer should keep Reminder as a launch destination",
);

assert.doesNotMatch(
  destinations,
  /id: "inbox"[\s\S]*label: "Inbox"/,
  "HomeComposer should not offer Inbox as an original chat launch destination",
);

assert.doesNotMatch(
  destinations,
  /id: "call"[\s\S]*label: "Call"/,
  "HomeComposer should not offer Call as an original chat launch destination",
);

assert.match(
  source,
  /body: JSON\.stringify\(\{ familiarId: fid, prompt \}\)/,
  "HomeComposer should POST selected familiar chats to /api/chat/send",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "HomeComposer should allow OpenClaw familiars through native chat send",
);

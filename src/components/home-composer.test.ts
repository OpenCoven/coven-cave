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

assert.doesNotMatch(
  source,
  /\/api\/chat\/send/,
  "HomeComposer must not send chats itself — its cancel-after-session-event pattern aborted the request, killed the harness, and lost the transcript. Chat sends belong to ChatView.",
);

assert.match(
  source,
  /onStartChat\(prompt, fid\)/,
  "HomeComposer should hand the chat prompt to the workspace, which opens a new chat that auto-sends it",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "HomeComposer should allow OpenClaw familiars through native chat send",
);

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const styles = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

const assistantTurnRule = styles.match(/\.cave-turn-assistant\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const assistantContentRule = styles.match(/\.cave-turn-content\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
const source = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.ok(assistantTurnRule, "Assistant turn styles should exist");
assert.ok(assistantContentRule, "Assistant content styles should exist");

assert.match(
  assistantTurnRule,
  /width\s*:\s*100%/,
  "Assistant turns should take the full transcript width",
);

assert.doesNotMatch(
  assistantTurnRule,
  /grid-template-columns\s*:\s*32px\s+1fr/,
  "Assistant turns should not reserve a stale avatar column that narrows responses",
);

assert.match(
  assistantContentRule,
  /width\s*:\s*min\(100%,\s*920px\)/,
  "Assistant responses should use a wide readable content column",
);

assert.match(
  source,
  /familiarId: familiar\.id/,
  "ChatView should send the active familiar id to /api/chat/send",
);

assert.doesNotMatch(
  source,
  /native Cave chat only supports Codex, Claude Code, and Hermes right now/,
  "ChatView should allow OpenClaw familiars through native chat send",
);

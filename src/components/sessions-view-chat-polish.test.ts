// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./sessions-view.tsx", import.meta.url), "utf8");

// ───────── Task 1: Header hidden when hideFamiliarFilter is true ─────────
assert.match(
  source,
  /\{!hideFamiliarFilter\s*&&\s*\(\s*<div className="sessions-view-title-wrap">/,
  "Sub-header sessions-view-title-wrap must be gated on !hideFamiliarFilter",
);

// ───────── Task 2: In-list NewChatRow only when no sessions ─────────
assert.match(
  source,
  /\{showNewChat\s*&&\s*visible\.length\s*===\s*0\s*&&\s*<NewChatRow\s+onClick=\{onNewChat\}\s*\/>\}/,
  "NewChatRow inside SessionGroup must only render when sessions are empty",
);

assert.match(
  source,
  /\{showNewChat\s*&&\s*visible\.length\s*===\s*0\s*&&\s*<NewChatCard\s+onClick=\{onNewChat\}\s*\/>\}/,
  "NewChatCard inside SessionGroup must only render when sessions are empty",
);

console.log("sessions-view-chat-polish.test.ts: ok");

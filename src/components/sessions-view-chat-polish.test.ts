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

// ───────── Task 3: compact prop + row densification ─────────
assert.match(
  source,
  /type SessionsViewProps = \{[\s\S]*?compact\?:\s*boolean/,
  "SessionsViewProps must declare optional compact",
);

assert.match(
  source,
  /export function SessionsView\(\{[\s\S]*?compact\s*=\s*false,[\s\S]*?\}: SessionsViewProps\)/,
  "SessionsView must default compact to false",
);

assert.match(
  source,
  /function SessionRowItem\(\{[\s\S]*?compact[\s\S]*?\}: \{[\s\S]*?compact\?:\s*boolean/,
  "SessionRowItem must accept compact",
);

assert.match(
  source,
  /\{!compact\s*&&\s*\(\s*<div className="session-row-familiar-chip">/,
  "session-row-familiar-chip must be hidden when compact",
);

assert.match(
  source,
  /\{\(!compact\s*\|\|\s*session\.status\s*!==\s*"completed"\s*\|\|\s*archived\)\s*&&\s*\(\s*<div className="session-row-status-line">/,
  "Status line must hide when compact + status===completed + not archived",
);

assert.match(
  source,
  /\{label\s*&&\s*!\(compact\s*&&\s*session\.origin\s*===\s*"chat"\)\s*&&\s*<span className="session-card-origin">/,
  "originLabel must hide when compact + origin === 'chat'",
);

console.log("sessions-view-chat-polish.test.ts: ok");

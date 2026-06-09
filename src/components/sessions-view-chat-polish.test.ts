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

// ───────── Task 4: recency grouping ─────────
assert.match(
  source,
  /export function bucketByRecency\(/,
  "bucketByRecency helper must be exported for unit testability",
);

assert.match(
  source,
  /bucketByRecency[\s\S]*?today[\s\S]*?yesterday[\s\S]*?thisWeek[\s\S]*?older/,
  "bucketByRecency must define today/yesterday/thisWeek/older buckets",
);

for (const label of ["Today", "Yesterday", "This week", "Older"]) {
  assert.ok(source.includes(label), `Recency grouping must render the '${label}' section label`);
}

assert.match(
  source,
  /groupByRecency\s*&&\s*hideFamiliarFilter/,
  "Recency grouping must be gated on groupByRecency && hideFamiliarFilter",
);

const fnMatch = source.match(/export function bucketByRecency\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
assert.ok(fnMatch, "bucketByRecency body must be extractable");
const body = fnMatch[1]
  .replace(/: SessionRow\[\]/g, "")
  .replace(/: number/g, "")
  .replace(/: Date/g, "");
const bucketByRecency = new Function("sessions", "now", body);

const now = new Date("2026-06-08T12:00:00Z").getTime();
const dayMs = 24 * 60 * 60 * 1000;
const sessions = [
  { id: "a", title: "today",     updated_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(), created_at: "" },
  { id: "b", title: "yesterday", updated_at: new Date(now - 1.2 * dayMs).toISOString(),         created_at: "" },
  { id: "c", title: "thisweek",  updated_at: new Date(now - 4 * dayMs).toISOString(),           created_at: "" },
  { id: "d", title: "older",     updated_at: new Date(now - 14 * dayMs).toISOString(),          created_at: "" },
];
const out = bucketByRecency(sessions, now);
assert.deepEqual(out.today.map((s) => s.id),     ["a"], "today bucket");
assert.deepEqual(out.yesterday.map((s) => s.id), ["b"], "yesterday bucket");
assert.deepEqual(out.thisWeek.map((s) => s.id),  ["c"], "thisWeek bucket");
assert.deepEqual(out.older.map((s) => s.id),     ["d"], "older bucket");

console.log("sessions-view-chat-polish.test.ts: ok");

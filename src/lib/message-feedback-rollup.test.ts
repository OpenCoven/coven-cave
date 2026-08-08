// @ts-nocheck
import assert from "node:assert/strict";
import {
  EMPTY_FEEDBACK_ROLLUP,
  rollupMessageFeedback,
  rollupMessageFeedbackSnapshot,
} from "./message-feedback-rollup.ts";

// Empty input → the empty rollup shape.
assert.deepEqual(rollupMessageFeedback([]), EMPTY_FEEDBACK_ROLLUP);

const entries = [
  { messageId: "m1", vote: "up", cleared: false, familiarId: "sage", model: "claude-sonnet-4", runtime: "claude" },
  { messageId: "m2", vote: "down", cleared: false, familiarId: "sage", model: "claude-sonnet-4", runtime: "claude" },
  { messageId: "m3", vote: "up", cleared: false, familiarId: "sage", model: "gpt-5", runtime: "codex" },
  // m4 votes up, then toggles off — must not count.
  { messageId: "m4", vote: "up", cleared: false, familiarId: "sage", model: "gpt-5", runtime: "codex" },
  { messageId: "m4", vote: "up", cleared: true, familiarId: "sage", model: "gpt-5", runtime: "codex" },
  // m5 votes down, then switches to up — only the FINAL vote counts.
  { messageId: "m5", vote: "down", cleared: false, familiarId: "sage", model: "claude-sonnet-4", runtime: "claude" },
  { messageId: "m5", vote: "up", cleared: false, familiarId: "sage", model: "claude-sonnet-4", runtime: "claude" },
  // Another familiar's vote — excluded by the familiar filter.
  { messageId: "m6", vote: "down", cleared: false, familiarId: "imp", model: "gpt-5", runtime: "codex" },
  // No model/runtime stamp — counts toward totals but no bucket.
  { messageId: "m7", vote: "up", cleared: false, familiarId: "sage" },
];

const rollup = rollupMessageFeedback(entries, { familiarId: "sage" });
const snapshot = rollupMessageFeedbackSnapshot(entries, { familiarId: "sage" });
assert.equal(rollup.up, 4, "final ups: m1, m3, m5(switched), m7");
assert.equal(rollup.down, 1, "final downs: m2 only (m4 cleared, m5 switched)");
assert.equal(rollup.total, 5);
assert.equal(
  snapshot.freshness,
  null,
  "entries without timestamps degrade freshness to null without affecting counts",
);

const claude = rollup.models.find((m) => m.key === "claude-sonnet-4");
assert.deepEqual(
  { up: claude.up, down: claude.down, total: claude.total },
  { up: 2, down: 1, total: 3 },
  "claude-sonnet-4 bucket replays toggles and switches",
);
assert.ok(Math.abs(claude.approval - 2 / 3) < 1e-9, "approval = up/total");
const gpt = rollup.models.find((m) => m.key === "gpt-5");
assert.deepEqual({ up: gpt.up, down: gpt.down }, { up: 1, down: 0 }, "cleared m4 and imp's m6 are excluded");
assert.equal(rollup.models[0].key, "claude-sonnet-4", "buckets sort most-voted first");

const runtimes = Object.fromEntries(rollup.runtimes.map((r) => [r.key, r]));
assert.equal(runtimes.claude.total, 3);
assert.equal(runtimes.codex.total, 1);

const freshnessSnapshot = rollupMessageFeedbackSnapshot([
  { messageId: "m1", vote: "up", cleared: false, familiarId: "sage", at: "2026-08-07T20:00:00.000Z" },
  { messageId: "m1", vote: "down", cleared: false, familiarId: "sage", at: "2026-08-07T20:02:00.000Z" },
  { messageId: "m2", vote: "up", cleared: false, familiarId: "sage", at: "2026-08-07T20:01:00.000Z" },
  { messageId: "m3", vote: "up", cleared: false, familiarId: "imp", at: "2026-08-07T20:03:00.000Z" },
  { messageId: "m4", vote: "up", cleared: false, familiarId: "sage", at: "2026-08-07T20:04:00.000Z" },
  { messageId: "m4", vote: "up", cleared: true, familiarId: "sage", at: "2026-08-07T20:05:00.000Z" },
], { familiarId: "sage" });
assert.deepEqual(freshnessSnapshot.rollup, {
  up: 1,
  down: 1,
  total: 2,
  models: [],
  runtimes: [],
});
assert.equal(
  freshnessSnapshot.freshness,
  "2026-08-07T20:02:00.000Z",
  "freshness tracks the newest surviving familiar-scoped vote after re-votes and clears",
);

const clearedScopedSnapshot = rollupMessageFeedbackSnapshot([
  { messageId: "m8", vote: "up", cleared: false, familiarId: "sage", at: "2026-08-07T20:06:00.000Z" },
  { messageId: "m8", vote: "up", cleared: true, at: "2026-08-07T20:07:00.000Z" },
  { messageId: "m9", vote: "down", cleared: false, familiarId: "imp", at: "2026-08-07T20:08:00.000Z" },
], { familiarId: "sage" });
assert.deepEqual(
  clearedScopedSnapshot.rollup,
  EMPTY_FEEDBACK_ROLLUP,
  "a clear without familiarId removes the previously attributed Familiar vote while unrelated Familiar votes stay excluded",
);
assert.equal(
  clearedScopedSnapshot.freshness,
  null,
  "clearing the last scoped vote resets scoped freshness to null",
);

const revoteAfterClearSnapshot = rollupMessageFeedbackSnapshot([
  { messageId: "m8", vote: "up", cleared: false, familiarId: "sage", at: "2026-08-07T20:06:00.000Z" },
  { messageId: "m8", vote: "up", cleared: true, at: "2026-08-07T20:07:00.000Z" },
  { messageId: "m9", vote: "down", cleared: false, familiarId: "imp", at: "2026-08-07T20:08:00.000Z" },
  { messageId: "m8", vote: "down", cleared: false, familiarId: "sage", at: "2026-08-07T20:09:00.000Z" },
], { familiarId: "sage" });
assert.deepEqual(
  revoteAfterClearSnapshot.rollup,
  {
    up: 0,
    down: 1,
    total: 1,
    models: [],
    runtimes: [],
  },
  "a re-vote after a clear restores the scoped Familiar tally",
);
assert.equal(
  revoteAfterClearSnapshot.freshness,
  "2026-08-07T20:09:00.000Z",
  "a re-vote after clear restores the retained Familiar timestamp",
);

// No familiar filter → imp's vote joins the totals.
assert.equal(rollupMessageFeedback(entries).total, 6);
assert.equal(
  rollupMessageFeedbackSnapshot([], { familiarId: "sage" }).freshness,
  null,
  "empty feedback reports null freshness",
);

const bounded = rollupMessageFeedback(
  Array.from({ length: 40 }, (_, index) => ({
    messageId: `bucket-${index}`,
    vote: "up",
    cleared: false,
    familiarId: "sage",
    model: `model-${String(39 - index).padStart(2, "0")}`,
    runtime: `runtime-${String(39 - index).padStart(2, "0")}`,
  })),
  { bucketLimit: 5 },
);
assert.equal(bounded.total, 40, "bucket limits do not cap overall totals");
assert.deepEqual(
  bounded.models.map((slice) => slice.key),
  ["model-00", "model-01", "model-02", "model-03", "model-04"],
  "equal-count model buckets sort by stable key before truncation",
);
assert.deepEqual(
  bounded.runtimes.map((slice) => slice.key),
  ["runtime-00", "runtime-01", "runtime-02", "runtime-03", "runtime-04"],
  "equal-count runtime buckets sort by stable key before truncation",
);

// Malformed entries never throw and never count.
assert.equal(
  rollupMessageFeedback([null, {}, { messageId: "", vote: "up" }, { messageId: "x", vote: "sideways" }]).total,
  0,
  "junk input degrades to zero",
);

console.log("message-feedback-rollup.test.ts OK");

// @ts-nocheck
import assert from "node:assert/strict";
import { EMPTY_FEEDBACK_ROLLUP, rollupMessageFeedback } from "./message-feedback-rollup.ts";

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
assert.equal(rollup.up, 4, "final ups: m1, m3, m5(switched), m7");
assert.equal(rollup.down, 1, "final downs: m2 only (m4 cleared, m5 switched)");
assert.equal(rollup.total, 5);

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

// No familiar filter → imp's vote joins the totals.
assert.equal(rollupMessageFeedback(entries).total, 6);

// Malformed entries never throw and never count.
assert.equal(
  rollupMessageFeedback([null, {}, { messageId: "", vote: "up" }, { messageId: "x", vote: "sideways" }]).total,
  0,
  "junk input degrades to zero",
);

// #6357: provider-prefixed and dotted spellings of one model share a bucket.
const variants = rollupMessageFeedback([
  { messageId: "v1", vote: "up", cleared: false, model: "github/claude-fable-5" },
  { messageId: "v2", vote: "up", cleared: false, model: "anthropic/claude-fable-5" },
  { messageId: "v3", vote: "down", cleared: false, model: "Claude-Fable-5" },
  { messageId: "v4", vote: "up", cleared: false, model: "openai/gpt-6.1-sol" },
  { messageId: "v5", vote: "up", cleared: false, model: "gpt-6-1-sol" },
]);
assert.deepEqual(
  variants.models.map((m) => [m.key, m.up, m.down]),
  [
    ["claude-fable-5", 2, 1],
    ["gpt-6-1-sol", 2, 0],
  ],
  "spelling variants merge into one canonical model bucket",
);

console.log("message-feedback-rollup.test.ts OK");

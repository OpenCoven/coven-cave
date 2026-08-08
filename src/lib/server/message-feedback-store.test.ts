// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { FAMILIAR_DASHBOARD_LIMITS } from "../familiar-dashboard.ts";

const scratchRoot = path.join(
  process.cwd(),
  ".scratch-tests",
  `message-feedback-store-${process.pid}-${Date.now()}`,
);
await mkdir(scratchRoot, { recursive: true });
process.env.HOME = scratchRoot;
process.env.COVEN_HOME = path.join(scratchRoot, ".coven");

const fb = await import("./message-feedback-store.ts");

assert.ok(
  fb.MESSAGE_FEEDBACK_PATH.startsWith(scratchRoot),
  `refusing: MESSAGE_FEEDBACK_PATH ${fb.MESSAGE_FEEDBACK_PATH} not under scratch root`,
);

{
  const dirty = {
    messageId: "  turn-42  ",
    vote: "up",
    cleared: false,
    familiarId: "sage",
    model: "claude-sonnet-4",
    runtime: "claude",
    content: "the raw prompt text",
    secretToken: "abc",
  };
  const clean = fb.sanitizeMessageFeedback(dirty, "2026-07-03T00:00:00Z");
  assert.equal(clean.messageId, "turn-42", "trims the message id");
  assert.equal(clean.vote, "up");
  assert.equal(clean.cleared, false);
  assert.equal(clean.familiarId, "sage");
  assert.equal(clean.model, "claude-sonnet-4", "model stamp survives (per-model analytics)");
  assert.equal(clean.runtime, "claude", "runtime stamp survives (per-runtime analytics)");
  assert.equal(clean.at, "2026-07-03T00:00:00Z");
  assert.ok(
    !("content" in clean) && !("secretToken" in clean),
    "drops non-whitelisted keys (no content/secret leakage)",
  );
}
assert.equal(fb.sanitizeMessageFeedback({ messageId: "x" }, "t"), null, "no vote → rejected");
assert.equal(fb.sanitizeMessageFeedback({ vote: "up" }, "t"), null, "no messageId → rejected");
assert.equal(fb.sanitizeMessageFeedback({ messageId: "x", vote: "sideways" }, "t"), null, "bad vote → rejected");

const a = await fb.recordMessageFeedback({ messageId: "m1", vote: "down", familiarId: "sage" });
assert.equal(a.vote, "down");
assert.equal(a.familiarId, "sage");
const b = await fb.recordMessageFeedback({ messageId: "m2", vote: "up", cleared: true });
assert.equal(b.cleared, true, "toggle-off is recorded");
assert.equal(b.familiarId, undefined, "no familiarId unless supplied");
assert.equal(b.model, undefined, "no model unless supplied");
assert.equal(b.runtime, undefined, "no runtime unless supplied");

const all = await fb.loadMessageFeedback();
assert.equal(all.length, 2, "both entries persisted");
assert.equal(all[0].messageId, "m1");
assert.equal(all[1].messageId, "m2");

assert.equal(await fb.recordMessageFeedback({ messageId: "m3" }), null, "invalid input is not recorded");

const HUGE_BUCKET_COUNT = 3000;
const hugeEntries = Array.from({ length: HUGE_BUCKET_COUNT }, (_, index) => {
  const label = String(HUGE_BUCKET_COUNT - index - 1).padStart(4, "0");
  return {
    messageId: `sage-${label}`,
    vote: index % 3 === 0 ? "down" : "up",
    cleared: false,
    familiarId: "sage",
    model: `model-${label}`,
    runtime: `runtime-${label}`,
    at: `2026-08-07T20:${String(index % 60).padStart(2, "0")}:00.000Z`,
  };
});
await mkdir(path.dirname(fb.MESSAGE_FEEDBACK_PATH), { recursive: true });
await writeFile(
  fb.MESSAGE_FEEDBACK_PATH,
  JSON.stringify({ entries: hugeEntries }, null, 2),
  "utf8",
);

const rollup = await fb.loadMessageFeedbackRollup({
  familiarId: "sage",
  bucketLimit: FAMILIAR_DASHBOARD_LIMITS.feedbackBuckets,
});
assert.equal(rollup.total, HUGE_BUCKET_COUNT, "overall totals stay uncapped");
assert.equal(rollup.up, HUGE_BUCKET_COUNT - Math.ceil(HUGE_BUCKET_COUNT / 3));
assert.equal(rollup.down, Math.ceil(HUGE_BUCKET_COUNT / 3));
assert.equal(rollup.models.length, FAMILIAR_DASHBOARD_LIMITS.feedbackBuckets);
assert.equal(rollup.runtimes.length, FAMILIAR_DASHBOARD_LIMITS.feedbackBuckets);
assert.deepEqual(
  rollup.models.slice(0, 3).map((slice) => slice.key),
  ["model-0000", "model-0001", "model-0002"],
  "equal-count model buckets sort by stable key before truncation",
);
assert.deepEqual(
  rollup.runtimes.slice(0, 3).map((slice) => slice.key),
  ["runtime-0000", "runtime-0001", "runtime-0002"],
  "equal-count runtime buckets sort by stable key before truncation",
);

await writeFile(
  fb.MESSAGE_FEEDBACK_PATH,
  JSON.stringify({ entries: hugeEntries }),
  "utf8",
);
const compactRollup = await fb.loadMessageFeedbackRollup({
  familiarId: "sage",
  bucketLimit: 2,
});
assert.equal(compactRollup.total, HUGE_BUCKET_COUNT, "compact valid JSON still rolls up correctly");
assert.deepEqual(
  compactRollup.models.map((slice) => slice.key),
  ["model-0000", "model-0001"],
  "compact fallback preserves bounded stable ordering",
);
assert.deepEqual(
  compactRollup.runtimes.map((slice) => slice.key),
  ["runtime-0000", "runtime-0001"],
  "compact fallback preserves bounded runtime ordering",
);

await writeFile(fb.MESSAGE_FEEDBACK_PATH, "{\n  \"entries\": [\n    {\n", "utf8");
assert.deepEqual(
  await fb.loadMessageFeedback(),
  [],
  "legacy loader preserves malformed-store empty degradation",
);
await assert.rejects(
  fb.loadMessageFeedbackRollup({ familiarId: "sage" }),
  /invalid message feedback store: unterminated feedback entry/,
  "bounded rollup surfaces malformed-file errors instead of silently degrading",
);

await rm(scratchRoot, { recursive: true, force: true });
console.log("message-feedback-store.test.ts OK");

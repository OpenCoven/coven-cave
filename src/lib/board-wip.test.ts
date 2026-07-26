// @ts-nocheck
import assert from "node:assert/strict";
import { setWipLimit, wipState } from "./board-wip.ts";

// ── setWipLimit: set, update, clear, and purity ──
{
  let limits = {};
  limits = setWipLimit(limits, "running", 5);
  assert.deepEqual(limits, { running: 5 }, "sets a limit");
  limits = setWipLimit(limits, "review", 3);
  assert.deepEqual(limits, { running: 5, review: 3 }, "second status appends");
  limits = setWipLimit(limits, "running", 8);
  assert.equal(limits.running, 8, "updates an existing limit");
  // floor non-integers
  limits = setWipLimit(limits, "running", 4.7);
  assert.equal(limits.running, 4, "floors non-integer limits");
  // clear via null / 0 / negative
  for (const bad of [null, 0, -2]) {
    const out = setWipLimit({ running: 5 }, "running", bad);
    assert.deepEqual(out, {}, `clears the limit for ${bad}`);
  }
}
{
  const input = { running: 5 };
  const copy = { ...input };
  setWipLimit(input, "review", 2);
  assert.deepEqual(input, copy, "does not mutate the input");
}

// ── wipState ──
{
  assert.equal(wipState(3, undefined), "none", "no limit → none");
  assert.equal(wipState(3, 5), "ok", "under limit → ok");
  assert.equal(wipState(5, 5), "ok", "at limit → ok (not over)");
  assert.equal(wipState(6, 5), "over", "above limit → over");
}

console.log("board-wip.test.ts: ok");

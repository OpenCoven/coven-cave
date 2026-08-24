import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_TOAST_MS } from "./use-review-toast.ts";

// The hook itself needs React to run, so what is unit-testable here is the
// dwell contract the surface depends on. The behavioural half — that a verdict
// raises a visible confirmation — is pinned in the Playwright spec, which is
// the only place that can see whether a sighted reviewer got anything.

test("the confirmation dwell matches the frame's own 2.6s", () => {
  assert.equal(REVIEW_TOAST_MS, 2_600);
});

test("the dwell is long enough to read a verdict sentence and short enough to not linger", () => {
  // A verdict line is ~40-60 characters ("Requested changes on owner/repo#123").
  // Below ~2s that is unreadable; past ~5s it outlives the action it confirms
  // and starts overlapping the next one.
  assert.ok(REVIEW_TOAST_MS >= 2_000, "too short to read");
  assert.ok(REVIEW_TOAST_MS <= 5_000, "long enough to overlap the next verdict");
});

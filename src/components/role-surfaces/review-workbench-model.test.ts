import assert from "node:assert/strict";
import test from "node:test";

import {
  groupReviewQueue,
  nextReviewItemId,
  resolveReviewShortcut,
  reviewActionsAvailable,
} from "./review-workbench-model.ts";

test("attention groups keep the fixed needs-changes-blocked-ready order", () => {
  const items = [
    { id: "ready", bucket: "ready" as const },
    { id: "needs", bucket: "awaiting" as const },
    { id: "blocked", bucket: "blocked" as const },
    { id: "changes", bucket: "changes" as const },
  ];
  const groups = groupReviewQueue(items, (item) => item.bucket);
  assert.deepEqual(
    groups.map((group) => [group.label, group.items[0].id]),
    [
      ["Needs review", "needs"],
      ["Changes requested", "changes"],
      ["Blocked", "blocked"],
      ["Ready", "ready"],
    ],
  );
});

test("review shortcuts ignore typing and preserve the bracket item controls", () => {
  assert.equal(
    resolveReviewShortcut({ key: "j", editable: false }),
    "next-file",
  );
  assert.equal(
    resolveReviewShortcut({ key: "[", editable: false }),
    "previous-item",
  );
  assert.equal(
    resolveReviewShortcut({ key: "?", editable: false }),
    "show-help",
  );
  assert.equal(resolveReviewShortcut({ key: "r", editable: true }), null);
  assert.equal(
    resolveReviewShortcut({ key: "e", editable: false, composing: true }),
    null,
  );
  assert.equal(
    resolveReviewShortcut({ key: "f", editable: false, metaKey: true }),
    null,
  );
});

test("review item movement wraps without losing the current queue", () => {
  const ids = ["a", "b", "c"];
  assert.equal(nextReviewItemId(ids, "c", 1), "a");
  assert.equal(nextReviewItemId(ids, "a", -1), "c");
  assert.equal(nextReviewItemId([], null, 1), null);
});

test("review actions fail closed until the selected PR is known open and ready", () => {
  assert.equal(
    reviewActionsAvailable({
      sourceKind: "pull-request",
      readinessPhase: "ready",
      state: "open",
      draft: false,
    }),
    true,
  );
  for (const patch of [
    { sourceKind: "local" as const },
    { readinessPhase: "loading" as const },
    { state: null },
    { draft: true },
  ]) {
    assert.equal(
      reviewActionsAvailable({
        sourceKind: "pull-request",
        readinessPhase: "ready",
        state: "open",
        draft: false,
        ...patch,
      }),
      false,
    );
  }
});

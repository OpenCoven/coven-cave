import assert from "node:assert/strict";
import test from "node:test";

import {
  nextUnreadReviewPath,
  parseReviewProgress,
  reviewProofState,
  serializeReviewProgress,
} from "./review-progress.ts";

test("progress is scoped to the exact review revision", () => {
  const stored = serializeReviewProgress(
    "head-a",
    new Set(["a.ts", "gone.ts"]),
  );
  assert.deepEqual(
    [...parseReviewProgress(stored, "head-a", ["a.ts", "b.ts"])],
    ["a.ts"],
  );
  assert.deepEqual(
    [...parseReviewProgress(stored, "head-b", ["a.ts", "b.ts"])],
    [],
  );
});

test("next unread wraps around the changed-file order", () => {
  const paths = ["a.ts", "b.ts", "c.ts"];
  const reviewed = new Set(["a.ts"]);
  assert.equal(nextUnreadReviewPath(paths, reviewed, "b.ts", 1), "c.ts");
  assert.equal(nextUnreadReviewPath(paths, reviewed, "c.ts", 1), "b.ts");
  assert.equal(nextUnreadReviewPath(paths, reviewed, "b.ts", -1), "c.ts");
  assert.equal(
    nextUnreadReviewPath(paths, new Set(paths), "b.ts", 1),
    null,
  );
});

test("proof states keep current, comments, review, and unavailable distinct", () => {
  const reviewed = new Set(["reviewed.ts"]);
  assert.equal(
    reviewProofState({
      path: "open.ts",
      currentPath: "open.ts",
      reviewed,
      unavailable: false,
      commentCount: 0,
    }),
    "reading",
  );
  assert.equal(
    reviewProofState({
      path: "reviewed.ts",
      currentPath: null,
      reviewed,
      unavailable: false,
      commentCount: 0,
    }),
    "reviewed",
  );
  assert.equal(
    reviewProofState({
      path: "commented.ts",
      currentPath: null,
      reviewed,
      unavailable: false,
      commentCount: 2,
    }),
    "commented",
  );
  assert.equal(
    reviewProofState({
      path: "binary.png",
      currentPath: null,
      reviewed,
      unavailable: true,
      commentCount: 0,
    }),
    "unavailable",
  );
});

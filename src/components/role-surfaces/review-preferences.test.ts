import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REVIEW_DIFF_PREFERENCES,
  parseReviewDiffPreferences,
} from "./review-preferences.ts";

test("diff preferences stay unified and reject unsupported context sizes", () => {
  assert.deepEqual(
    parseReviewDiffPreferences({
      mode: "split",
      hideWhitespace: true,
      contextLines: 42,
    }),
    {
      mode: "unified",
      hideWhitespace: true,
      contextLines: 5,
      wrapLines: false,
    },
  );
  assert.deepEqual(
    parseReviewDiffPreferences(null),
    DEFAULT_REVIEW_DIFF_PREFERENCES,
  );
});

test("long-line wrapping is opt-in and survives saved preferences", () => {
  assert.equal(parseReviewDiffPreferences({ wrapLines: true }).wrapLines, true);
  assert.equal(parseReviewDiffPreferences({ wrapLines: "true" }).wrapLines, false);
  assert.equal(parseReviewDiffPreferences({ contextLines: 10 }).wrapLines, false);
});

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
    },
  );
  assert.deepEqual(
    parseReviewDiffPreferences(null),
    DEFAULT_REVIEW_DIFF_PREFERENCES,
  );
});

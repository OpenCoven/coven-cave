// #5930: GitHub rejects APPROVE and REQUEST_CHANGES from a pull request's
// author. One module decides which review verbs every surface offers.
import assert from "node:assert/strict";
import test from "node:test";

import {
  OWN_PR_REVIEW_NOTE,
  isPullRequestAuthor,
  reviewEventsFor,
} from "./own-pr-review.ts";

test("the author of a pull request can only comment", () => {
  assert.deepEqual(reviewEventsFor(true), ["COMMENT"]);
});

test("anyone else, or an unknown viewer, keeps every verb", () => {
  assert.deepEqual(reviewEventsFor(false), ["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
  assert.deepEqual(reviewEventsFor(null), ["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
  assert.deepEqual(reviewEventsFor(undefined), ["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
});

test("logins compare case-insensitively, and unknown is never the author", () => {
  assert.equal(isPullRequestAuthor("BunsDev", "bunsdev"), true);
  assert.equal(isPullRequestAuthor("someone", "BunsDev"), false);
  assert.equal(isPullRequestAuthor(null, "BunsDev"), null);
  assert.equal(isPullRequestAuthor("BunsDev", ""), null);
});

test("the explanation is one line that says why", () => {
  assert.doesNotMatch(OWN_PR_REVIEW_NOTE, /\n/);
  assert.match(OWN_PR_REVIEW_NOTE, /approve or request changes/);
  assert.match(OWN_PR_REVIEW_NOTE, /only comment/);
});

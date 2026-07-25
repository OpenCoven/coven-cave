import assert from "node:assert/strict";
import { test } from "node:test";

import { isCurrentProjectScope, projectScopeKey } from "./project-scope.ts";

test("a completed project response becomes unavailable immediately when familiar scope changes", () => {
  const globalResult = projectScopeKey(null);
  const familiarAResult = projectScopeKey("familiar-a");

  assert.equal(isCurrentProjectScope(globalResult, null), true, "the unscoped result is usable for an unscoped picker");
  assert.equal(isCurrentProjectScope(globalResult, "familiar-a"), false, "a familiar must not see the retained global result");
  assert.equal(isCurrentProjectScope(familiarAResult, "familiar-a"), true, "the matching familiar may use its completed result");
  assert.equal(isCurrentProjectScope(familiarAResult, "familiar-b"), false, "a second familiar must not see familiar A's retained result");
});

test("pending or failed scoped loads never become ready", () => {
  assert.equal(isCurrentProjectScope(null, "familiar-a"), false, "a pending scope has no successful result");
  assert.equal(isCurrentProjectScope(null, null), false, "a failed unscoped request has no successful result");
});

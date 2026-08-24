import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasCommitRequiresDefaultBranch,
  exactBranchPushRef,
  remoteBranchMatchesExpectedHead,
} from "./canvas-git-delivery.ts";

test("Canvas refuses to append its commit to an existing feature branch", () => {
  assert.equal(canvasCommitRequiresDefaultBranch("feature/other-work", "main", true), true);
  assert.equal(canvasCommitRequiresDefaultBranch("main", "main", true), false);
  assert.equal(canvasCommitRequiresDefaultBranch("feature/other-work", "main", false), false);
});

test("the push source is an immutable commit rather than the mutable local branch", () => {
  const head = "a".repeat(40);
  assert.equal(exactBranchPushRef("cave/update-sketch", head), `${head}:refs/heads/cave/update-sketch`);
});

test("remote verification rejects an empty or concurrently moved branch", () => {
  const expected = "a".repeat(40);
  assert.equal(remoteBranchMatchesExpectedHead(`${expected}\trefs/heads/cave/update-sketch\n`, expected), true);
  assert.equal(remoteBranchMatchesExpectedHead(`${"b".repeat(40)}\trefs/heads/cave/update-sketch\n`, expected), false);
  assert.equal(remoteBranchMatchesExpectedHead("", expected), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { assessWorktreeRecordClearance } from "./worktree-record-clearance.ts";

const OWNER = "Val Alexander";
const REASON = "worktree hand-retired after PR #4489 merged";

function assess(overrides: Partial<Parameters<typeof assessWorktreeRecordClearance>[0]> = {}) {
  return assessWorktreeRecordClearance({
    record: { path: "/repo/.worktrees/gone", branch: "fix/gone", disposition: "active" },
    registeredPaths: ["/repo", "/repo/.worktrees/live"],
    pathExistsOnDisk: false,
    owner: OWNER,
    reason: REASON,
    ...overrides,
  });
}

test("a record whose worktree is gone from git and disk may be cleared", () => {
  const result = assess();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.clearedPath, "/repo/.worktrees/gone");
});

test("a record whose worktree git still registers is never cleared", () => {
  // The failure that matters: clearing this would strand a live unit outside
  // the lifecycle system, where no patrol would ever assess it again.
  const result = assess({
    record: { path: "/repo/.worktrees/live", branch: "fix/live", disposition: "active" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "worktree-still-registered");
    assert.match(result.diagnostic, /strand a live unit/);
  }
});

test("a path git forgot but that still exists on disk is refused, not cleared", () => {
  // Unregistered but present means an unmanaged fallback worktree or debris.
  // The record is the only remaining pointer to it, so removing the record
  // would hide it rather than resolve it.
  const result = assess({ pathExistsOnDisk: true });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "path-still-present");
    assert.match(result.diagnostic, /only remaining pointer/);
  }
});

test("trailing separators do not smuggle a live worktree past the check", () => {
  // A record written with a trailing slash must still match git's registration,
  // or the safety check becomes a formatting coincidence.
  const result = assess({
    record: { path: "/repo/.worktrees/live/", branch: "fix/live", disposition: "active" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "worktree-still-registered");

  const reversed = assess({
    record: { path: "/repo/.worktrees/live", branch: "fix/live", disposition: "active" },
    registeredPaths: ["/repo/.worktrees/live/"],
  });
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.equal(reversed.code, "worktree-still-registered");
});

test("a bead with no record has nothing to clear", () => {
  const result = assess({ record: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "no-record");
});

test("a record naming no usable path is repaired deliberately, never cleared blindly", () => {
  for (const path of [undefined, null, "", "   ", 42, {}]) {
    const result = assess({ record: { path, branch: "fix/x", disposition: "active" } as never });
    assert.equal(result.ok, false, `path ${JSON.stringify(path)} must not be clearable`);
    if (!result.ok) assert.equal(result.code, "malformed-record");
  }
});

test("clearance is refused without an owner and a reason", () => {
  // An unattributed clearance is indistinguishable from the forging the
  // worktree rules exist to prevent, so attribution is a precondition rather
  // than a log line written afterwards.
  for (const overrides of [
    { owner: "" },
    { owner: "   " },
    { reason: "" },
    { reason: "  " },
    { owner: "", reason: "" },
  ]) {
    const result = assess(overrides);
    assert.equal(result.ok, false, `${JSON.stringify(overrides)} must not be clearable`);
    if (!result.ok) assert.equal(result.code, "unattributed");
  }
});

test("attribution is checked before anything else, so a bad request cannot probe state", () => {
  // Ordering matters: an unattributed caller should not learn whether a path is
  // registered by reading which refusal comes back.
  const result = assess({
    owner: "",
    record: { path: "/repo/.worktrees/live", branch: "fix/live", disposition: "active" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unattributed");
});

test("the disposition of a dead record does not change the verdict", () => {
  // A record is cleared because its worktree is gone, not because of what the
  // record claims about itself — otherwise a wrong disposition would protect a
  // dead record forever.
  for (const disposition of ["active", "pr", "recovery", "archive", "nonsense"]) {
    const result = assess({
      record: { path: "/repo/.worktrees/gone", branch: "fix/gone", disposition },
    });
    assert.equal(result.ok, true, `disposition ${disposition} must not block clearance`);
  }
});

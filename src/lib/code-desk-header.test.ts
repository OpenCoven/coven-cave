import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeDeskIdentity,
  codeDeskPrState,
  codeDeskReviewProgress,
} from "./code-desk-header.ts";
import type { SessionRow } from "./types.ts";

const row = (over: Partial<SessionRow>): SessionRow =>
  ({
    id: "s1",
    title: "Wire the flux capacitor",
    status: "running",
    project_root: "/repo/alpha",
    created_at: "2026-06-12T10:00:00.000Z",
    updated_at: "2026-06-12T12:00:00.000Z",
    exit_code: null,
    ...over,
  }) as SessionRow;

test("PR state folds draft in as its own word and lets merged/closed win over draft", () => {
  assert.equal(codeDeskPrState(null), "unknown");
  assert.equal(codeDeskPrState({ state: "open" }), "open");
  assert.equal(codeDeskPrState({ state: "OPEN", draft: true }), "draft");
  assert.equal(codeDeskPrState({ state: "merged", draft: true }), "merged");
  assert.equal(codeDeskPrState({ state: "closed" }), "closed");
  assert.equal(codeDeskPrState({ state: "weird" }), "unknown");
});

test("identity carries every state as a word beside its tone", () => {
  const identity = codeDeskIdentity(
    row({
      git: { branch: "feat/flux", isWorktree: true } as SessionRow["git"],
      pullRequest: { repo: "acme/alpha", number: 7, url: "https://github.com/acme/alpha/pull/7", state: "open" },
      diff: { additions: 12, deletions: 3 },
    }),
  );
  assert.deepEqual(identity.activity, { kind: "running", word: "running", tone: "success" });
  assert.deepEqual(identity.branch, { name: "feat/flux", worktree: true });
  assert.deepEqual(identity.pr, {
    label: "#7",
    state: "open",
    tone: "success",
    url: "https://github.com/acme/alpha/pull/7",
  });
  assert.deepEqual(identity.diff, { additions: 12, deletions: 3 });
});

test("a failed exit reads as failed, a clean idle session prints no diffstat and no PR", () => {
  const identity = codeDeskIdentity(row({ status: "idle", exit_code: 2, diff: { additions: 0, deletions: 0 } }));
  assert.equal(identity.activity.word, "failed");
  assert.equal(identity.activity.tone, "danger");
  assert.equal(identity.branch, null);
  assert.equal(identity.pr, null);
  assert.equal(identity.diff, null);
});

test("the live worktree summary outranks the session list's diffstat once it has loaded", () => {
  const listed = row({ diff: { additions: 12, deletions: 3 } });
  assert.deepEqual(codeDeskIdentity(listed).diff, { additions: 12, deletions: 3 }, "no live summary: the list's figure");
  const files = [{}, {}];
  assert.deepEqual(
    codeDeskIdentity(listed, { additions: 17, deletions: 3, loaded: false, files }).diff,
    { additions: 12, deletions: 3 },
    "a summary still loading does not blank or replace the figure",
  );
  assert.deepEqual(codeDeskIdentity(listed, { additions: 17, deletions: 3, loaded: true, files }).diff, { additions: 17, deletions: 3 });
  assert.equal(
    codeDeskIdentity(listed, { additions: 0, deletions: 0, loaded: true, files: [] }).diff,
    null,
    "a clean worktree prints no diffstat even if the list still remembers one",
  );
  assert.deepEqual(
    codeDeskIdentity(listed, { additions: 0, deletions: 0, loaded: true, files }).diff,
    { additions: 12, deletions: 3 },
    "files without line counts keep the list's figure rather than print +0 −0",
  );
});

test("review progress is null with nothing to review and never exceeds the total", () => {
  assert.equal(codeDeskReviewProgress(0, 0), null);
  assert.equal(codeDeskReviewProgress(2, 5), "2 of 5 viewed");
  assert.equal(codeDeskReviewProgress(9, 5), "5 of 5 viewed");
});

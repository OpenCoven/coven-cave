// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionPrStatus } from "./session-pr-status.ts";

test("no PR context → no badge", () => {
  assert.equal(sessionPrStatus(null), null);
  assert.equal(sessionPrStatus(undefined), null);
});

test("PR without url or repo#number is unlinkable → no badge", () => {
  assert.equal(sessionPrStatus({ repo: "o/r", state: "open" }), null);
});

test("open PR → open key, pull-request icon, PR url", () => {
  const s = sessionPrStatus({
    repo: "OpenCoven/coven-cave",
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "open",
  });
  assert.equal(s.key, "open");
  assert.equal(s.icon, "ph:git-pull-request");
  assert.equal(s.label, "PR #42 · open");
  assert.equal(s.url, "https://github.com/OpenCoven/coven-cave/pull/42");
});

test("merged PR → merged key with the git-merge icon", () => {
  const s = sessionPrStatus({ repo: "o/r", number: 7, state: "merged" });
  assert.equal(s.key, "merged");
  assert.equal(s.icon, "ph:git-merge");
});

test("state matching is case-insensitive (gh emits MERGED/CLOSED)", () => {
  assert.equal(sessionPrStatus({ repo: "o/r", number: 1, state: "MERGED" }).key, "merged");
  assert.equal(sessionPrStatus({ repo: "o/r", number: 1, state: "CLOSED" }).key, "closed");
});

test("draft flag wins over open", () => {
  assert.equal(
    sessionPrStatus({ repo: "o/r", number: 1, state: "open", draft: true }).key,
    "draft",
  );
});

test("merged beats draft (a merged PR is done, not draft)", () => {
  assert.equal(
    sessionPrStatus({ repo: "o/r", number: 1, state: "merged", draft: true }).key,
    "merged",
  );
});

test("GitHub-task lifecycle words still read as an open PR", () => {
  for (const state of ["running", "review", "done", "failed"]) {
    assert.equal(sessionPrStatus({ repo: "o/r", number: 3, state }).key, "open");
  }
});

test("url falls back to the canonical github.com PR link", () => {
  const s = sessionPrStatus({ repo: "o/r", number: 9, state: "open" });
  assert.equal(s.url, "https://github.com/o/r/pull/9");
});

// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergedChatAutoArchiveDecisions,
  mergedPrKey,
} from "./merged-chat-auto-archive.ts";

const row = (over = {}) => ({
  id: "s1",
  status: "completed",
  archived_at: null,
  pullRequest: {
    repo: "OpenCoven/coven-cave",
    number: 42,
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    state: "merged",
  },
  ...over,
});

test("merged PR on an idle unarchived chat → archive decision", () => {
  const decisions = mergedChatAutoArchiveDecisions([row()], {});
  assert.deepEqual(decisions, [
    { sessionId: "s1", prKey: "OpenCoven/coven-cave#42" },
  ]);
});

test("non-merged states never archive (including task lifecycle words)", () => {
  for (const state of ["open", "closed", "draft", "running", "review", "done", "failed"]) {
    const decisions = mergedChatAutoArchiveDecisions(
      [row({ pullRequest: { ...row().pullRequest, state } })],
      {},
    );
    assert.equal(decisions.length, 0, `state=${state} must not archive`);
  }
});

test("MERGED (gh casing) matches", () => {
  const decisions = mergedChatAutoArchiveDecisions(
    [row({ pullRequest: { ...row().pullRequest, state: "MERGED" } })],
    {},
  );
  assert.equal(decisions.length, 1);
});

test("sessions that may still be working are never swept", () => {
  for (const status of ["running", "starting", "working", "queued", "streaming", "waiting"]) {
    assert.equal(
      mergedChatAutoArchiveDecisions([row({ status })], {}).length,
      0,
      `status=${status} must not archive`,
    );
  }
});

test("already-archived rows are skipped", () => {
  assert.equal(
    mergedChatAutoArchiveDecisions([row({ archived_at: "2026-07-01T00:00:00Z" })], {}).length,
    0,
  );
});

test("one-shot: a session already auto-archived for this PR is not re-archived", () => {
  const handled = { s1: "OpenCoven/coven-cave#42" };
  assert.equal(mergedChatAutoArchiveDecisions([row()], handled).length, 0);
});

test("a NEW merged PR re-arms the sweep for the same session", () => {
  const handled = { s1: "OpenCoven/coven-cave#41" };
  const decisions = mergedChatAutoArchiveDecisions([row()], handled);
  assert.equal(decisions.length, 1);
});

test("rows without PR context are skipped", () => {
  assert.equal(mergedChatAutoArchiveDecisions([row({ pullRequest: null })], {}).length, 0);
  assert.equal(mergedChatAutoArchiveDecisions([row({ pullRequest: undefined })], {}).length, 0);
});

test("mergedPrKey prefers repo#number, falls back to url, else null", () => {
  assert.equal(mergedPrKey({ repo: "o/r", number: 5 }), "o/r#5");
  assert.equal(mergedPrKey({ repo: "o/r", url: "https://github.com/o/r/pull/5" }), "https://github.com/o/r/pull/5");
  assert.equal(mergedPrKey({ repo: "o/r" }), null);
});

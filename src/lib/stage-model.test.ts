// Behavioral tests for the shared stage model (cave-fpqx.10, design
// docs/chat-github-integration.md §4) — the bead↔PR↔branch join both the
// Familiar Work Queue and the chat stage header read.
import assert from "node:assert/strict";
import test from "node:test";
import { beadIdsInBranch, resolveQueueLane, resolveStageForBranch } from "./stage-model.ts";
import type { PullRequestSummary } from "./beads-pr-management.ts";
import type { MergedPrRef, ReadyBead } from "./beads-work-queue.ts";

function pr(overrides: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    number: 7,
    title: "feat: thing",
    url: "https://github.com/o/r/pull/7",
    lane: "needs-review",
    beadIds: [],
    checkStatus: "passing",
    reviewDecision: "",
    mergeStateStatus: "CLEAN",
    headRefName: "feat/thing",
    updatedAt: "2026-07-14T00:00:00Z",
    ...overrides,
  };
}

function bead(overrides: Partial<ReadyBead>): ReadyBead {
  return { id: "cave-ab12", title: "a bead", priority: 1, status: "in_progress", ...overrides };
}

const step = (snap: NonNullable<ReturnType<typeof resolveStageForBranch>>, key: string) => {
  const s = snap.steps.find((x) => x.key === key);
  assert.ok(s, `step ${key} present`);
  return s;
};

// ── resolveQueueLane: parity with the queue's historical mapping ─────────────

test("resolveQueueLane maps bridge lanes exactly as the queue always did", () => {
  assert.equal(resolveQueueLane("checks-failing"), "checks-failing");
  assert.equal(resolveQueueLane("changes-requested"), "changes-requested");
  assert.equal(resolveQueueLane("needs-review"), "needs-review");
  assert.equal(resolveQueueLane("ready-to-merge"), "ready-to-merge");
  for (const waiting of ["draft", "checks-pending", "blocked"] as const) {
    assert.equal(resolveQueueLane(waiting), "waiting", waiting);
  }
});

// ── beadIdsInBranch ──────────────────────────────────────────────────────────

test("beadIdsInBranch finds bead ids in branch names, lowercased", () => {
  assert.deepEqual(beadIdsInBranch("feat/foo-cave-AB12"), ["cave-ab12"]);
  assert.deepEqual(beadIdsInBranch("fix/cave-x9.2-followup"), ["cave-x9.2"]);
  assert.deepEqual(beadIdsInBranch("feat/no-bead-here"), []);
});

// ── resolveStageForBranch ────────────────────────────────────────────────────

test("returns null when nothing anchors a stage (plain chat stays clean)", () => {
  assert.equal(resolveStageForBranch({ branch: "main", open: [], merged: [], beads: [] }), null);
  assert.equal(resolveStageForBranch({ branch: null, open: [pr({})], merged: [], beads: [] }), null);
});

test("open PR: checks failing → failed step; lane surfaces", () => {
  const snap = resolveStageForBranch({
    branch: "feat/thing",
    open: [pr({ lane: "checks-failing", checkStatus: "failing", beadIds: ["cave-ab12"] })],
    merged: [],
    beads: [bead({})],
  });
  assert.ok(snap);
  assert.equal(snap.lane, "checks-failing");
  assert.equal(step(snap, "bead").state, "active"); // in_progress bead
  assert.equal(step(snap, "pr").state, "done");
  assert.equal(step(snap, "checks").state, "failed");
  assert.equal(step(snap, "merged").state, "pending");
});

test("open PR: approved + ready-to-merge → review done, merged active", () => {
  const snap = resolveStageForBranch({
    branch: "feat/thing",
    open: [pr({ lane: "ready-to-merge", checkStatus: "passing", reviewDecision: "APPROVED" })],
    merged: [],
    beads: [],
  });
  assert.ok(snap);
  assert.equal(step(snap, "checks").state, "done");
  assert.equal(step(snap, "review").state, "done");
  assert.equal(step(snap, "merged").state, "active");
  assert.equal(step(snap, "bead").state, "none");
});

test("merged PR resolves by headRefName; steps read done", () => {
  const merged: MergedPrRef = {
    number: 9,
    title: "done thing",
    url: "https://github.com/o/r/pull/9",
    beadIds: ["cave-zz99"],
    mergedAt: "2026-07-14T12:00:00Z",
    headRefName: "feat/done-thing",
  };
  const snap = resolveStageForBranch({ branch: "feat/done-thing", open: [], merged: [merged], beads: [] });
  assert.ok(snap);
  assert.equal(snap.lane, "merged");
  assert.equal(step(snap, "pr").state, "done");
  assert.equal(step(snap, "checks").state, "done");
  assert.equal(step(snap, "merged").state, "done");
});

test("bead-only stage (branch carries the bead id, no PR yet)", () => {
  const snap = resolveStageForBranch({
    branch: "feat/foo-cave-ab12",
    open: [],
    merged: [],
    beads: [bead({ status: "open" })],
  });
  assert.ok(snap);
  assert.equal(snap.lane, null);
  assert.equal(step(snap, "bead").state, "done"); // claimed/open bead shown settled
  assert.equal(step(snap, "pr").state, "active"); // "no PR" is the active edge
  assert.equal(step(snap, "merged").state, "pending");
});

test("changes-requested review reads failed", () => {
  const snap = resolveStageForBranch({
    branch: "feat/thing",
    open: [pr({ lane: "changes-requested", reviewDecision: "CHANGES_REQUESTED" })],
    merged: [],
    beads: [],
  });
  assert.ok(snap);
  assert.equal(step(snap, "review").state, "failed");
});

test("reused branch: an open PR suppresses the old merged ref (no contradictory pipeline)", () => {
  const merged: MergedPrRef = {
    number: 100,
    title: "old shipped thing",
    url: "https://github.com/o/r/pull/100",
    beadIds: [],
    mergedAt: "2026-07-14T12:00:00Z",
    headRefName: "feat/x",
  };
  const snap = resolveStageForBranch({
    branch: "feat/x",
    open: [pr({ number: 105, headRefName: "feat/x", lane: "needs-review", checkStatus: "pending" })],
    merged: [merged],
    beads: [],
  });
  assert.ok(snap);
  assert.equal(snap.lane, "needs-review");
  assert.equal(snap.mergedRef, null, "old merged PR must not leak into an open-PR stage");
  assert.equal(step(snap, "merged").state, "pending");
  assert.ok(!step(snap, "merged").detail.startsWith("Merged"), "no 'Merged <date>' beside active checks");
});

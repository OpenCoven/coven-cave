// @ts-nocheck
// Familiar Work Queue model (cave-hlv.4) — the pure bead↔PR join: lane mapping,
// per-familiar/per-surface labelling, stale + unlinked flags, no-open-PR and
// post-merge-cleanup derivation. Clock injected for determinism.
import assert from "node:assert/strict";

const { buildWorkQueue, isActionableLane, laneTitle, hasVerificationEvidence } = await import(
  "./beads-work-queue.ts"
);

const NOW = Date.parse("2026-07-07T12:00:00Z");
const HOURS = 3_600_000;

function pr(number, lane, { beads = [], updatedAgoHours = 1 } = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/OpenCoven/coven-cave/pull/${number}`,
    lane,
    beadIds: beads,
    checkStatus: lane === "checks-failing" ? "failing" : "passing",
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    headRefName: `feat/pr-${number}`,
    updatedAt: new Date(NOW - updatedAgoHours * HOURS).toISOString(),
  };
}

function bead(id, { priority = 2, labels = [], type = "feature", assignee = null } = {}) {
  return { id, title: `Bead ${id}`, priority, status: "open", assignee, issue_type: type, labels, updated_at: null };
}

// ── Open PRs map to lanes and join to their bead for familiar/surface ─────────
{
  const beads = [bead("cave-aa1", { labels: ["familiar:kitty", "surface:github"] })];
  const prs = [
    pr(1, "checks-failing", { beads: ["cave-aa1"] }),
    pr(2, "ready-to-merge", { beads: ["cave-bb2"] }),
    pr(3, "needs-review", { beads: [] }),
    pr(4, "draft", { beads: [] }),
    pr(5, "changes-requested", { beads: ["cave-aa1"] }),
    pr(6, "checks-pending", { beads: [] }),
    pr(7, "blocked", { beads: [] }),
  ];
  const q = buildWorkQueue(beads, prs, [], { nowMs: NOW });
  const laneOf = Object.fromEntries(q.lanes.map((l) => [l.key, l.items.map((i) => i.key)]));
  assert.deepEqual(laneOf["checks-failing"], ["pr:1"], "failing PR in its lane");
  assert.deepEqual(laneOf["changes-requested"], ["pr:5"]);
  assert.deepEqual(laneOf["needs-review"], ["pr:3"]);
  assert.deepEqual(laneOf["ready-to-merge"], ["pr:2"]);
  assert.deepEqual(laneOf.waiting, ["pr:4", "pr:6", "pr:7"], "draft/pending/blocked fold into waiting");

  const failing = q.lanes.find((l) => l.key === "checks-failing").items[0];
  assert.equal(failing.familiar, "kitty", "PR joined to bead's familiar label");
  assert.equal(failing.surface, "github", "PR joined to bead's surface label");

  const review = q.lanes.find((l) => l.key === "needs-review").items[0];
  assert.equal(review.familiar, "unassigned", "bead-less PR is unassigned");
  assert.equal(review.surface, null);

  assert.deepEqual(q.unlinked, [3, 4, 6, 7], "bead-less open PRs are flagged unlinked");
  // waiting is not actionable; the four PR-action lanes are (2 with beads, but
  // count is by item: failing+changes+review+ready = 4).
  assert.equal(q.actionable, 4, "actionable excludes waiting");
}

// ── Lane ordering: fix-first → land → review → bead lanes → waiting ──────────
{
  const prs = [pr(1, "draft"), pr(2, "ready-to-merge"), pr(3, "checks-failing"), pr(4, "needs-review")];
  const q = buildWorkQueue([], prs, [], { nowMs: NOW });
  assert.deepEqual(
    q.lanes.map((l) => l.key),
    ["checks-failing", "needs-review", "ready-to-merge", "waiting"],
    "lanes render in fix→land→review→waiting order, empty lanes dropped",
  );
}

// ── no-open-PR: ready beads unreferenced by any open PR; epics excluded ──────
{
  const beads = [
    bead("cave-x1", { labels: ["familiar:nova", "surface:ios"] }),
    bead("cave-x2", { labels: ["familiar:kitty"] }), // has an open PR → not here
    bead("cave-epic", { type: "epic", labels: ["familiar:nova"] }), // container, excluded
  ];
  const prs = [pr(9, "needs-review", { beads: ["cave-x2"] })];
  const q = buildWorkQueue(beads, prs, [], { nowMs: NOW });
  const noPr = q.lanes.find((l) => l.key === "no-open-PR");
  assert.deepEqual(noPr.items.map((i) => i.bead.id), ["cave-x1"], "only the unreferenced non-epic bead");
  assert.equal(noPr.items[0].familiar, "nova");
  assert.equal(noPr.items[0].surface, "ios");
}

// ── post-merge-cleanup: merged PR whose bead is still open (in ready set) ────
{
  const beads = [bead("cave-open", { labels: ["familiar:kitty"] })];
  const merged = [
    { number: 50, title: "landed", url: "u/50", beadIds: ["cave-open"], mergedAt: "2026-07-07T00:00:00Z" },
    { number: 51, title: "landed+closed bead", url: "u/51", beadIds: ["cave-closed"], mergedAt: "x" },
    { number: 52, title: "no bead", url: "u/52", beadIds: [], mergedAt: "x" },
  ];
  const q = buildWorkQueue(beads, [], merged, { nowMs: NOW });
  const cleanup = q.lanes.find((l) => l.key === "post-merge-cleanup");
  assert.deepEqual(cleanup.items.map((i) => i.merged.number), [50], "only merged PRs whose bead is still open");
  assert.equal(cleanup.items[0].familiar, "kitty");
  assert.ok(isActionableLane("post-merge-cleanup"), "cleanup is actionable");
  // A bead awaiting cleanup must NOT also appear in no-open-PR (it HAS a PR —
  // it just merged). Otherwise it double-counts.
  assert.equal(q.lanes.find((l) => l.key === "no-open-PR"), undefined, "cleanup bead is not in no-open-PR");
  assert.equal(q.total, 1, "cave-open counted once, in cleanup only");
}

// ── Stale flag + rollup by familiar ──────────────────────────────────────────
{
  const beads = [
    bead("cave-k", { labels: ["familiar:kitty"] }),
    bead("cave-n", { labels: ["familiar:nova"] }),
  ];
  const prs = [
    pr(1, "checks-failing", { beads: ["cave-k"], updatedAgoHours: 40 }), // stale
    pr(2, "needs-review", { beads: ["cave-n"], updatedAgoHours: 2 }),
  ];
  const q = buildWorkQueue(beads, prs, [], { nowMs: NOW, staleAfterHours: 24 });
  assert.equal(q.stale, 1, "one stale PR at the 24h window");
  const failing = q.lanes.find((l) => l.key === "checks-failing").items[0];
  assert.equal(failing.stale, true, "the 40h PR is stale");

  const kitty = q.byFamiliar.find((r) => r.familiar === "kitty");
  const nova = q.byFamiliar.find((r) => r.familiar === "nova");
  assert.equal(kitty.actionable, 1);
  assert.equal(kitty.laneCounts["checks-failing"], 1);
  assert.equal(nova.laneCounts["needs-review"], 1);
  // Tie on actionable(1) → alphabetical: kitty before nova.
  assert.deepEqual(q.byFamiliar.map((r) => r.familiar), ["kitty", "nova"]);
}

// ── unassigned familiar always trails the rollup ─────────────────────────────
{
  const prs = [pr(1, "needs-review", { beads: [] }), pr(2, "checks-failing", { beads: [] })];
  const q = buildWorkQueue([], prs, [], { nowMs: NOW });
  assert.equal(q.byFamiliar.at(-1).familiar, "unassigned", "unassigned sorts last");
}

// ── falls back to assignee when no familiar: label ───────────────────────────
{
  const beads = [bead("cave-z", { labels: ["surface:daemon"], assignee: "Cody" })];
  const q = buildWorkQueue(beads, [], [], { nowMs: NOW });
  const item = q.lanes.find((l) => l.key === "no-open-PR").items[0];
  assert.equal(item.familiar, "cody", "assignee lowercased when no familiar: label");
  assert.equal(item.surface, "daemon");
}

assert.equal(laneTitle("ready-to-merge"), "Ready to merge");

// ── hasVerificationEvidence: a recorded comment gates Close (cave-hlv.2) ──────
assert.equal(hasVerificationEvidence({ ...bead("cave-a"), comment_count: 1 }), true, "one comment = evidence");
assert.equal(hasVerificationEvidence({ ...bead("cave-a"), comment_count: 3 }), true, "many comments = evidence");
assert.equal(hasVerificationEvidence({ ...bead("cave-a"), comment_count: 0 }), false, "zero comments = no evidence");
assert.equal(hasVerificationEvidence(bead("cave-a")), false, "absent comment_count = no evidence");
assert.equal(hasVerificationEvidence(undefined), false, "no bead = no evidence");
// notes alone (auto-populated planning text) must NOT count as evidence.
assert.equal(
  hasVerificationEvidence({ ...bead("cave-a"), notes: "some planning text", comment_count: 0 }),
  false,
  "notes without a comment are not verification evidence",
);

// ── Attention: unlinked and/or stale open PRs, with the PR summary (cave-x1j) ─
{
  const beads = [bead("cave-a", { labels: ["familiar:kitty"] })];
  const prs = [
    pr(1, "needs-review", { beads: ["cave-a"], updatedAgoHours: 40 }), // stale, linked
    pr(2, "checks-failing", { beads: [], updatedAgoHours: 40 }), // unlinked AND stale
    pr(3, "needs-review", { beads: [] }), // unlinked only (fresh)
    pr(4, "ready-to-merge", { beads: ["cave-a"], updatedAgoHours: 1 }), // clean → excluded
  ];
  const q = buildWorkQueue(beads, prs, [], { nowMs: NOW, staleAfterHours: 24 });
  assert.deepEqual(q.attention.map((a) => a.pr.number), [1, 2, 3], "clean PRs excluded; sorted by number");
  const byNum = Object.fromEntries(q.attention.map((a) => [a.pr.number, a]));
  assert.deepEqual({ u: byNum[1].unlinked, s: byNum[1].stale }, { u: false, s: true }, "#1 stale only");
  assert.deepEqual({ u: byNum[2].unlinked, s: byNum[2].stale }, { u: true, s: true }, "#2 unlinked AND stale");
  assert.deepEqual({ u: byNum[3].unlinked, s: byNum[3].stale }, { u: true, s: false }, "#3 unlinked only");
  assert.ok(q.attention.every((a) => a.pr.title && a.pr.url), "carries the PR summary for display");

  const clean = buildWorkQueue(
    beads,
    [pr(9, "ready-to-merge", { beads: ["cave-a"], updatedAgoHours: 1 })],
    [],
    { nowMs: NOW, staleAfterHours: 24 },
  );
  assert.deepEqual(clean.attention, [], "no unlinked/stale PRs → empty attention");
}

console.log("beads-work-queue.test.ts: ok");

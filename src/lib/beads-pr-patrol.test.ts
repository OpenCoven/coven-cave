// @ts-nocheck
// PR triage patrol digest (cave-hlv.7) — pure lane grouping, window ordering,
// stale/unlinked flagging, and rendering. Clock injected for determinism.
import assert from "node:assert/strict";

const { buildPatrolDigest, isStalePr, renderPatrolDigest } = await import("./beads-pr-patrol.ts");

const NOW = Date.parse("2026-07-07T12:00:00Z");
const HOURS = 3_600_000;

function pr(number, lane, { beads = [`cave-x${number}`], updatedAgoHours = 1 } = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/OpenCoven/coven-cave/pull/${number}`,
    lane,
    beadIds: beads,
    checkStatus: "passing",
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    headRefName: `feat/pr-${number}`,
    updatedAt: new Date(NOW - updatedAgoHours * HOURS).toISOString(),
  };
}

const summaries = [
  pr(1, "checks-failing", { updatedAgoHours: 30 }),
  pr(2, "ready-to-merge"),
  pr(3, "needs-review", { beads: [] }),
  pr(4, "draft"),
  pr(5, "changes-requested"),
  pr(6, "blocked"),
  pr(7, "checks-pending"),
];

// ── Window ordering: morning unblocks first, evening lands first ─────────────
{
  const morning = buildPatrolDigest(summaries, { window: "morning", nowMs: NOW });
  assert.deepEqual(
    morning.sections.map((s) => s.key),
    ["fix-first", "review", "land", "waiting"],
    "morning leads with fix-first",
  );
  const evening = buildPatrolDigest(summaries, { window: "evening", nowMs: NOW });
  assert.deepEqual(
    evening.sections.map((s) => s.key),
    ["land", "fix-first", "review", "waiting"],
    "evening leads with ready-to-land",
  );
}

const digest = buildPatrolDigest(summaries, { window: "morning", nowMs: NOW });

// ── Lane grouping ─────────────────────────────────────────────────────────────
{
  const byKey = Object.fromEntries(digest.sections.map((s) => [s.key, s.prs.map((p) => p.number)]));
  assert.deepEqual(byKey["fix-first"], [1, 5], "failing checks + requested changes fix first");
  assert.deepEqual(byKey.land, [2], "ready-to-merge is the landing queue");
  assert.deepEqual(byKey.review, [3], "needs-review stands alone");
  assert.deepEqual(byKey.waiting, [4, 6, 7], "pending/blocked/draft wait");
  assert.equal(digest.actionable, 4, "actionable = fix-first + land + review");
  assert.equal(digest.total, 7, "every PR counted once");
}

// ── Stale + unlinked flags ────────────────────────────────────────────────────
{
  assert.deepEqual(digest.stale, [1], "only the 30h-old PR is stale at the 24h default");
  assert.deepEqual(digest.unlinked, [3], "the bead-less PR is flagged");
  const tighter = buildPatrolDigest(summaries, { window: "morning", nowMs: NOW, staleAfterHours: 0.5 });
  assert.equal(tighter.stale.length, 7, "stale window is configurable");
  assert.ok(
    isStalePr({ ...pr(9, "draft"), updatedAt: "not-a-date" }, NOW, 24),
    "unparsable activity reads as stale, not fresh",
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────
{
  const text = renderPatrolDigest(digest);
  assert.match(text, /morning window · 7 open PRs · 4 actionable/, "headline counts");
  assert.match(text, /#1 checks-failing \[cave-x1\] PR 1 · STALE/, "stale PRs are flagged inline");
  assert.match(text, /#3 needs-review \[no bead\] PR 3/, "bead-less PRs read as no bead");
  assert.match(text, /Unlinked \(no bead — invisible to the queue\): #3/, "unlinked callout");
  assert.match(text, /Stale \(>24h without update\): #1/, "stale callout names the window");
  const fixIdx = text.indexOf("Fix first");
  const landIdx = text.indexOf("Ready to land");
  assert.ok(fixIdx >= 0 && landIdx > fixIdx, "morning renders fix-first before land");

  const onlyDrafts = buildPatrolDigest([pr(8, "draft")], { window: "evening", nowMs: NOW });
  assert.doesNotMatch(renderPatrolDigest(onlyDrafts), /Fix first|Ready to land|Needs review/, "empty sections are skipped");

  const empty = buildPatrolDigest([], { window: "evening", nowMs: NOW });
  assert.match(renderPatrolDigest(empty), /no open PRs\. Patrol clear\./, "clear patrol reads as clear");
}

console.log("beads-pr-patrol.test.ts: ok");

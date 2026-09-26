// @ts-nocheck
// Familiar Work Queue model (cave-hlv.4) — the pure issue↔PR join: lane mapping,
// per-familiar/per-surface labelling, stale + unlinked flags, no-open-PR and
// post-merge-cleanup derivation. Clock injected for determinism.
import assert from "node:assert/strict";

const { buildWorkQueue, isActionableLane, laneTitle, hasVerificationEvidence } = await import(
  "./work-queue.ts"
);

const NOW = Date.parse("2026-07-07T12:00:00Z");
const HOURS = 3_600_000;

function pr(number, lane, { issues = [], updatedAgoHours = 1 } = {}) {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/OpenCoven/coven-cave/pull/${number}`,
    lane,
    issueIds: issues,
    checkStatus: lane === "checks-failing" ? "failing" : "passing",
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
    headRefName: `feat/pr-${number}`,
    updatedAt: new Date(NOW - updatedAgoHours * HOURS).toISOString(),
  };
}

function issue(id, { priority = 2, labels = [], type = "feature", assignee = null } = {}) {
  return { id, title: `Issue ${id}`, priority, status: "open", assignee, issue_type: type, labels, updated_at: null };
}

// ── Open PRs map to lanes and join to their issue for familiar/surface ─────────
{
  const issues = [issue("cave-aa1", { labels: ["familiar:kitty", "surface:github"] })];
  const prs = [
    pr(1, "checks-failing", { issues: ["cave-aa1"] }),
    pr(2, "ready-to-merge", { issues: ["cave-bb2"] }),
    pr(3, "needs-review", { issues: [] }),
    pr(4, "draft", { issues: [] }),
    pr(5, "changes-requested", { issues: ["cave-aa1"] }),
    pr(6, "checks-pending", { issues: [] }),
    pr(7, "blocked", { issues: [] }),
  ];
  const q = buildWorkQueue(issues, prs, [], { nowMs: NOW });
  const laneOf = Object.fromEntries(q.lanes.map((l) => [l.key, l.items.map((i) => i.key)]));
  assert.deepEqual(laneOf["checks-failing"], ["pr:1"], "failing PR in its lane");
  assert.deepEqual(laneOf["changes-requested"], ["pr:5"]);
  assert.deepEqual(laneOf["needs-review"], ["pr:3"]);
  assert.deepEqual(laneOf["ready-to-merge"], ["pr:2"]);
  assert.deepEqual(laneOf.waiting, ["pr:4", "pr:6", "pr:7"], "draft/pending/blocked fold into waiting");

  const failing = q.lanes.find((l) => l.key === "checks-failing").items[0];
  assert.equal(failing.familiar, "kitty", "PR joined to issue's familiar label");
  assert.equal(failing.surface, "github", "PR joined to issue's surface label");

  const review = q.lanes.find((l) => l.key === "needs-review").items[0];
  assert.equal(review.familiar, "unassigned", "issue-less PR is unassigned");
  assert.equal(review.surface, null);

  assert.deepEqual(q.unlinked, [3, 4, 6, 7], "issue-less open PRs are flagged unlinked");
  // waiting is not actionable; the four PR-action lanes are (2 with issues, but
  // count is by item: failing+changes+review+ready = 4).
  assert.equal(q.actionable, 4, "actionable excludes waiting");
}

// ── Lane ordering: fix-first → land → review → issue lanes → waiting ──────────
{
  const prs = [pr(1, "draft"), pr(2, "ready-to-merge"), pr(3, "checks-failing"), pr(4, "needs-review")];
  const q = buildWorkQueue([], prs, [], { nowMs: NOW });
  assert.deepEqual(
    q.lanes.map((l) => l.key),
    ["checks-failing", "needs-review", "ready-to-merge", "waiting"],
    "lanes render in fix→land→review→waiting order, empty lanes dropped",
  );
}

// ── no-open-PR: ready issues unreferenced by any open PR; epics excluded ──────
{
  const issues = [
    issue("cave-x1", { labels: ["familiar:nova", "surface:ios"] }),
    issue("cave-x2", { labels: ["familiar:kitty"] }), // has an open PR → not here
    issue("cave-epic", { type: "epic", labels: ["familiar:nova"] }), // container, excluded
  ];
  const prs = [pr(9, "needs-review", { issues: ["cave-x2"] })];
  const q = buildWorkQueue(issues, prs, [], { nowMs: NOW });
  const noPr = q.lanes.find((l) => l.key === "no-open-PR");
  assert.deepEqual(noPr.items.map((i) => i.issue.id), ["cave-x1"], "only the unreferenced non-epic issue");
  assert.equal(noPr.items[0].familiar, "nova");
  assert.equal(noPr.items[0].surface, "ios");
}

// ── post-merge-cleanup: merged PR whose issue is still open (in ready set) ────
{
  const issues = [issue("cave-open", { labels: ["familiar:kitty"] })];
  const merged = [
    { number: 50, title: "landed", url: "u/50", issueIds: ["cave-open"], mergedAt: "2026-07-07T00:00:00Z" },
    { number: 51, title: "landed+closed issue", url: "u/51", issueIds: ["cave-closed"], mergedAt: "x" },
    { number: 52, title: "no issue", url: "u/52", issueIds: [], mergedAt: "x" },
  ];
  const q = buildWorkQueue(issues, [], merged, { nowMs: NOW });
  const cleanup = q.lanes.find((l) => l.key === "post-merge-cleanup");
  assert.deepEqual(cleanup.items.map((i) => i.merged.number), [50], "only merged PRs whose issue is still open");
  assert.equal(cleanup.items[0].familiar, "kitty");
  assert.ok(isActionableLane("post-merge-cleanup"), "cleanup is actionable");
  // An issue awaiting cleanup must NOT also appear in no-open-PR (it HAS a PR —
  // it just merged). Otherwise it double-counts.
  assert.equal(q.lanes.find((l) => l.key === "no-open-PR"), undefined, "cleanup issue is not in no-open-PR");
  assert.equal(q.total, 1, "cave-open counted once, in cleanup only");
}

// ── post-merge-cleanup skips issues with an open follow-up PR, and dedups ─────
{
  // cave-seq landed in PR 60 but a follow-up PR 61 is still open: Close would
  // be premature, so the issue shows only via the open PR's lane.
  const issues = [issue("cave-seq", { labels: ["familiar:kitty"] }), issue("cave-dup", { labels: ["familiar:nova"] })];
  const prs = [pr(61, "needs-review", { issues: ["cave-seq"] })];
  const merged = [
    { number: 60, title: "landed first half", url: "u/60", issueIds: ["cave-seq"], mergedAt: "2026-07-07T00:00:00Z" },
    // cave-dup landed across TWO merged PRs → one cleanup item, freshest first.
    { number: 72, title: "landed part 2", url: "u/72", issueIds: ["cave-dup"], mergedAt: "2026-07-07T02:00:00Z" },
    { number: 71, title: "landed part 1", url: "u/71", issueIds: ["cave-dup"], mergedAt: "2026-07-07T01:00:00Z" },
  ];
  const q = buildWorkQueue(issues, prs, merged, { nowMs: NOW });
  const cleanup = q.lanes.find((l) => l.key === "post-merge-cleanup");
  assert.deepEqual(
    cleanup.items.map((i) => i.merged.number),
    [72],
    "open-follow-up issue skipped; duplicate merged refs collapse to the first (freshest) PR",
  );
  const review = q.lanes.find((l) => l.key === "needs-review");
  assert.deepEqual(review.items.map((i) => i.issue.id), ["cave-seq"], "cave-seq stays in its open PR's lane");
  assert.equal(q.total, 2, "each issue counted exactly once");
}

// ── Stale flag + rollup by familiar ──────────────────────────────────────────
{
  const issues = [
    issue("cave-k", { labels: ["familiar:kitty"] }),
    issue("cave-n", { labels: ["familiar:nova"] }),
  ];
  const prs = [
    pr(1, "checks-failing", { issues: ["cave-k"], updatedAgoHours: 40 }), // stale
    pr(2, "needs-review", { issues: ["cave-n"], updatedAgoHours: 2 }),
  ];
  const q = buildWorkQueue(issues, prs, [], { nowMs: NOW, staleAfterHours: 24 });
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
  const prs = [pr(1, "needs-review", { issues: [] }), pr(2, "checks-failing", { issues: [] })];
  const q = buildWorkQueue([], prs, [], { nowMs: NOW });
  assert.equal(q.byFamiliar.at(-1).familiar, "unassigned", "unassigned sorts last");
}

// ── falls back to assignee when no familiar: label ───────────────────────────
{
  const issues = [issue("cave-z", { labels: ["surface:daemon"], assignee: "Cody" })];
  const q = buildWorkQueue(issues, [], [], { nowMs: NOW });
  const item = q.lanes.find((l) => l.key === "no-open-PR").items[0];
  assert.equal(item.familiar, "cody", "assignee lowercased when no familiar: label");
  assert.equal(item.surface, "daemon");
}

assert.equal(laneTitle("ready-to-merge"), "Ready to merge");

// ── hasVerificationEvidence: a recorded comment gates Close (cave-hlv.2) ──────
assert.equal(hasVerificationEvidence({ ...issue("cave-a"), comment_count: 1 }), true, "one comment = evidence");
assert.equal(hasVerificationEvidence({ ...issue("cave-a"), comment_count: 3 }), true, "many comments = evidence");
assert.equal(hasVerificationEvidence({ ...issue("cave-a"), comment_count: 0 }), false, "zero comments = no evidence");
assert.equal(hasVerificationEvidence(issue("cave-a")), false, "absent comment_count = no evidence");
assert.equal(hasVerificationEvidence(undefined), false, "no issue = no evidence");
// notes alone (auto-populated planning text) must NOT count as evidence.
assert.equal(
  hasVerificationEvidence({ ...issue("cave-a"), notes: "some planning text", comment_count: 0 }),
  false,
  "notes without a comment are not verification evidence",
);

// ── Attention: unlinked and/or stale open PRs, with the PR summary (cave-x1j) ─
{
  const issues = [issue("cave-a", { labels: ["familiar:kitty"] })];
  const prs = [
    pr(1, "needs-review", { issues: ["cave-a"], updatedAgoHours: 40 }), // stale, linked
    pr(2, "checks-failing", { issues: [], updatedAgoHours: 40 }), // unlinked AND stale
    pr(3, "needs-review", { issues: [] }), // unlinked only (fresh)
    pr(4, "ready-to-merge", { issues: ["cave-a"], updatedAgoHours: 1 }), // clean → excluded
  ];
  const q = buildWorkQueue(issues, prs, [], { nowMs: NOW, staleAfterHours: 24 });
  assert.deepEqual(q.attention.map((a) => a.pr.number), [1, 2, 3], "clean PRs excluded; sorted by number");
  const byNum = Object.fromEntries(q.attention.map((a) => [a.pr.number, a]));
  assert.deepEqual({ u: byNum[1].unlinked, s: byNum[1].stale }, { u: false, s: true }, "#1 stale only");
  assert.deepEqual({ u: byNum[2].unlinked, s: byNum[2].stale }, { u: true, s: true }, "#2 unlinked AND stale");
  assert.deepEqual({ u: byNum[3].unlinked, s: byNum[3].stale }, { u: true, s: false }, "#3 unlinked only");
  assert.ok(q.attention.every((a) => a.pr.title && a.pr.url), "carries the PR summary for display");

  const clean = buildWorkQueue(
    issues,
    [pr(9, "ready-to-merge", { issues: ["cave-a"], updatedAgoHours: 1 })],
    [],
    { nowMs: NOW, staleAfterHours: 24 },
  );
  assert.deepEqual(clean.attention, [], "no unlinked/stale PRs → empty attention");
}


// ── cave-oa1z: the Work Queue rides the Tasks page as a tab ──────────────────
// (Schedules pattern: legacy mode deep-links onto the tab; one nav entry.)
{
  const { readFileSync } = await import("node:fs");
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  const workspace = read("../components/workspace.tsx");
  if (!/mode === "board" \|\| mode === "familiar-work-queue"/.test(workspace)) {
    throw new Error("workspace must resolve the legacy familiar-work-queue mode onto the merged Tasks surface");
  }
  if (!/initialTab=\{mode === "familiar-work-queue" \|\| variant === "queue" \? "queue" : "tasks"\}/.test(workspace)) {
    throw new Error("the legacy mode and queue variant must deep-link onto the queue tab");
  }
  if (!/queueSlot=\{<FamiliarWorkQueueView[^>]*embedded/.test(workspace)) {
    throw new Error("the queue rides the Tasks page as an embedded slot");
  }

  const board = read("../components/board-view.tsx");
  if (!/idPrefix="tasks"/.test(board) || !/label: "Queue"/.test(board)) {
    throw new Error("BoardView hosts the Tasks | Queue segment tabs");
  }
  if (!/activeTab === "queue" && queueSlot/.test(board)) {
    throw new Error("the queue tabpanel renders the slot");
  }

  const sidebar = read("../components/sidebar-minimal.tsx");
  if (/label: "Work Queue"/.test(sidebar)) {
    throw new Error("the standalone Work Queue nav row stays retired — Tasks covers it");
  }

  const fwq = read("../components/familiar-work-queue-view.tsx");
  if (!/embedded \? null : <h1 className="surface-compact-title">Queue<\/h1>/.test(fwq)) {
    throw new Error("embedded queue suppresses its own h1 (the tab band names the surface)");
  }
  // Resilient load (user-requested "ensure it loads"): one failing source
  // degrades with a banner; only BOTH failing rejects the load.
  if (!/if \(!issuesOk && !prsOk\) throw new Error/.test(fwq)) {
    throw new Error("the queue must load when either source (issues OR PR bridge) is available");
  }
  if (!/GitHub PR bridge unavailable — showing ready issues only/.test(fwq)) {
    throw new Error("a PR-bridge failure surfaces as a truthful degradation banner, not a dead surface");
  }
}

// ── no-open-PR triage order: priority asc, then oldest update first (cave-19jy)
{
  const at = (h) => new Date(NOW - h * HOURS).toISOString();
  const issues = [
    { ...issue("cave-fresh-p1", { priority: 1 }), updated_at: at(2) },
    { ...issue("cave-old-p1", { priority: 1 }), updated_at: at(90) },
    { ...issue("cave-old-p0", { priority: 0 }), updated_at: at(50) },
    { ...issue("cave-any-p2", { priority: 2 }), updated_at: at(200) },
    { ...issue("cave-undated-p1", { priority: 1 }), updated_at: null },
  ];
  const q = buildWorkQueue(issues, [], [], { nowMs: NOW });
  const lane = q.lanes.find((l) => l.key === "no-open-PR");
  assert.deepEqual(
    lane.items.map((i) => i.issue.id),
    ["cave-old-p0", "cave-old-p1", "cave-fresh-p1", "cave-undated-p1", "cave-any-p2"],
    "P0 first; within a priority the stalest update leads; undated issues sort after dated peers",
  );
}

// ── cave-p63a: ref join — an issue's description can claim a PR that names
// no issue, so an issue filed from a PR links it immediately.
{
  // The File-issue flow writes the PR URL into the description; the URL alone
  // links the PR, and the issue does not double-show in no-open-PR.
  const descIssue = {
    ...issue("cave-desc", { labels: ["familiar:nova"] }),
    description: "Filed from unlinked PR #88 — https://github.com/OpenCoven/coven-cave/pull/88",
  };
  const q = buildWorkQueue([descIssue], [pr(88, "checks-failing", { issues: [] })], [], { nowMs: NOW });
  assert.deepEqual(q.unlinked, [], "description pull/<n> URL links the PR");
  const item = q.lanes.find((l) => l.key === "checks-failing").items[0];
  assert.equal(item.issue.id, "cave-desc");
  assert.equal(item.familiar, "nova");
  assert.equal(q.lanes.find((l) => l.key === "no-open-PR"), undefined);
}

{
  // A non-matching ref does NOT link: the PR stays unlinked and the issue stays
  // in no-open-PR. Near-miss numbers (pull/9910 vs 991) must not match.
  const otherIssue = {
    ...issue("cave-other"),
    description: "See https://github.com/OpenCoven/coven-cave/pull/9910 and PR #9911",
  };
  const q = buildWorkQueue([otherIssue], [pr(991, "needs-review", { issues: [] })], [], { nowMs: NOW });
  assert.deepEqual(q.unlinked, [991], "a non-matching ref leaves the PR unlinked");
  assert.equal(q.attention.length, 1);
  assert.equal(q.attention[0].unlinked, true);
  assert.equal(q.lanes.find((l) => l.key === "needs-review").items[0].issue, undefined);
  assert.deepEqual(
    q.lanes.find((l) => l.key === "no-open-PR").items.map((i) => i.issue.id),
    ["cave-other"],
    "the unrelated issue still waits in no-open-PR",
  );
}

{
  // cave-opld (review of #3426): the description fallback is anchored to the
  // File-issue signature + the PR's own URL. An issue that merely MENTIONS a PR
  // ("Follow-up to PR #88") or carries a FOREIGN repo's /pull/88 URL must not
  // be consumed as PR 88's link — that silently dropped real work out of the
  // no-open-PR lane and suppressed the unlinked flag.
  const mentionIssue = {
    ...issue("cave-mention", { labels: ["familiar:kitty"] }),
    description: "Follow-up to PR #88 — tighten the join later",
  };
  const foreignIssue = {
    ...issue("cave-foreign"),
    description: "Port the upstream fix https://github.com/vercel/next.js/pull/88",
  };
  const q = buildWorkQueue([mentionIssue, foreignIssue], [pr(88, "needs-review", { issues: [] })], [], {
    nowMs: NOW,
  });
  assert.deepEqual(q.unlinked, [88], "casual mentions and foreign URLs leave the PR unlinked");
  assert.deepEqual(
    q.lanes.find((l) => l.key === "no-open-PR").items.map((i) => i.issue.id).sort(),
    ["cave-foreign", "cave-mention"],
    "both issues keep waiting as their own work items",
  );

  // The File-issue signature alone (URL elided) still links — it is what the
  // queue's own flow writes.
  const signatureIssue = {
    ...issue("cave-signed"),
    description: "Filed from unlinked PR #88 — see the PR for context",
  };
  const q2 = buildWorkQueue([signatureIssue], [pr(88, "needs-review", { issues: [] })], [], { nowMs: NOW });
  assert.deepEqual(q2.unlinked, [], "the File-issue signature is an anchor on its own");
}

// ── Unranked issues (no P<n> label) sort after every ranked one ─────────────
{
  const q = buildWorkQueue(
    [{ ...issue("#3"), priority: null }, { ...issue("#2"), priority: 4 }, { ...issue("#1"), priority: 0 }],
    [],
    [],
    { nowMs: NOW },
  );
  assert.deepEqual(
    q.lanes.find((l) => l.key === "no-open-PR").items.map((i) => i.issue.id),
    ["#1", "#2", "#3"],
    "an unranked issue waits behind Backlog",
  );
}

console.log("work-queue.test.ts: ok");

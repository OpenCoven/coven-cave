import assert from "node:assert/strict";
import test from "node:test";

import {
  blockersOwnedByYou,
  clampPaneWidth,
  fileChipCapacity,
  fileChipState,
  fileChipWindow,
  interleaveThreads,
  orderReviewQueue,
  queueMix,
  queueRowReason,
  reviewDecision,
  threadLine,
  triageBlocker,
  triageBlockers,
  type CockpitBucket,
  type TriagedBlocker,
} from "./review-cockpit.ts";
import type { Blocker, BlockerId } from "./review-readiness.ts";

function blocker(id: BlockerId): Blocker {
  return {
    id,
    icon: "ph:warning-circle-fill",
    tone: "warning",
    title: id,
    fix: "",
    detail: "",
    reveal: null,
    revealLabel: null,
  };
}

function row(
  id: string,
  bucket: CockpitBucket,
  repo: string,
  updatedAt: string,
) {
  return { id, bucket, repo, updatedAt };
}

test("attention order puts blocked first and the oldest first inside a bucket", () => {
  const ordered = orderReviewQueue(
    [
      row("fresh-blocked", "blocked", "b/two", "2026-08-24T09:00:00Z"),
      row("ready", "ready", "a/one", "2026-08-20T09:00:00Z"),
      row("stale-blocked", "blocked", "a/one", "2026-08-22T09:00:00Z"),
      row("needs", "awaiting", "a/one", "2026-08-23T09:00:00Z"),
    ],
    "attention",
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["stale-blocked", "fresh-blocked", "needs", "ready"],
  );
});

test("repo order groups by repository and keeps attention order inside it", () => {
  const ordered = orderReviewQueue(
    [
      row("b-ready", "ready", "b/two", "2026-08-20T09:00:00Z"),
      row("a-needs", "awaiting", "a/one", "2026-08-23T09:00:00Z"),
      row("b-blocked", "blocked", "b/two", "2026-08-21T09:00:00Z"),
    ],
    "repo",
  );
  assert.deepEqual(
    ordered.map((item) => item.id),
    ["a-needs", "b-blocked", "b-ready"],
  );
});

test("ordering is stable — equal rows break on id, so the cursor keeps its place", () => {
  const same = [
    row("zeta", "awaiting", "a/one", "2026-08-23T09:00:00Z"),
    row("alpha", "awaiting", "a/one", "2026-08-23T09:00:00Z"),
  ];
  assert.deepEqual(
    orderReviewQueue(same, "attention").map((item) => item.id),
    ["alpha", "zeta"],
  );
  assert.deepEqual(
    orderReviewQueue(same.slice().reverse(), "attention").map((item) => item.id),
    ["alpha", "zeta"],
  );
});

test("the mix bar drops empty buckets rather than drawing an unreadable sliver", () => {
  const mix = queueMix(["ready", "blocked", "blocked", "awaiting"]);
  assert.deepEqual(
    mix.map((segment) => [segment.bucket, segment.count]),
    [
      ["blocked", 2],
      ["awaiting", 1],
      ["ready", 1],
    ],
  );
  assert.deepEqual(queueMix([]), []);
});

function bucketFacts(patch: Record<string, unknown> = {}) {
  return {
    draft: false,
    state: "open",
    merged: false,
    mergeable: true,
    mergeableState: "clean",
    reviews: { approved: 0, changesRequested: 0 },
    baseRef: "main",
    ...patch,
  } as Parameters<typeof queueRowReason>[0];
}

test("the row's reason names GitHub's own verdict, in mergeability's own words", () => {
  const opts = { hasPullRequest: true, hasLocalChanges: false };
  assert.equal(
    queueRowReason(bucketFacts({ mergeableState: "dirty", mergeable: false }), opts),
    "conflicts with main",
  );
  assert.equal(
    queueRowReason(bucketFacts({ mergeableState: "behind" }), opts),
    "behind main",
  );
  assert.equal(
    queueRowReason(bucketFacts({ reviews: { approved: 1, changesRequested: 0 } }), opts),
    "approved · clean",
  );
  assert.equal(
    queueRowReason(bucketFacts({ reviews: { approved: 1, changesRequested: 1 } }), opts),
    "changes requested",
  );
});

test("a row never counts failing checks — the queue has not read them", () => {
  const reason = queueRowReason(
    bucketFacts({ mergeableState: "blocked", mergeable: false }),
    { hasPullRequest: true, hasLocalChanges: false },
  );
  assert.equal(reason, "blocked by branch protection");
  assert.doesNotMatch(reason, /check/);
});

test("an unread pull request says it is being read, not that it is fine", () => {
  assert.equal(
    queueRowReason(null, { hasPullRequest: true, hasLocalChanges: false }),
    "reading GitHub state",
  );
  assert.equal(
    queueRowReason(null, { hasPullRequest: false, hasLocalChanges: true }),
    "uncommitted work",
  );
  assert.equal(
    queueRowReason(null, { hasPullRequest: false, hasLocalChanges: false }),
    "",
  );
});

test("an unknown mergeability is reported as computing rather than left blank", () => {
  assert.equal(
    queueRowReason(bucketFacts({ mergeable: null, mergeableState: "unknown" }), {
      hasPullRequest: true,
      hasLocalChanges: false,
    }),
    "mergeability computing",
  );
});

test("a clean unapproved pull request adds no reason — the pill already says it", () => {
  assert.equal(
    queueRowReason(bucketFacts(), {
      hasPullRequest: true,
      hasLocalChanges: false,
    }),
    "",
  );
});

test("a failing check is the author's blocking problem; a thread you can resolve is yours", () => {
  assert.deepEqual(triageBlocker("checks"), {
    severity: "BLOCKING",
    owner: "Author",
  });
  assert.deepEqual(triageBlocker("threads", { canResolveThreads: true }), {
    severity: "NEEDS YOU",
    owner: "You",
  });
});

test("a thread the deck cannot resolve is never reported as yours to clear", () => {
  assert.equal(
    triageBlocker("threads", { canResolveThreads: false }).owner,
    "Either",
  );
});

test("triage sorts hardest stop first, whatever order GitHub reported them in", () => {
  const triaged = triageBlockers([
    blocker("draft"),
    blocker("reviews"),
    blocker("threads"),
    blocker("conflict"),
  ]);
  assert.deepEqual(
    triaged.map((item) => item.severity),
    ["BLOCKING", "NEEDS YOU", "WAITING", "NOT READY"],
  );
});

test("blockersOwnedByYou counts only the reviewer's own", () => {
  const triaged = triageBlockers(
    [blocker("threads"), blocker("checks"), blocker("conflict")],
    { canResolveThreads: true },
  );
  assert.equal(blockersOwnedByYou(triaged), 1);
});

function decisionInput(patch: Partial<Parameters<typeof reviewDecision>[0]> = {}) {
  return {
    selected: true,
    isPr: true,
    draft: false,
    ready: false,
    blockers: [] as readonly TriagedBlocker[],
    checksPending: false,
    mergeableUnknown: false,
    reviewedCount: 0,
    readableCount: 3,
    ...patch,
  };
}

test("a local session says verdicts do not exist yet, and names the unlock", () => {
  const decision = reviewDecision(decisionInput({ isPr: false }));
  assert.equal(decision.headline, "Local review only");
  assert.match(decision.next, /Read 3 more files, then open a pull request/);
});

test("blockers report who owes what and route to request changes", () => {
  const decision = reviewDecision(
    decisionInput({
      blockers: triageBlockers([blocker("checks"), blocker("threads")], {
        canResolveThreads: true,
      }),
    }),
  );
  assert.equal(decision.headline, "Not safe to merge");
  assert.equal(decision.sub, "2 blockers · 1 needs you, 1 on the author.");
  assert.match(decision.next, /Clear your 1 item, then request changes/);
});

test("a ready pull request with files left offers finishing or merging as-is", () => {
  const decision = reviewDecision(
    decisionInput({ ready: true, reviewedCount: 1 }),
  );
  assert.equal(decision.headline, "Ready to merge");
  assert.match(decision.next, /read 1 of 3 files — finish or merge as-is/);
});

test("every file read on a ready pull request leaves exactly one next action", () => {
  const decision = reviewDecision(
    decisionInput({ ready: true, reviewedCount: 3 }),
  );
  assert.equal(decision.next, "Squash & merge.");
});

test("an unknown mergeable state says GitHub has not finished, never that it is fine", () => {
  const decision = reviewDecision(decisionInput({ mergeableUnknown: true }));
  assert.equal(decision.headline, "Waiting on GitHub");
  assert.match(decision.sub, /hasn't finished computing/);
});

test("a draft says nothing is owed here", () => {
  const decision = reviewDecision(decisionInput({ draft: true }));
  assert.equal(decision.headline, "Draft — not open for review");
  assert.equal(decision.tone, "muted");
});

test("no selection asks for one instead of describing an item", () => {
  const decision = reviewDecision(decisionInput({ selected: false }));
  assert.equal(decision.headline, "Nothing selected");
  assert.equal(decision.next, "Pick an item from the queue.");
});

function thread(id: string, where: string) {
  return { id, where, author: "val", excerpt: `note ${id}` };
}

const DIFF_PATH = "src/api/roster-route.ts";

function lineRows(...lines: Array<number | null>) {
  return lines.map((line, index) => ({
    kind: "line",
    key: `row-${index}`,
    line,
  }));
}

test("a thread lands directly under the line it was left on", () => {
  const { rows, unplaced } = interleaveThreads(
    lineRows(38, 39, 40),
    [thread("t1", `${DIFF_PATH}:39`)],
    DIFF_PATH,
    (row) => row.line,
  );
  assert.deepEqual(
    rows.map((row) => row.key),
    ["row-0", "row-1", "thread-t1", "row-2"],
  );
  assert.deepEqual(unplaced, []);
});

test("two threads on one line both render, in the order GitHub returned them", () => {
  const { rows } = interleaveThreads(
    lineRows(10),
    [thread("a", `${DIFF_PATH}:10`), thread("b", `${DIFF_PATH}:10`)],
    DIFF_PATH,
    (row) => row.line,
  );
  assert.deepEqual(
    rows.map((row) => row.key),
    ["row-0", "thread-a", "thread-b"],
  );
});

test("a thread on a folded-away line is reported, never pinned to the wrong one", () => {
  const { rows, unplaced } = interleaveThreads(
    lineRows(38, 39),
    [thread("t9", `${DIFF_PATH}:412`)],
    DIFF_PATH,
    (row) => row.line,
  );
  assert.deepEqual(
    rows.map((row) => row.key),
    ["row-0", "row-1"],
  );
  assert.deepEqual(
    unplaced.map((item) => item.id),
    ["t9"],
  );
});

test("a file-level thread and another file's thread are both unplaced, not misplaced", () => {
  const { rows, unplaced } = interleaveThreads(
    lineRows(1),
    [thread("file", DIFF_PATH), thread("other", "src/other.ts:1")],
    DIFF_PATH,
    (row) => row.line,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    unplaced.map((item) => item.id).sort(),
    ["file", "other"],
  );
});

test("threadLine reads a line anchor and refuses a same-prefix impostor path", () => {
  assert.equal(threadLine("src/a.ts:42", "src/a.ts"), 42);
  assert.equal(threadLine("src/a.ts", "src/a.ts"), null);
  assert.equal(threadLine("src/a.ts.bak:42", "src/a.ts"), null);
});

test("the file rail keeps the open file in view and reports the rest as hidden", () => {
  assert.deepEqual(fileChipWindow(10, 8, 4), { start: 5, end: 9, hidden: 6 });
  assert.deepEqual(fileChipWindow(10, 0, 4), { start: 0, end: 4, hidden: 6 });
});

test("a change with fewer files than the cap shows all of them and hides none", () => {
  assert.deepEqual(fileChipWindow(3, 2, 6), { start: 0, end: 3, hidden: 0 });
  assert.deepEqual(fileChipWindow(0, 0, 6), { start: 0, end: 0, hidden: 0 });
});

test("chip capacity narrows with the pane but never drops below two", () => {
  assert.equal(fileChipCapacity(1600), 8);
  assert.ok(fileChipCapacity(700) < fileChipCapacity(1600));
  assert.equal(fileChipCapacity(320), 2);
});

test("the current file's dot wins over reviewed and flagged", () => {
  assert.equal(
    fileChipState({ current: true, reviewed: true, flagged: true }),
    "current",
  );
  assert.equal(
    fileChipState({ current: false, reviewed: true, flagged: true }),
    "reviewed",
  );
  assert.equal(
    fileChipState({ current: false, reviewed: false, flagged: true }),
    "flagged",
  );
  assert.equal(
    fileChipState({ current: false, reviewed: false, flagged: false }),
    "unread",
  );
});

test("a pane dragged wide is re-clamped when the window shrinks", () => {
  const bounds = { min: 210, max: 460 };
  assert.equal(clampPaneWidth(460, bounds, 1600, 0.26), 416);
  assert.equal(clampPaneWidth(460, bounds, 900, 0.26), 234);
});

test("a viewport too small for the share still honours the pane's minimum", () => {
  assert.equal(clampPaneWidth(300, { min: 210, max: 460 }, 400, 0.26), 210);
});

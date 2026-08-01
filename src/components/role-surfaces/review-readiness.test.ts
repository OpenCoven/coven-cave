import assert from "node:assert/strict";
import test from "node:test";

import {
  checksMeta,
  countedTotal,
  DECK_BUCKETS,
  deckCaption,
  deckSummary,
  draftChangeRequest,
  evidenceItems,
  failingCheckNames,
  isReadyToMerge,
  mergeChecklist,
  prBlockers,
  readinessBanner,
  reviewBucket,
  reviewStateMeta,
  type PrFacts,
} from "./review-readiness.ts";

/** A pull request GitHub reports as clean, approved, and safe to land. */
function facts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    repo: "o/r",
    number: 7,
    state: "open",
    draft: false,
    merged: false,
    headRef: "feat/x",
    baseRef: "main",
    headSha: "abcdef1234567890",
    commits: 2,
    additions: 10,
    deletions: 3,
    changedFiles: 2,
    mergeable: true,
    mergeableState: "clean",
    reviews: { approved: 1, changesRequested: 0, commented: 0 },
    latestReview: { state: "APPROVED", author: "reviewer", submittedAt: "2026-07-30T10:00:00Z" },
    checks: { rollup: "passing", runs: [] },
    threads: { unresolved: 0, total: 0, canResolve: true, items: [] },
    ...overrides,
  };
}

function run(name: string, conclusion: string | null, status = "completed") {
  return { name, status, conclusion, detailsUrl: null };
}

// ── Blockers ─────────────────────────────────────────────────────────────────

test("a clean, approved pull request has no blockers", () => {
  assert.deepEqual(prBlockers(facts()), []);
  assert.deepEqual(prBlockers(null), []);
});

test("blockers name who clears each one, most structural first", () => {
  const blockers = prBlockers(
    facts({
      draft: true,
      state: "closed",
      checks: { rollup: "failing", runs: [run("Rust check", "failure"), run("Frontend build", "success")] },
      threads: { unresolved: 2, total: 3, canResolve: true, items: [] },
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      mergeableState: "dirty",
    }),
  );
  assert.deepEqual(
    blockers.map((blocker) => blocker.id),
    ["draft", "state", "checks", "threads", "reviews", "conflict"],
  );
  // Every blocker says who clears it, and none of them is an action the deck takes.
  for (const blocker of blockers) assert.ok(blocker.fix.length > 0, `${blocker.id} has no fix line`);
  const checks = blockers.find((blocker) => blocker.id === "checks");
  assert.match(checks!.title, /^1 required check is failing$/);
  assert.match(checks!.fix, /Rust check/);
  assert.doesNotMatch(checks!.fix, /Frontend build/);
  assert.equal(checks!.reveal, "checks");
});

test("a running check is not a failing one", () => {
  const runs = [run("E2E", null, "in_progress"), run("CodeQL", "success")];
  assert.deepEqual(failingCheckNames(runs), []);
  assert.deepEqual(
    prBlockers(facts({ checks: { rollup: "pending", runs } })).map((blocker) => blocker.id),
    [],
  );
});

test("neutral and skipped conclusions do not block, real failures do", () => {
  const runs = [run("skipped-job", "skipped"), run("neutral-job", "neutral"), run("flaky", "timed_out")];
  assert.deepEqual(failingCheckNames(runs), ["flaky"]);
});

test("behind and dirty are distinct blockers with distinct fixes", () => {
  const behind = prBlockers(facts({ mergeableState: "behind" }));
  assert.deepEqual(
    behind.map((blocker) => blocker.id),
    ["behind"],
  );
  assert.match(behind[0].title, /behind main/);
  const dirty = prBlockers(facts({ mergeableState: "dirty" }));
  assert.match(dirty[0].title, /conflicts with main/i);
  assert.match(dirty[0].fix, /never edits a working tree/);
});

test("thread blocker copy admits when resolving needs a token the deck lacks", () => {
  const readOnly = prBlockers(facts({ threads: { unresolved: 1, total: 1, canResolve: false, items: [] } }));
  assert.match(readOnly[0].fix, /read-only here/);
  assert.match(readOnly[0].title, /1 unresolved review thread$/);
  const writable = prBlockers(facts({ threads: { unresolved: 2, total: 2, canResolve: true, items: [] } }));
  assert.match(writable[0].title, /2 unresolved review threads$/);
  assert.match(writable[0].fix, /Resolve them on GitHub/);
});

// ── Readiness ────────────────────────────────────────────────────────────────

test("ready to merge needs open, approved, green, mergeable, and no open threads", () => {
  assert.equal(isReadyToMerge(facts()), true);
  assert.equal(isReadyToMerge(null), false);
  assert.equal(isReadyToMerge(facts({ draft: true })), false);
  assert.equal(isReadyToMerge(facts({ state: "closed" })), false);
  assert.equal(isReadyToMerge(facts({ checks: { rollup: "failing", runs: [] } })), false);
  assert.equal(isReadyToMerge(facts({ reviews: { approved: 0, changesRequested: 0, commented: 1 } })), false);
  assert.equal(isReadyToMerge(facts({ reviews: { approved: 1, changesRequested: 1, commented: 0 } })), false);
  assert.equal(isReadyToMerge(facts({ threads: { unresolved: 1, total: 1, canResolve: true, items: [] } })), false);
});

test("mergeable: null is unknown, and an unknown never reads as ready", () => {
  const unknown = facts({ mergeable: null, mergeableState: "unknown" });
  assert.equal(isReadyToMerge(unknown), false);
  // Unknown is not a blocker either — nothing is wrong yet, GitHub is still computing.
  assert.deepEqual(prBlockers(unknown), []);
  const banner = readinessBanner(unknown, []);
  assert.equal(banner.headline, "Waiting on GitHub");
  assert.match(banner.sub, /still computing/);
});

test("the readiness banner answers can-this-land before any detail opens", () => {
  assert.match(readinessBanner(null, []).headline, /No pull request/);
  assert.match(readinessBanner(facts({ draft: true }), []).headline, /^Draft/);
  assert.equal(readinessBanner(facts(), []).headline, "Ready to merge");
  assert.equal(readinessBanner(facts(), []).tone, "success");

  const blocked = readinessBanner(facts({ mergeableState: "dirty" }), prBlockers(facts({ mergeableState: "dirty" })));
  assert.equal(blocked.headline, "Not safe to merge — 1 blocker");
  assert.equal(blocked.tone, "danger");

  const noApproval = facts({ reviews: { approved: 0, changesRequested: 0, commented: 0 } });
  assert.match(readinessBanner(noApproval, []).sub, /No approving review/);
});

test("a draft banner outranks its own blockers so the verdict copy stays honest", () => {
  const draft = facts({ draft: true, mergeableState: "dirty" });
  assert.match(readinessBanner(draft, prBlockers(draft)).headline, /^Draft/);
});

// ── Buckets ──────────────────────────────────────────────────────────────────

test("a session with no pull request is awaiting, an unread one is unread", () => {
  assert.equal(reviewBucket(null, false), "awaiting");
  assert.equal(reviewBucket(null, true), "unread");
  assert.equal(reviewBucket(undefined, true), "unread");
});

test("buckets are exclusive and follow GitHub's own verdict", () => {
  const base = facts();
  assert.equal(reviewBucket(base, true), "ready");
  assert.equal(reviewBucket({ ...base, draft: true }, true), "draft");
  assert.equal(reviewBucket({ ...base, state: "closed" }, true), "blocked");
  assert.equal(
    reviewBucket({ ...base, reviews: { approved: 1, changesRequested: 1, commented: 0 } }, true),
    "changes",
  );
  assert.equal(reviewBucket({ ...base, mergeable: false, mergeableState: "dirty" }, true), "blocked");
  assert.equal(reviewBucket({ ...base, mergeableState: "blocked" }, true), "blocked");
  assert.equal(reviewBucket({ ...base, mergeableState: "behind" }, true), "blocked");
  // Mergeable but unapproved, or still computing: awaiting, never ready.
  assert.equal(reviewBucket({ ...base, reviews: { approved: 0, changesRequested: 0, commented: 0 } }, true), "awaiting");
  assert.equal(reviewBucket({ ...base, mergeable: null, mergeableState: "unknown" }, true), "awaiting");
});

test("changes-requested outranks blocked so a row lands in exactly one bucket", () => {
  const both = { ...facts(), reviews: { approved: 0, changesRequested: 1, commented: 0 }, mergeableState: "dirty" };
  assert.equal(reviewBucket(both, true), "changes");
});

test("the reveal control names the row it sends the reader to", () => {
  // The "checks" disclosure is the whole PR detail panel, so a review-state
  // blocker that opens it must not offer "show the checks".
  const blockers = prBlockers(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure")] },
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      threads: { unresolved: 1, total: 1, canResolve: true, items: [] },
    }),
  );
  const by = new Map(blockers.map((blocker) => [blocker.id, blocker]));
  assert.equal(by.get("checks")!.revealLabel, "show the checks");
  assert.equal(by.get("reviews")!.revealLabel, "show the reviews");
  assert.equal(by.get("threads")!.revealLabel, "show the threads");
  // A blocker with nothing to reveal offers no control at all.
  for (const blocker of prBlockers(facts({ mergeableState: "dirty" }))) {
    assert.equal(blocker.reveal, null);
    assert.equal(blocker.revealLabel, null);
  }
});

test("the caption never claims coverage the strip does not have", () => {
  // Nothing outside the counts: the plain claim is allowed.
  assert.equal(
    deckCaption({ counted: 4, local: 0, drafts: 0, unread: 0, skipped: 0 }),
    "4 counted from live GitHub review state",
  );
  // Local sessions are counted but are not GitHub state, so the lead drops the claim.
  assert.equal(
    deckCaption({ counted: 3, local: 1, drafts: 0, unread: 0, skipped: 0 }),
    "3 counted · 1 local session with no GitHub state",
  );
  // Drafts, unread rows, and rows past the cap are named rather than hidden.
  assert.equal(
    deckCaption({ counted: 5, local: 0, drafts: 2, unread: 1, skipped: 3 }),
    "5 counted from live GitHub review state · outside the counts: 2 drafts, 1 still being read, 3 past the read cap",
  );
  assert.match(deckCaption({ counted: 1, local: 2, drafts: 1, unread: 0, skipped: 0 }), /2 local sessions/);
  assert.match(deckCaption({ counted: 1, local: 0, drafts: 1, unread: 0, skipped: 0 }), /outside the counts: 1 draft$/);
});

test("the counted total is the strip's own denominator, not the deck size", () => {
  const summary = deckSummary(["awaiting", "changes", "draft", "unread", "ready"]);
  // Five items on the deck, three of them bucketed — shares must divide by three.
  assert.equal(countedTotal(summary), 3);
  assert.equal(countedTotal({ awaiting: 0, changes: 0, blocked: 0, ready: 0 }), 0);
});

test("the summary counts add up to the deck, leaving drafts and unreads out", () => {
  const summary = deckSummary(["awaiting", "awaiting", "changes", "blocked", "ready", "draft", "unread"]);
  assert.deepEqual(summary, { awaiting: 2, changes: 1, blocked: 1, ready: 1 });
  // Padding "awaiting" with unread rows would claim knowledge the deck never fetched.
  const total = DECK_BUCKETS.reduce((sum, bucket) => sum + summary[bucket], 0);
  assert.equal(total, 5);
  assert.deepEqual(deckSummary([]), { awaiting: 0, changes: 0, blocked: 0, ready: 0 });
});

test("the queue row's pill reports GitHub's state, and says so while unread", () => {
  const options = { hasPullRequest: true, hasLocalChanges: false };
  assert.equal(reviewStateMeta(null, options).label, "Reading…");
  assert.equal(reviewStateMeta(facts(), options).label, "Ready to merge");
  assert.equal(reviewStateMeta({ ...facts(), draft: true }, options).label, "Draft");

  const closed = reviewStateMeta({ ...facts(), state: "closed", merged: true }, options);
  assert.equal(closed.label, "Blocked");
  assert.match(closed.title, /merged/);

  const dirty = reviewStateMeta({ ...facts(), mergeable: false, mergeableState: "dirty" }, options);
  assert.match(dirty.title, /mergeable_state: dirty/);
});

test("a session with no pull request distinguishes local changes from nothing to review", () => {
  const local = reviewStateMeta(null, { hasPullRequest: false, hasLocalChanges: true });
  assert.equal(local.label, "Local changes");
  const empty = reviewStateMeta(null, { hasPullRequest: false, hasLocalChanges: false });
  assert.equal(empty.label, "No changes");
});

// ── Checks pill ──────────────────────────────────────────────────────────────

test("the checks pill leads with the worst state that exists", () => {
  assert.equal(checksMeta(null).label, "no checks");
  assert.equal(checksMeta(facts()).label, "no checks");
  assert.equal(
    checksMeta(facts({ checks: { rollup: "passing", runs: [run("a", "success"), run("b", "success")] } })).label,
    "2 passed",
  );
  assert.equal(
    checksMeta(facts({ checks: { rollup: "pending", runs: [run("a", "success"), run("b", null, "queued")] } })).label,
    "1 running",
  );
  // A failure outranks a still-running run.
  assert.equal(
    checksMeta(
      facts({ checks: { rollup: "failing", runs: [run("a", "failure"), run("b", null, "in_progress")] } }),
    ).label,
    "1 failing",
  );
});

// ── Merge checklist ──────────────────────────────────────────────────────────

test("the pre-merge checklist ticks every gate for a clean pull request", () => {
  const rows = mergeChecklist(facts());
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Checks green", "Approved", "Review threads resolved", "Mergeable", "Not a draft"],
  );
  assert.ok(rows.every((row) => row.ok));
  assert.deepEqual(mergeChecklist(null), []);
});

test("the checklist marks the unmet gates and explains an unknown mergeability", () => {
  const rows = mergeChecklist(
    facts({
      mergeable: null,
      mergeableState: "unknown",
      reviews: { approved: 0, changesRequested: 1, commented: 0 },
      threads: { unresolved: 2, total: 5, canResolve: true, items: [] },
    }),
  );
  const by = new Map(rows.map((row) => [row.label, row]));
  assert.equal(by.get("Approved")!.ok, false);
  assert.match(by.get("Approved")!.detail, /0 approving reviews, 1 requesting changes/);
  assert.equal(by.get("Review threads resolved")!.ok, false);
  assert.match(by.get("Review threads resolved")!.detail, /2 unresolved of 5/);
  assert.equal(by.get("Mergeable")!.ok, false);
  assert.match(by.get("Mergeable")!.detail, /still computing/);
});

// ── Request-changes evidence ─────────────────────────────────────────────────

test("evidence is only ever facts read from this pull request", () => {
  assert.deepEqual(evidenceItems(null), []);
  assert.deepEqual(evidenceItems(facts()), []);

  const items = evidenceItems(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure"), run("ok", "success")] },
      threads: {
        unresolved: 3,
        total: 4,
        canResolve: true,
        items: [{ id: "t1", where: "src/app/page.tsx:42", author: "bot", excerpt: "this leaks a handle" }],
      },
      mergeableState: "behind",
    }),
  );
  assert.deepEqual(
    items.map((item) => item.key),
    ["check:Rust check", "thread:t1", "threads:rest", "behind"],
  );
  // The failing check cites the head it failed on, short-sha'd.
  assert.match(items[0].line, /head abcdef1/);
  // The two threads beyond the fetched one are counted, not invented.
  assert.match(items[2].label, /^2 more threads$/);
  // A thread chip leads with the file and line, not the whole path.
  assert.equal(items[1].label, "page.tsx:42");
  assert.match(items[1].title, /^src\/app\/page\.tsx:42 — this leaks a handle$/);
});

test("a drafted change request cites every kept item and nothing else", () => {
  const items = evidenceItems(
    facts({
      checks: { rollup: "failing", runs: [run("Rust check", "failure")] },
      mergeableState: "dirty",
    }),
  );
  const body = draftChangeRequest("o/r#7", items);
  assert.match(body, /^Holding o\/r#7 for now — 2 things to clear before I can approve:/);
  assert.match(body, /\n1\. Rust check is failing/);
  assert.match(body, /\n2\. The branch conflicts with main/);
  assert.match(body, /Re-request review once that's pushed/);

  // Dropping a chip drops its sentence and renumbers the rest.
  const trimmed = draftChangeRequest("o/r#7", items.slice(1));
  assert.match(trimmed, /1 thing to clear/);
  assert.doesNotMatch(trimmed, /Rust check/);

  // Nothing kept means nothing drafted — the deck never writes a verdict alone.
  assert.equal(draftChangeRequest("o/r#7", []), "");
});

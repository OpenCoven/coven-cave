// @ts-nocheck
import assert from "node:assert/strict";

const {
  PR_READER_TABS,
  isPrReaderTab,
  summarizePrChecks,
  prChecksHeadline,
  prLandingGates,
  prMergeVerdict,
  prStatBlocks,
  prStatusAsCheckRun,
  prCheckRows,
  prReviewEvidence,
} = await import("./github-pr-reader.ts");

const run = (over = {}) => ({ id: "1", name: "x", status: "completed", conclusion: "success", ...over });

// ── Tabs ─────────────────────────────────────────────────────────────────────

assert.deepEqual([...PR_READER_TABS], ["conversation", "commits", "checks", "files"]);
assert.ok(isPrReaderTab("files"));
assert.ok(!isPrReaderTab("diff"));
assert.ok(!isPrReaderTab(null));

// ── Check counts ─────────────────────────────────────────────────────────────

{
  const counts = summarizePrChecks([
    run({ id: "a" }),
    run({ id: "b" }),
    run({ id: "c", conclusion: "failure" }),
    run({ id: "d", status: "in_progress", conclusion: null }),
    run({ id: "e", status: "queued", conclusion: null }),
    run({ id: "f", conclusion: "skipped" }),
    run({ id: "g", conclusion: "neutral" }),
  ]);
  assert.deepEqual(counts, { failing: 1, passing: 2, pending: 2, neutral: 2, total: 7 });
}

// Skipped and neutral are their OWN bucket, never folded into passing. Folding
// them is how a rollup claims a suite ran when half of it was skipped — a green
// wall that means nothing.
{
  const counts = summarizePrChecks([run({ conclusion: "skipped" }), run({ conclusion: "neutral" })]);
  assert.equal(counts.passing, 0);
  assert.equal(counts.neutral, 2);
}
// Anything completed that is not success/skipped/neutral counts as failing —
// cancelled, timed_out and action_required included.
for (const conclusion of ["failure", "cancelled", "timed_out", "action_required", "stale"]) {
  assert.equal(summarizePrChecks([run({ conclusion })]).failing, 1, conclusion);
}

assert.equal(prChecksHeadline(summarizePrChecks([])), "No checks reported");
assert.equal(prChecksHeadline(summarizePrChecks([run({ conclusion: "failure" })])), "Some checks were not successful");
assert.equal(prChecksHeadline(summarizePrChecks([run({ status: "queued", conclusion: null })])), "Checks are still running");
assert.equal(prChecksHeadline(summarizePrChecks([run()])), "All checks have passed");
// A failure outranks a pending run in the headline — the reader needs the worst
// news first, not the most recent.
assert.equal(
  prChecksHeadline(summarizePrChecks([run({ conclusion: "failure" }), run({ status: "queued", conclusion: null })])),
  "Some checks were not successful",
);

// ── Landing gates ────────────────────────────────────────────────────────────

const gatesFor = (over = {}) =>
  prLandingGates({
    counts: summarizePrChecks([run()]),
    reviews: { approved: 1, changesRequested: 0 },
    mergeable: true,
    mergeableState: "clean",
    ...over,
  });

// The all-clear case.
{
  const gates = gatesFor();
  assert.deepEqual(gates.map((g) => g.state), ["pass", "pass", "pass"]);
  assert.deepEqual(gates.map((g) => g.id), ["checks", "review", "conflicts"]);
  // Every gate explains itself — a bare state with no reason is unactionable.
  for (const gate of gates) assert.ok(gate.detail.length > 0, gate.id);
  assert.deepEqual(prMergeVerdict(gates), { canMerge: true, reason: "Every gate is clear." });
}

// THE RULE THAT MATTERS. GitHub answers "is this mergeable?" with null while it
// computes the merge commit, and never says whether a check is required. An
// unknown gate must read as unknown and must NOT permit a merge — "we could not
// tell" is not permission.
{
  const gates = gatesFor({ mergeable: null });
  const conflicts = gates.find((g) => g.id === "conflicts");
  assert.equal(conflicts.state, "unknown");
  assert.match(conflicts.detail, /still computing/);
  assert.equal(prMergeVerdict(gates).canMerge, false);
  assert.match(prMergeVerdict(gates).reason, /Waiting on conflicts/);
}
{
  const gates = gatesFor({ reviews: null });
  assert.equal(gates.find((g) => g.id === "review").state, "unknown");
  assert.equal(prMergeVerdict(gates).canMerge, false);
}
// No checks at all is unknown, not a pass: a PR that reported nothing has not
// demonstrated anything.
{
  const gates = gatesFor({ counts: summarizePrChecks([]) });
  assert.equal(gates.find((g) => g.id === "checks").state, "unknown");
  assert.equal(prMergeVerdict(gates).canMerge, false);
}

// Blocked states, and blocked outranking merely-unresolved in the reason.
{
  const gates = gatesFor({ counts: summarizePrChecks([run({ conclusion: "failure" })]) });
  assert.equal(gates.find((g) => g.id === "checks").state, "blocked");
  assert.match(gates.find((g) => g.id === "checks").detail, /1 failing/);
  assert.match(prMergeVerdict(gates).reason, /^Blocked by checks/);
}
{
  const gates = gatesFor({ reviews: { approved: 2, changesRequested: 1 } });
  assert.equal(gates.find((g) => g.id === "review").state, "blocked");
}
// Changes-requested outranks an approval: one reviewer holding the line is not
// cancelled out by two who did not.
{
  const gates = gatesFor({ reviews: { approved: 5, changesRequested: 1 }, mergeable: false });
  const verdict = prMergeVerdict(gates);
  assert.equal(verdict.canMerge, false);
  assert.match(verdict.reason, /review and conflicts/);
}
// A pending check is pending, not blocked — but still not mergeable.
{
  const gates = gatesFor({ counts: summarizePrChecks([run({ status: "in_progress", conclusion: null })]) });
  assert.equal(gates.find((g) => g.id === "checks").state, "pending");
  assert.match(prMergeVerdict(gates).reason, /^Waiting on checks/);
}
// No review yet is pending, not a pass.
assert.equal(
  gatesFor({ reviews: { approved: 0, changesRequested: 0 } }).find((g) => g.id === "review").state,
  "pending",
);

// ── Commit statuses count, and the rollup holds the gate (#5795) ──────────────
// The PR tab and this view listed check runs only: a failing Vercel status
// beside passing runs read "3/3 passed" and "Every gate is clear".
{
  const status = (state, context = "vercel") => ({ context, state, description: null, targetUrl: `https://ci/${context}` });
  assert.deepEqual(prStatusAsCheckRun(status("failure")), {
    id: "status:vercel", name: "vercel", status: "completed", conclusion: "failure",
    startedAt: null, completedAt: null, detailsUrl: "https://ci/vercel",
  });
  assert.equal(prStatusAsCheckRun(status("error")).conclusion, "failure", "an errored status is a failure, as in the route's rollup");
  assert.equal(prStatusAsCheckRun(status("success")).conclusion, "success");
  assert.equal(prStatusAsCheckRun(status("pending")).status, "pending");
  assert.equal(prStatusAsCheckRun(status("pending")).conclusion, null);

  const rows = prCheckRows([run({ id: "1" }), run({ id: "2" }), run({ id: "3" })], [status("failure")]);
  assert.equal(rows.length, 4);
  const counts = summarizePrChecks(rows);
  assert.deepEqual(counts, { failing: 1, passing: 3, pending: 0, neutral: 0, total: 4 });
  const gates = gatesFor({ counts, rollup: "failing" });
  assert.equal(gates.find((g) => g.id === "checks").state, "blocked");
  assert.match(gates.find((g) => g.id === "checks").detail, /1 failing/);
  assert.notEqual(prMergeVerdict(gates).reason, "Every gate is clear.");

  // A statuses-only repository shows its statuses, not "No checks reported".
  const only = summarizePrChecks(prCheckRows([], [status("pending", "ci/jenkins")]));
  assert.deepEqual(only, { failing: 0, passing: 0, pending: 1, neutral: 0, total: 1 });
  assert.equal(prChecksHeadline(only), "Checks are still running");
  assert.equal(prCheckRows(undefined, undefined).length, 0);
}
// The route's rollup covers what the list can't show: a status past the first
// page, or a run page that couldn't be read. The worse answer wins.
{
  const passing = summarizePrChecks([run()]);
  const failingRollup = gatesFor({ counts: passing, rollup: "failing" });
  assert.equal(failingRollup.find((g) => g.id === "checks").state, "blocked");
  assert.equal(failingRollup.find((g) => g.id === "checks").detail, "a check is failing");
  assert.equal(prMergeVerdict(failingRollup).canMerge, false);

  const pendingRollup = gatesFor({ counts: passing, rollup: "pending" });
  assert.equal(pendingRollup.find((g) => g.id === "checks").state, "pending");
  assert.equal(pendingRollup.find((g) => g.id === "checks").detail, "not every check has reported");

  // A rollup that passes never clears a run the list shows failing.
  const listed = gatesFor({ counts: summarizePrChecks([run({ conclusion: "cancelled" })]), rollup: "passing" });
  assert.equal(listed.find((g) => g.id === "checks").state, "blocked");

  assert.equal(gatesFor({ counts: passing, rollup: "passing" }).find((g) => g.id === "checks").state, "pass");
  assert.equal(gatesFor({ counts: summarizePrChecks([]), rollup: null }).find((g) => g.id === "checks").state, "unknown");
}

// ── Review evidence (#5795) ──────────────────────────────────────────────────
// Threads that couldn't be read, or were cut off, are not "No review threads".
{
  assert.deepEqual(prReviewEvidence({ authed: true, reviewEvidenceComplete: true, reviewEvidenceError: null }), { complete: true, error: null });
  assert.deepEqual(
    prReviewEvidence({ authed: false, reviewEvidenceComplete: false, reviewEvidenceError: "Review threads require GitHub authentication." }),
    { complete: false, error: "Review threads require GitHub authentication." },
  );
  assert.deepEqual(prReviewEvidence({ authed: true, reviewEvidenceComplete: false, reviewEvidenceError: "  " }), {
    complete: false,
    error: "Not every review thread could be read.",
  });
  // An answer without the field is complete only when authenticated.
  assert.equal(prReviewEvidence({ authed: true }).complete, true);
  assert.equal(prReviewEvidence({ authed: false }).complete, false);
}

// ── Stat blocks ──────────────────────────────────────────────────────────────

assert.equal(prStatBlocks(0, 0), 0);
assert.equal(prStatBlocks(10, 0), 5, "additions only fills every block");
assert.equal(prStatBlocks(0, 10), 0, "deletions only fills none");
assert.equal(prStatBlocks(50, 50), 3);
// A single deleted line in a huge PR still shows: the added side is capped at
// blocks-1 whenever any deletion exists, so the strip never lies by rounding.
assert.equal(prStatBlocks(900, 1), 4);
// …and the mirror case keeps one added block.
assert.equal(prStatBlocks(1, 900), 1);

console.log("github-pr-reader: ok");

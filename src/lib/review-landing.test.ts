// @ts-nocheck
import assert from "node:assert/strict";

const {
  deriveReviewLandingState,
  localReviewRevision,
  localReviewWorkItem,
  pullRequestReviewWorkItem,
} = await import("./review-landing.ts");

const ready = {
  state: "open",
  draft: false,
  checks: "passing",
  reviews: { approved: 1, changesRequested: 0 },
  mergeable: true,
  mergeableState: "clean",
  unresolvedThreads: 0,
};

assert.deepEqual(deriveReviewLandingState(ready), {
  checks: "pass",
  review: "pass",
  conflicts: "pass",
  threads: "pass",
  canReview: true,
  canMerge: true,
  hasUnknown: false,
});

for (const patch of [
  { checks: null },
  { reviews: null },
  { mergeable: null },
  { unresolvedThreads: null },
]) {
  const state = deriveReviewLandingState({ ...ready, ...patch });
  assert.equal(state.canMerge, false);
  assert.equal(state.hasUnknown, true);
}

assert.equal(
  deriveReviewLandingState({
    ...ready,
    reviews: { approved: 2, changesRequested: 1 },
  }).review,
  "blocked",
);
assert.equal(
  deriveReviewLandingState({ ...ready, state: "closed" }).canReview,
  false,
);
assert.equal(
  deriveReviewLandingState({ ...ready, draft: true }).canReview,
  false,
);

const pr = pullRequestReviewWorkItem({
  title: "Ship proof ribbon",
  repo: "o/r",
  number: 7,
  baseRef: "main",
  headRef: "feat/proof",
  headSha: "abcdef123456",
});
assert.equal(pr.id, "pr:o/r#7");
assert.equal(pr.revision, "abcdef123456");

const local = localReviewWorkItem({
  title: "Local pass",
  sessionId: "s1",
  branch: "feat/local",
  revision: "working-tree-a",
});
assert.equal(local.id, "local:s1");
assert.equal(local.revision, "working-tree-a");

const files = [
  { path: "a.ts", status: "modified", additions: 1, deletions: 1 },
];
assert.equal(
  localReviewRevision("2026-08-19T00:00:00Z", files),
  localReviewRevision("2026-08-19T00:00:00Z", files),
);
assert.notEqual(
  localReviewRevision("2026-08-19T00:00:00Z", files),
  localReviewRevision("2026-08-19T00:00:00Z", [
    { ...files[0], additions: 2 },
  ]),
);

console.log("review-landing: ok");

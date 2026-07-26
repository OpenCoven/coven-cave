import assert from "node:assert/strict";
import {
  classifyPullRequest,
  extractBeadIds,
  prStateNote,
  summarizePullRequest,
  type GitHubPullRequestInput,
} from "./beads-pr-management.ts";

function pr(overrides: Partial<GitHubPullRequestInput> = {}): GitHubPullRequestInput {
  return {
    number: 42,
    title: "Implement bridge for cave-hlv.5",
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    isDraft: false,
    headRefName: "feat/cave-hlv.5-pr-bridge",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [
      { name: "Frontend build", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "Rust check", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    updatedAt: "2026-07-04T12:30:00Z",
    body: "Bead: cave-hlv.5",
    labels: [],
    ...overrides,
  };
}

assert.equal(classifyPullRequest(pr({ isDraft: true })), "draft", "draft PRs stay out of merge lanes");
assert.equal(
  classifyPullRequest(pr({ statusCheckRollup: [{ name: "E2E", status: "COMPLETED", conclusion: "FAILURE" }] })),
  "checks-failing",
  "failed checks require CI attention first",
);
assert.equal(
  classifyPullRequest(pr({ reviewDecision: "CHANGES_REQUESTED" })),
  "changes-requested",
  "requested changes should outrank merge readiness",
);
assert.equal(
  classifyPullRequest(pr({ mergeStateStatus: "DIRTY" })),
  "blocked",
  "dirty merge state blocks merge even with approval",
);
assert.equal(
  classifyPullRequest(pr({ statusCheckRollup: [{ name: "CodeQL", status: "IN_PROGRESS", conclusion: null }] })),
  "checks-pending",
  "running checks should produce a pending lane",
);
assert.equal(
  classifyPullRequest(pr({ reviewDecision: "REVIEW_REQUIRED" })),
  "needs-review",
  "passing checks with required review still need review",
);
assert.equal(classifyPullRequest(pr()), "ready-to-merge", "approved clean PRs with passing checks are merge-ready");

assert.deepEqual(
  extractBeadIds(
    pr({
      title: "Finish cave-hlv.6 and cave-hlv.8",
      body: "Refs: cave-hlv.6\nFollow-up: cave-hlv.8",
      headRefName: "feat/cave-hlv.6-pr-protocol",
      labels: [{ name: "bead:cave-hlv.6" }],
    }),
  ),
  ["cave-hlv.6", "cave-hlv.8"],
  "bead IDs should be extracted and de-duped from title, body, branch, and labels",
);

const summary = summarizePullRequest(pr());
assert.deepEqual(
  {
    number: summary.number,
    lane: summary.lane,
    beadIds: summary.beadIds,
    checkStatus: summary.checkStatus,
    reviewDecision: summary.reviewDecision,
    mergeStateStatus: summary.mergeStateStatus,
  },
  {
    number: 42,
    lane: "ready-to-merge",
    beadIds: ["cave-hlv.5"],
    checkStatus: "passing",
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
  },
  "PR summaries should keep the Beads bridge fields compact and deterministic",
);

assert.equal(
  prStateNote(summary),
  "GitHub PR #42: ready-to-merge; checks=passing; review=APPROVED; merge=CLEAN; https://github.com/OpenCoven/coven-cave/pull/42; updated=2026-07-04T12:30:00Z",
  "Beads note should be concise and safe to append as PR state",
);

console.log("beads-pr-management.test.ts: ok");

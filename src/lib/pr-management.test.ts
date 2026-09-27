import assert from "node:assert/strict";
import {
  classifyPullRequest,
  extractIssueRefs,
  isStalePr,
  issueRefInBranch,
  issueRefsInText,
  prStateNote,
  summarizePullRequest,
  type GitHubPullRequestInput,
} from "./pr-management.ts";

function pr(overrides: Partial<GitHubPullRequestInput> = {}): GitHubPullRequestInput {
  return {
    number: 42,
    title: "Implement the PR bridge",
    url: "https://github.com/OpenCoven/coven-cave/pull/42",
    isDraft: false,
    headRefName: "feat/issue-5-pr-bridge",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    statusCheckRollup: [
      { name: "Frontend build", status: "COMPLETED", conclusion: "SUCCESS" },
      { name: "Rust check", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
    updatedAt: "2026-07-04T12:30:00Z",
    body: "Fixes #5",
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
  extractIssueRefs(
    pr({
      title: "Finish the protocol (closes #8)",
      body: "Fixes #6, #8 and #12.\nRelated to #99, which this does not close.",
      headRefName: "fix/issue-6-pr-protocol",
    }),
  ),
  ["#6", "#8", "#12"],
  "issue refs come from closing and reference keywords plus the branch name, de-duped in number order",
);
assert.deepEqual(issueRefsInText("See #4 and PR #7"), [], "a bare mention is not a link");
assert.deepEqual(issueRefsInText("Refs: #3\nPart of #40\nresolves #2"), ["#2", "#3", "#40"]);
assert.equal(issueRefInBranch("chore/issue-5566-remove-beads"), "#5566");
assert.equal(issueRefInBranch("issue_7"), "#7");
assert.equal(issueRefInBranch("feat/tissue-3"), null, "issue must be its own branch segment");
assert.equal(issueRefInBranch(null), null);

const summary = summarizePullRequest(pr());
assert.deepEqual(
  {
    number: summary.number,
    lane: summary.lane,
    issueIds: summary.issueIds,
    checkStatus: summary.checkStatus,
    reviewDecision: summary.reviewDecision,
    mergeStateStatus: summary.mergeStateStatus,
  },
  {
    number: 42,
    lane: "ready-to-merge",
    issueIds: ["#5"],
    checkStatus: "passing",
    reviewDecision: "APPROVED",
    mergeStateStatus: "CLEAN",
  },
  "PR summaries should keep the bridge fields compact and deterministic",
);

assert.equal(
  prStateNote(summary),
  "GitHub PR #42: ready-to-merge; checks=passing; review=APPROVED; merge=CLEAN; https://github.com/OpenCoven/coven-cave/pull/42; updated=2026-07-04T12:30:00Z",
  "the PR state note should be concise and safe to append as a comment",
);

const now = Date.parse("2026-07-05T12:30:00Z");
assert.equal(isStalePr(summary, now, 25), false, "activity inside the window is fresh");
assert.equal(isStalePr(summary, now, 23), true, "activity older than the window is stale");
assert.equal(isStalePr({ ...summary, updatedAt: "not-a-date" }, now, 24), true, "unknown activity reads as stale");

console.log("pr-management.test.ts: ok");

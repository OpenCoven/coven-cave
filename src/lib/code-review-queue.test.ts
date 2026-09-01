import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import {
  codeReviewQueue,
  codeSessionEligibility,
  type CodeQueueMode,
  type CodeSessionEligibility,
} from "./code-review-queue.ts";
import type { SessionGitContext, SessionRow } from "./types.ts";

const NOW = "2026-09-01T12:00:00.000Z";
const DEFAULT_ROOT = "/Users/dev/code/acme-alpha/.worktrees/feat-queue";
const DEFAULT_REPO_URL = "https://github.com/acme/alpha";

function gitFixture(overrides: Partial<SessionGitContext> = {}): SessionGitContext {
  return {
    branch: "feat/queue",
    isWorktree: true,
    worktreeRoot: DEFAULT_ROOT,
    repositoryRoot: "/Users/dev/code/acme-alpha",
    repositoryUrl: DEFAULT_REPO_URL,
    ...overrides,
  };
}

function sessionFixture(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    project_root: DEFAULT_ROOT,
    harness: "coven",
    title: "Queue session",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
    attention: NO_CHAT_ATTENTION,
    generated: false,
    git: gitFixture(),
    workBranch: "feat/queue",
    diff: null,
    familiarWorkspace: false,
    ...overrides,
  };
}

function eligibilityReason(reason: CodeSessionEligibility["reason"]): string {
  switch (reason) {
    case "eligible":
    case "archived":
    case "generated":
    case "rootless":
    case "unverified_git":
    case "non_github":
    case "workspace_unclassified":
    case "familiar_workspace":
      return reason;
  }
}

test("CodeSessionEligibility reason union stays exact", () => {
  const reasons = [
    "eligible",
    "archived",
    "generated",
    "rootless",
    "unverified_git",
    "non_github",
    "workspace_unclassified",
    "familiar_workspace",
  ] as const;
  assert.deepEqual(reasons.map(eligibilityReason), reasons);

  const mode: CodeQueueMode = "reviewable";
  assert.equal(mode, "reviewable");
});

test("codeSessionEligibility keeps canonical GitHub worktrees reviewable", () => {
  assert.deepEqual(codeSessionEligibility(sessionFixture()), {
    reviewable: true,
    reason: "eligible",
  });

  assert.deepEqual(
    codeSessionEligibility(
      sessionFixture({
        id: "linked-worktree",
        project_root: "/Users/dev/code/acme-alpha/.worktrees/pr-12",
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/acme-alpha/.worktrees/pr-12",
          repositoryRoot: "/Users/dev/code/acme-alpha",
          repositoryUrl: DEFAULT_REPO_URL,
        }),
      }),
    ),
    { reviewable: true, reason: "eligible" },
    "linked worktrees stay eligible when server enrichment proves the canonical GitHub repository",
  );
});

test("codeSessionEligibility fails closed with explicit reasons", () => {
  const cases: Array<{ name: string; overrides: Partial<SessionRow>; expected: CodeSessionEligibility["reason"] }> = [
    {
      name: "archived sessions",
      overrides: { archived_at: NOW },
      expected: "archived",
    },
    {
      name: "generated sessions",
      overrides: { generated: true },
      expected: "generated",
    },
    {
      name: "rootless sessions",
      overrides: { project_root: "" },
      expected: "rootless",
    },
    {
      name: "missing git context",
      overrides: { git: null },
      expected: "unverified_git",
    },
    {
      name: "shared checkouts without worktree proof",
      overrides: {
        git: gitFixture({
          isWorktree: false,
          worktreeRoot: "/Users/dev/code/acme-alpha",
          repositoryRoot: null,
        }),
        pullRequest: { repo: "acme/alpha", number: 42, state: "open", branch: "feat/queue" },
        diff: { additions: 4, deletions: 1 },
      },
      expected: "unverified_git",
    },
    {
      name: "missing canonical repository identity",
      overrides: {
        git: gitFixture({ repositoryUrl: null }),
        pullRequest: { repo: "acme/alpha", number: 42, state: "open", branch: "feat/queue" },
      },
      expected: "non_github",
    },
    {
      name: "noncanonical repository identity",
      overrides: {
        git: gitFixture({ repositoryUrl: "git@github.com:acme/alpha.git" }),
      },
      expected: "non_github",
    },
    {
      name: "missing workspace classification",
      overrides: { familiarWorkspace: undefined },
      expected: "workspace_unclassified",
    },
    {
      name: "familiar workspaces",
      overrides: { familiarWorkspace: true },
      expected: "familiar_workspace",
    },
  ];

  for (const { name, overrides, expected } of cases) {
    assert.deepEqual(
      codeSessionEligibility(sessionFixture({ id: name.replace(/\s+/g, "-"), ...overrides })),
      { reviewable: false, reason: expected },
      name,
    );
  }
});

test("codeReviewQueue groups reviewable sessions by canonical GitHub repo and priority", () => {
  const queue = codeReviewQueue(
    [
      sessionFixture({
        id: "a-running",
        project_root: "/Users/dev/code/repo-a/.worktrees/run",
        title: "Running",
        updated_at: "2026-09-01T12:03:00.000Z",
        status: "running",
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/repo-a/.worktrees/run",
          repositoryRoot: "/Users/dev/code/repo-a",
          repositoryUrl: "https://github.com/acme/repo-a",
        }),
      }),
      sessionFixture({
        id: "a-pr",
        project_root: "/Users/dev/code/repo-a/.worktrees/pr",
        title: "Open PR",
        updated_at: "2026-09-01T12:04:00.000Z",
        diff: { additions: 5, deletions: 2 },
        pullRequest: { repo: "acme/repo-a", number: 7, state: "open", branch: "feat/pr" },
        git: gitFixture({
          branch: "feat/pr",
          worktreeRoot: "/Users/dev/code/repo-a/.worktrees/pr",
          repositoryRoot: "/Users/dev/code/repo-a",
          repositoryUrl: "https://github.com/acme/repo-a",
        }),
        workBranch: "feat/pr",
      }),
      sessionFixture({
        id: "a-changed-a",
        project_root: "/Users/dev/code/repo-a/.worktrees/change-a",
        title: "Changed A",
        updated_at: "2026-09-01T12:02:00.000Z",
        diff: { additions: 3, deletions: 0 },
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/repo-a/.worktrees/change-a",
          repositoryRoot: "/Users/dev/code/repo-a",
          repositoryUrl: "https://github.com/acme/repo-a",
        }),
      }),
      sessionFixture({
        id: "a-changed-b",
        project_root: "/Users/dev/code/repo-a/.worktrees/change-b",
        title: "Changed B",
        updated_at: "2026-09-01T12:02:00.000Z",
        diff: { additions: 1, deletions: 1 },
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/repo-a/.worktrees/change-b",
          repositoryRoot: "/Users/dev/code/repo-a",
          repositoryUrl: "https://github.com/acme/repo-a",
        }),
      }),
      sessionFixture({
        id: "b-failed",
        project_root: "/Users/dev/code/repo-b/.worktrees/fail",
        title: "Failed",
        updated_at: "2026-09-01T12:01:00.000Z",
        status: "exited",
        exit_code: 2,
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/repo-b/.worktrees/fail",
          repositoryRoot: "/Users/dev/code/repo-b",
          repositoryUrl: "https://github.com/acme/repo-b",
        }),
      }),
      sessionFixture({
        id: "c-clean",
        project_root: "/Users/dev/code/repo-c/.worktrees/clean",
        title: "Clean",
        updated_at: "2026-09-01T12:05:00.000Z",
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/repo-c/.worktrees/clean",
          repositoryRoot: "/Users/dev/code/repo-c",
          repositoryUrl: "https://github.com/acme/repo-c",
        }),
      }),
    ],
    "reviewable",
    null,
  );

  assert.equal(queue.reviewableCount, 6);
  assert.equal(queue.allLocalCount, 6);
  assert.equal(queue.excludedCount, 0);
  assert.equal(queue.outsideCurrentFilter, false);
  assert.deepEqual(
    queue.groups.map((group) => ({ key: group.key, label: group.label, ids: group.sessions.map((row) => row.id) })),
    [
      { key: "https://github.com/acme/repo-b", label: "acme/repo-b", ids: ["b-failed"] },
      {
        key: "https://github.com/acme/repo-a",
        label: "acme/repo-a",
        ids: ["a-pr", "a-running", "a-changed-a", "a-changed-b"],
      },
      { key: "https://github.com/acme/repo-c", label: "acme/repo-c", ids: ["c-clean"] },
    ],
  );
  assert.deepEqual(queue.sessions.map((row) => row.id), [
    "b-failed",
    "a-pr",
    "a-running",
    "a-changed-a",
    "a-changed-b",
    "c-clean",
  ]);
});

test("codeReviewQueue keeps all local Code-visible rows and root labels in all mode", () => {
  const queue = codeReviewQueue(
    [
      sessionFixture({
        id: "bravo-failed",
        project_root: "/Users/dev/code/bravo",
        updated_at: "2026-09-01T12:01:00.000Z",
        status: "exited",
        exit_code: 1,
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/bravo/.worktrees/fail",
          repositoryRoot: "/Users/dev/code/bravo",
          repositoryUrl: "https://github.com/acme/bravo",
        }),
      }),
      sessionFixture({
        id: "alpha-clean",
        project_root: "/Users/dev/code/alpha",
        updated_at: "2026-09-01T12:00:00.000Z",
        git: gitFixture({
          worktreeRoot: "/Users/dev/code/alpha/.worktrees/clean",
          repositoryRoot: "/Users/dev/code/alpha",
          repositoryUrl: "https://github.com/acme/alpha",
        }),
      }),
      sessionFixture({
        id: "rootless",
        project_root: "",
        updated_at: "2026-09-01T12:06:00.000Z",
      }),
      sessionFixture({
        id: "shared-running",
        project_root: "/Users/dev/code/shared",
        updated_at: "2026-09-01T12:05:00.000Z",
        status: "running",
        git: gitFixture({
          isWorktree: false,
          worktreeRoot: "/Users/dev/code/shared",
          repositoryRoot: null,
          repositoryUrl: "https://github.com/acme/shared",
        }),
      }),
      sessionFixture({
        id: "archived",
        project_root: "/Users/dev/code/archived",
        archived_at: "2026-09-01T11:30:00.000Z",
      }),
      sessionFixture({
        id: "generated",
        project_root: "/Users/dev/code/generated",
        generated: true,
      }),
    ],
    "all",
    null,
  );

  assert.equal(queue.reviewableCount, 2, "only canonical GitHub worktrees count as reviewable");
  assert.equal(queue.allLocalCount, 4, "archived and generated rows remain outside generic Code visibility");
  assert.equal(queue.excludedCount, 2);
  assert.equal(queue.outsideCurrentFilter, false);
  assert.deepEqual(
    queue.groups.map((group) => ({ key: group.key, label: group.label, ids: group.sessions.map((row) => row.id) })),
    [
      { key: "/Users/dev/code/bravo", label: "bravo", ids: ["bravo-failed"] },
      { key: "/Users/dev/code/shared", label: "shared", ids: ["shared-running"] },
      { key: "/Users/dev/code/alpha", label: "alpha", ids: ["alpha-clean"] },
      { key: "", label: "(unknown)", ids: ["rootless"] },
    ],
  );
  assert.deepEqual(queue.sessions.map((row) => row.id), ["bravo-failed", "shared-running", "alpha-clean", "rootless"]);
});

test("codeReviewQueue appends one selected outside-filter row without changing counts", () => {
  const rows = [
    sessionFixture({
      id: "eligible",
      project_root: "/Users/dev/code/repo-z/.worktrees/eligible",
      git: gitFixture({
        worktreeRoot: "/Users/dev/code/repo-z/.worktrees/eligible",
        repositoryRoot: "/Users/dev/code/repo-z",
        repositoryUrl: "https://github.com/acme/repo-z",
      }),
    }),
    sessionFixture({
      id: "selected-rootless",
      project_root: "",
      updated_at: "2026-09-01T12:30:00.000Z",
    }),
  ];

  const reviewable = codeReviewQueue(rows, "reviewable", "selected-rootless");
  assert.equal(reviewable.reviewableCount, 1);
  assert.equal(reviewable.allLocalCount, 2);
  assert.equal(reviewable.excludedCount, 1);
  assert.equal(reviewable.outsideCurrentFilter, true);
  assert.deepEqual(reviewable.sessions.map((row) => row.id), ["eligible", "selected-rootless"]);
  assert.equal(reviewable.groups.at(-1)?.sessions.at(-1)?.id, "selected-rootless");

  const allLocal = codeReviewQueue(
    [
      ...rows,
      sessionFixture({ id: "selected-archived", archived_at: "2026-09-01T11:45:00.000Z" }),
    ],
    "all",
    "selected-archived",
  );
  assert.equal(allLocal.reviewableCount, 1);
  assert.equal(allLocal.allLocalCount, 2);
  assert.equal(allLocal.excludedCount, 1);
  assert.equal(allLocal.outsideCurrentFilter, true);
  assert.equal(allLocal.sessions.at(-1)?.id, "selected-archived");

  const alreadyIncluded = codeReviewQueue(rows, "reviewable", "eligible");
  assert.equal(alreadyIncluded.outsideCurrentFilter, false);
  assert.deepEqual(alreadyIncluded.sessions.map((row) => row.id), ["eligible"]);
});

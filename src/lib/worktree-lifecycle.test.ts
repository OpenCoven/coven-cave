// @ts-nocheck
import assert from "node:assert/strict";

const {
  BRANCH_WARNING_BUDGET,
  WORKTREE_WARNING_BUDGET,
  assessManagedWorktreeCreation,
  calculateLifecycleBudgets,
  classifyLifecycleUnit,
  classifyWorktree,
  isDisposableIgnoredPath,
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
} = await import("./worktree-lifecycle.ts");

const NOW = Date.parse("2026-07-29T22:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

{
  for (const generated of [
    "next-env.d.ts",
    "artifacts/report.json",
    "test-results/results.json",
    "public/sandbox/runtime.js",
    "src-tauri/gen/schemas.json",
    "src-tauri/resources/server/server.mjs",
    "src-tauri/target/debug/app",
  ]) {
    assert.equal(isDisposableIgnoredPath(generated), true, `${generated} is generated runtime state`);
  }
  assert.equal(
    isDisposableIgnoredPath("docs/superpowers/plans/uncommitted-design.md"),
    false,
    "ignored authored work remains preservation evidence",
  );
}

function metadata(overrides = {}) {
  return {
    beadId: "cave-ox3ky",
    owner: "Kitty",
    purpose: "Design automatic local branch retirement",
    disposition: "active",
    createdAt: "2026-07-29T12:00:00Z",
    ...overrides,
  };
}

function observation(overrides = {}) {
  const head = overrides.head ?? "a".repeat(40);
  return {
    kind: "worktree",
    path: "/repo/.worktrees/feat-x",
    ref: "refs/heads/feat/x",
    branch: "feat/x",
    head,
    isPrimary: false,
    protectedBranch: false,
    changes: [],
    ignoredPaths: [],
    nonDisposableIgnoredPaths: [],
    indexFlags: [],
    processOwners: [],
    claimOwners: [],
    taskIds: [],
    openPrs: [],
    mergedPr: null,
    activeWorkflowUrls: [],
    headOnDefaultBranch: false,
    remoteRefsContainingHead: ["refs/remotes/origin/feat/x"],
    updatedAtMs: NOW - 2 * DAY,
    probeErrors: [],
    metadata: metadata(),
    metadataErrors: [],
    remoteRef: { ref: "refs/remotes/origin/feat/x", oid: head },
    sessionIds: [],
    ...overrides,
  };
}

{
  const item = classifyLifecycleUnit(
    observation({
      changes: ["1 .M N... src/live.ts", "? src/new.ts"],
      mergedPr: { number: 42, headOid: "a".repeat(40), url: "https://example.test/42" },
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "dirty work remains active even after its PR merged");
  assert.match(item.reasons.join("\n"), /2 tracked or untracked change/, "dirty paths are counted");
}

{
  const item = classifyLifecycleUnit(
    observation({
      processOwners: [{ pid: 123, command: "node" }],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "a live cwd owner prevents a cleanup-ready classification");
  assert.match(item.reasons.join("\n"), /pid 123/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      sessionIds: ["sess-123", "sess-456"],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "active session ownership blocks cleanup-ready classification");
  assert.match(item.reasons.join("\n"), /sess-123/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      claimOwners: ["buns@coven-cave"],
      taskIds: ["cave-x"],
      openPrs: [{ number: 44, url: "https://example.test/44" }],
      activeWorkflowUrls: ["https://example.test/run"],
    }),
    NOW,
  );
  assert.equal(item.lane, "active");
  assert.match(item.reasons.join("\n"), /claim/);
  assert.match(item.reasons.join("\n"), /cave-x/);
  assert.match(item.reasons.join("\n"), /PR #44/);
  assert.match(item.reasons.join("\n"), /workflow/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: null,
      branch: "feat/missing-metadata",
      ref: "refs/heads/feat/missing-metadata",
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain", "missing metadata fails closed");
  assert.match(item.reasons.join("\n"), /metadata backfill/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadataErrors: ["metadata owner is blank"],
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain", "metadata validation errors fail closed");
  assert.match(item.reasons.join("\n"), /owner is blank/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      branch: null,
      ref: null,
      ignoredPaths: ["node_modules/", ".next/"],
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "detached worktrees stay visible as recovery state");
  assert.match(item.reasons.join("\n"), /detached HEAD/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      branch: "backup/feat-x-2026-07-29",
      ref: "refs/heads/backup/feat-x-2026-07-29",
      remoteRefsContainingHead: ["refs/remotes/origin/backup/feat-x-2026-07-29"],
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "backup branches are never cleanup candidates");
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({
        disposition: "recovery",
        reviewAfter: "2026-07-28T12:00:00Z",
      }),
      mergedPr: { number: 45, headOid: "a".repeat(40), url: "https://example.test/45" },
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "recovery disposition never becomes cleanup-ready");
  assert.match(item.reasons.join("\n"), /owner follow-up/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({ disposition: "pr" }),
      mergedPr: { number: 46, headOid: "a".repeat(40), url: "https://example.test/46" },
      updatedAtMs: NOW - 2 * 60 * 60 * 1000,
    }),
    NOW,
  );
  assert.equal(item.lane, "cooldown", "same-day merged work stays visible during the recency window");
  assert.match(item.reasons.join("\n"), /24-hour cooldown/);
}

{
  const item = classifyWorktree(
    observation({
      metadata: metadata({ disposition: "pr" }),
      mergedPr: { number: 47, headOid: "a".repeat(40), url: "https://example.test/47" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "old exact merged heads become owner-actionable");
  assert.match(item.reasons.join("\n"), /maintenance gate/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({ disposition: "archive" }),
      mergedPr: { number: 48, headOid: "a".repeat(40), url: "https://example.test/48" },
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "archive disposition remains recovery inventory");
}

{
  const item = classifyLifecycleUnit(
    observation({
      mergedPr: { number: 49, headOid: "b".repeat(40), url: "https://example.test/49" },
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "a moved local tip is not retired using a stale merged PR");
  assert.match(item.reasons.join("\n"), /does not match/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      probeErrors: ["Beads inventory unavailable"],
      mergedPr: { number: 50, headOid: "a".repeat(40), url: "https://example.test/50" },
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain", "missing ownership evidence fails closed");
}

{
  const item = classifyLifecycleUnit(
    observation({
      isPrimary: true,
      branch: "main",
      ref: "refs/heads/main",
      protectedBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "protected");
}

{
  const budgets = calculateLifecycleBudgets({
    worktreeCount: WORKTREE_WARNING_BUDGET,
    branchCount: BRANCH_WARNING_BUDGET,
    activeExceptions: 1,
    expiredExceptions: 2,
  });
  assert.equal(budgets.worktrees.warning, 12);
  assert.equal(budgets.branches.warning, 30);
  assert.deepEqual(budgets.exceptions, { active: 1, expired: 2 });
  assert.equal(budgets.worktrees.exceeded, false, "threshold itself is not exceeded");
  assert.equal(budgets.branches.exceeded, false, "threshold itself is not exceeded");
  const exceeded = calculateLifecycleBudgets({
    worktreeCount: WORKTREE_WARNING_BUDGET + 1,
    branchCount: BRANCH_WARNING_BUDGET + 1,
    activeExceptions: 0,
    expiredExceptions: 0,
  });
  assert.equal(exceeded.worktrees.exceeded, true);
  assert.equal(exceeded.branches.exceeded, true);
}

{
  for (const badCounts of [
    { worktreeCount: -1, branchCount: 0, activeExceptions: 0, expiredExceptions: 0 },
    { worktreeCount: 0, branchCount: 1.5, activeExceptions: 0, expiredExceptions: 0 },
    { worktreeCount: 0, branchCount: 0, activeExceptions: Number.NaN, expiredExceptions: 0 },
  ]) {
    assert.throws(
      () => calculateLifecycleBudgets(badCounts),
      /nonnegative integer/,
      "invalid budget counts throw",
    );
  }
}

{
  const refusal = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/second",
    nowMs: NOW,
    existingPaths: ["/repo/.worktrees/first"],
    budgets: calculateLifecycleBudgets({
      worktreeCount: WORKTREE_WARNING_BUDGET,
      branchCount: BRANCH_WARNING_BUDGET,
      activeExceptions: 0,
      expiredExceptions: 0,
    }),
  });
  assert.deepEqual(refusal, {
    allowed: false,
    reasons: [
      "active Bead cave-ox3ky already owns a registered worktree",
      "creating a worktree would exceed the 12-worktree warning budget",
      "creating a branch would exceed the 30-local-branch warning budget",
    ],
  });
}

{
  const allowed = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/second",
    nowMs: NOW,
    existingPaths: ["/repo/.worktrees/first"],
    budgets: calculateLifecycleBudgets({
      worktreeCount: WORKTREE_WARNING_BUDGET,
      branchCount: BRANCH_WARNING_BUDGET,
      activeExceptions: 1,
      expiredExceptions: 0,
    }),
    exception: {
      owner: "Kitty",
      reason: "Primary checkout is conflicted and user-owned",
      expiresAt: "2026-07-30T00:00:00Z",
      additionalPaths: ["/repo/.worktrees/second"],
    },
  });
  assert.deepEqual(allowed, { allowed: true, reasons: [] }, "valid exceptions permit an additional path");
}

{
  const blocked = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/second",
    nowMs: NOW,
    existingPaths: ["/repo/.worktrees/first"],
    budgets: calculateLifecycleBudgets({
      worktreeCount: 4,
      branchCount: 8,
      activeExceptions: 0,
      expiredExceptions: 1,
    }),
    exception: {
      owner: "Kitty",
      reason: "   ",
      expiresAt: "2026-07-30T00:00:00Z",
      additionalPaths: ["/repo/.worktrees/second"],
    },
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reasons: ["active Bead cave-ox3ky already owns a registered worktree"],
  });
}

{
  const items = [
    classifyLifecycleUnit(observation({ isPrimary: true, branch: "main", ref: "refs/heads/main", protectedBranch: true }), NOW),
    classifyLifecycleUnit(observation({ changes: ["? live.ts"] }), NOW),
    classifyLifecycleUnit(
      observation({
        path: null,
        kind: "branch-only",
        branch: "feat/old",
        ref: "refs/heads/feat/old",
        remoteRef: { ref: "refs/remotes/origin/feat/old", oid: "a".repeat(40) },
        mergedPr: { number: 51, headOid: "a".repeat(40), url: "https://example.test/51" },
        metadata: metadata({ disposition: "pr" }),
      }),
      NOW,
    ),
  ];
  const summary = summarizeWorktreeLifecycle(items);
  assert.deepEqual(summary.counts, {
    active: 1,
    recovery: 0,
    cooldown: 0,
    "retire-after-gate": 1,
    uncertain: 0,
    protected: 1,
  });
  const text = renderWorktreeLifecycleReport(summary);
  assert.match(text, /3 registered \| 1 active .* 1 cleanup-ready .* 1 protected/);
  assert.doesNotMatch(text, /retire after gate/i, "human report renames the lane");
  assert.match(text, /cleanup-ready/);
  assert.match(text, /No worktree or branch was changed/);
  assert.match(text, /- feat\/old\n/, "branch-only items render without a path suffix");
  assert.doesNotMatch(text, /feat\/old @/, "branch-only items omit the @ path marker");
  assert.match(text, /\? live\.ts/, "the routine text report retains exact dirty paths");
}

console.log("worktree-lifecycle.test.ts: ok");

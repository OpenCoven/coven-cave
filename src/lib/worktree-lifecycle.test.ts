// @ts-nocheck
import assert from "node:assert/strict";

const {
  BRANCH_WARNING_BUDGET,
  RETIREMENT_COOLDOWN_MS,
  WORKTREE_WARNING_BUDGET,
  assessManagedWorktreeCreation,
  calculateLifecycleBudgets,
  classifyLifecycleUnit,
  classifyWorktree,
  isDisposableIgnoredPath,
  normalizeAbsoluteWorktreePath,
  renderWorktreeLifecycleReport,
  summarizeWorktreeLifecycle,
} = await import("./worktree-lifecycle.ts");

const NOW = Date.parse("2026-07-29T22:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

assert.equal(
  RETIREMENT_COOLDOWN_MS,
  8 * HOUR,
  "retirement cooldown remains the mandatory eight-hour window",
);

{
  for (const equivalent of [
    "/repo/wt",
    "/repo/wt/",
    "/repo/parent/../wt",
    "/repo/./wt",
  ]) {
    assert.equal(
      normalizeAbsoluteWorktreePath(equivalent),
      "/repo/wt",
      `${equivalent} canonicalizes to the same absolute worktree path`,
    );
  }
  assert.equal(normalizeAbsoluteWorktreePath("/"), "/", "the filesystem root remains root");
  assert.equal(
    normalizeAbsoluteWorktreePath("/repo/worktree "),
    "/repo/worktree ",
    "significant trailing whitespace remains part of an absolute worktree path",
  );
  assert.equal(
    normalizeAbsoluteWorktreePath("/repo/ worktree"),
    "/repo/ worktree",
    "significant leading whitespace within an absolute path is preserved",
  );
  assert.equal(
    normalizeAbsoluteWorktreePath(" /repo/worktree"),
    null,
    "whitespace before the root separator does not make a relative path absolute",
  );
  assert.equal(
    normalizeAbsoluteWorktreePath("repo/wt"),
    null,
    "relative paths are not accepted as lifecycle paths",
  );
  assert.equal(
    normalizeAbsoluteWorktreePath("/repo/wt\0escaped"),
    null,
    "embedded NUL bytes are not accepted as lifecycle paths",
  );
  assert.equal(
    normalizeAbsoluteWorktreePath("/repo/wt "),
    "/repo/wt ",
    "valid trailing whitespace remains part of the exact filesystem path",
  );
  assert.notEqual(
    normalizeAbsoluteWorktreePath("/repo/wt "),
    normalizeAbsoluteWorktreePath("/repo/wt"),
    "distinct filesystem paths are not collapsed by whitespace trimming",
  );
  assert.notEqual(
    normalizeAbsoluteWorktreePath("/repo/other"),
    normalizeAbsoluteWorktreePath("/repo/wt"),
    "genuinely different absolute paths remain different",
  );
}

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
  assert.equal(
    isDisposableIgnoredPath("node_modules\\valuable/source.ts"),
    process.platform === "win32",
    "backslashes are path separators only on platforms that define them that way",
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

function taskRef(overrides = {}) {
  return {
    id: "cave-ox3ky",
    title: "Review automatic branch retirement",
    status: "open",
    updatedAt: "2026-07-29T12:00:00Z",
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
    taskRefs: [],
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

function legacyObservation(overrides = {}) {
  const {
    kind,
    ref,
    metadata,
    metadataErrors,
    remoteRef,
    sessionIds,
    ...legacy
  } = observation(overrides);
  return legacy;
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
      openPrs: [{ number: 44, url: "https://example.test/44" }],
      activeWorkflowUrls: ["https://example.test/run"],
    }),
    NOW,
  );
  assert.equal(item.lane, "active");
  assert.match(item.reasons.join("\n"), /claim/);
  assert.match(item.reasons.join("\n"), /PR #44/);
  assert.match(item.reasons.join("\n"), /workflow/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: null,
      branch: "feat/missing-metadata",
      ref: "refs/heads/feat/missing-metadata",
      mergedPr: { number: 43, headOid: "a".repeat(40), url: "https://example.test/43" },
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "review-needed", "clean landed legacy work queues for administrative review");
  assert.match(item.reasons.join("\n"), /structured lifecycle metadata/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({ disposition: "pr" }),
      taskRefs: [
        taskRef({
          id: "cave-task",
          title: "Close administrative cleanup bead",
          status: "blocked",
        }),
      ],
      mergedPr: { number: 44, headOid: "a".repeat(40), url: "https://example.test/44" },
      updatedAtMs: NOW - 2 * DAY,
    }),
    NOW,
  );
  assert.equal(item.lane, "review-needed", "non-closed Beads become administrative review only");
  assert.match(item.reasons.join("\n"), /Bead cave-task/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      changes: ["1 .M N... src/live.ts"],
      metadata: null,
      taskRefs: [taskRef({ id: "cave-dirty" })],
      mergedPr: { number: 45, headOid: "a".repeat(40), url: "https://example.test/45" },
      updatedAtMs: NOW - 2 * DAY,
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "hard activity outranks administrative review blockers");
  assert.match(item.reasons.join("\n"), /tracked or untracked change/);
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
      metadata: null,
      remoteRefsContainingHead: ["refs/remotes/origin/backup/feat-x-2026-07-29"],
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "backup branches outrank administrative review without metadata");
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
      metadata: null,
      taskRefs: [taskRef({ id: "cave-cooldown", status: "in_progress" })],
      mergedPr: { number: 46, headOid: "a".repeat(40), url: "https://example.test/46" },
      updatedAtMs: NOW - RETIREMENT_COOLDOWN_MS + 1,
    }),
    NOW,
  );
  assert.equal(item.lane, "cooldown", "cooldown still outranks administrative review");
  assert.match(item.reasons.join("\n"), /8-hour cooldown/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({ disposition: "pr" }),
      mergedPr: { number: 47, headOid: "a".repeat(40), url: "https://example.test/47" },
      updatedAtMs: NOW - RETIREMENT_COOLDOWN_MS,
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "old exact merged heads become owner-actionable");
  assert.match(item.reasons.join("\n"), /older than 8 hours/);
  assert.match(item.reasons.join("\n"), /maintenance gate/);
}

{
  const item = classifyWorktree(
    {
      ...legacyObservation({
        mergedPr: { number: 47, headOid: "a".repeat(40), url: "https://example.test/47" },
      }),
      remoteRef: { ref: "refs/remotes/origin/feat/x", oid: "b".repeat(40) },
    },
    NOW,
  );
  assert.equal(item.lane, "recovery", "legacy callers still preserve divergent same-name remotes");
  assert.match(item.reasons.join("\n"), /same-named remote ref .* diverges from local HEAD/i);
}

{
  const item = classifyWorktree(
    observation({
      metadata: null,
      branch: "feat/missing-metadata-wrapper",
      ref: "refs/heads/feat/missing-metadata-wrapper",
      mergedPr: { number: 59, headOid: "a".repeat(40), url: "https://example.test/59" },
      headOnDefaultBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "review-needed", "wrapper callers also queue explicit missing metadata for review");
  assert.match(item.reasons.join("\n"), /metadata backfill/i);
}

{
  const legacyDirect = observation({
    metadata: metadata({ disposition: "pr" }),
    taskIds: ["cave-legacy"],
    mergedPr: { number: 60, headOid: "a".repeat(40), url: "https://example.test/60" },
    updatedAtMs: NOW - 2 * DAY,
  });
  delete legacyDirect.taskRefs;
  const item = classifyLifecycleUnit(legacyDirect, NOW);
  const normalized = classifyLifecycleUnit(
    observation({
      metadata: metadata({ disposition: "pr" }),
      taskIds: ["cave-legacy"],
      mergedPr: { number: 60, headOid: "a".repeat(40), url: "https://example.test/60" },
      updatedAtMs: NOW - 2 * DAY,
    }),
    NOW,
  );
  assert.deepEqual(
    item,
    normalized,
    "direct classifier callers without taskRefs behave like legacy taskRefs: [] observations",
  );
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
      path: "/repo/.worktrees/releases/../feat-x",
      metadata: metadata({
        exception: {
          owner: "Kitty",
          reason: "Primary checkout is conflicted and user-owned",
          expiresAt: "2026-07-30T00:00:00Z",
          additionalPaths: ["/repo/.worktrees/feat-x"],
        },
      }),
      mergedPr: { number: 52, headOid: "a".repeat(40), url: "https://example.test/52" },
    }),
    NOW,
  );
  assert.equal(item.lane, "active", "a live exception keeps an equivalent normalized worktree path active");
  assert.match(item.reasons.join("\n"), /Primary checkout is conflicted and user-owned/);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({ exception: null }),
      mergedPr: { number: 51, headOid: "a".repeat(40), url: "https://example.test/51" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "null exception behaves like an absent managed creation exception");
  assert.doesNotMatch(item.reasons.join("\n"), /exception active/i);
}

{
  const item = classifyLifecycleUnit(
    observation({
      metadata: metadata({
        exception: {
          owner: "Kitty",
          reason: "Primary checkout is conflicted and user-owned",
          expiresAt: "2026-07-29T21:59:59Z",
          additionalPaths: ["/repo/.worktrees/feat-x"],
        },
      }),
      mergedPr: { number: 53, headOid: "a".repeat(40), url: "https://example.test/53" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "expired exceptions stop blocking cleanup-ready classification");
}

{
  const item = classifyLifecycleUnit(
    observation({
      path: "/repo/.worktrees/releases/../feat-x",
      metadata: metadata({
        exception: {
          owner: "Kitty",
          reason: "Primary checkout is conflicted and user-owned",
          expiresAt: "2026-07-30T00:00:00Z",
          additionalPaths: ["/repo/.worktrees/other/../other"],
        },
      }),
      mergedPr: { number: 54, headOid: "a".repeat(40), url: "https://example.test/54" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "exceptions do not apply to genuinely different normalized paths");
}

{
  const item = classifyLifecycleUnit(
    observation({
      kind: "branch-only",
      path: null,
      metadata: metadata({
        exception: {
          owner: "Kitty",
          reason: "Primary checkout is conflicted and user-owned",
          expiresAt: "2026-07-30T00:00:00Z",
          additionalPaths: ["/repo/.worktrees/releases/../feat-x"],
        },
      }),
      mergedPr: { number: 55, headOid: "a".repeat(40), url: "https://example.test/55" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "branch-only units still cannot apply normalized path-bounded exceptions");
}

{
  const item = classifyLifecycleUnit(
    observation({
      remoteRef: { ref: "refs/remotes/origin/feat/x", oid: "a".repeat(40) },
      mergedPr: { number: 56, headOid: "a".repeat(40), url: "https://example.test/56" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "equal remote refs do not change normal eligibility");
}

{
  const item = classifyLifecycleUnit(
    observation({
      remoteRef: null,
      mergedPr: { number: 57, headOid: "a".repeat(40), url: "https://example.test/57" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "missing same-name remote refs do not block normal eligibility");
}

{
  const item = classifyLifecycleUnit(
    observation({
      remoteRef: { ref: "refs/remotes/origin/feat/x", oid: "b".repeat(40) },
      mergedPr: { number: 58, headOid: "a".repeat(40), url: "https://example.test/58" },
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "divergent same-name remote refs stay preserved for recovery");
  assert.match(item.reasons.join("\n"), /same-named remote ref .* diverges from local HEAD/i);
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
      "creating a worktree would exceed the 12-worktree budget",
      "creating a branch would exceed the 30-local-branch budget",
    ],
  });
}

{
  const allowed = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/releases/../second",
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
  assert.deepEqual(allowed, { allowed: true, reasons: [] }, "valid exceptions permit an equivalent normalized additional path");
}

{
  const blocked = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/releases/../third",
    nowMs: NOW,
    existingPaths: ["/repo/.worktrees/first"],
    budgets: calculateLifecycleBudgets({
      worktreeCount: 4,
      branchCount: 8,
      activeExceptions: 0,
      expiredExceptions: 0,
    }),
    exception: {
      owner: "Kitty",
      reason: "Primary checkout is conflicted and user-owned",
      expiresAt: "2026-07-30T00:00:00Z",
      additionalPaths: ["/repo/.worktrees/other/../second"],
    },
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reasons: ["active Bead cave-ox3ky already owns a registered worktree"],
  });
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
      expiredExceptions: 0,
    }),
    exception: {
      owner: "Kitty",
      reason: "Primary checkout is conflicted and user-owned",
      expiresAt: "2026-07-30T00:00:00Z",
      additionalPaths: ["repo/.worktrees/second"],
    },
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reasons: ["active Bead cave-ox3ky already owns a registered worktree"],
  });
}

{
  const allowed = assessManagedWorktreeCreation({
    beadId: "cave-ox3ky",
    requestedPath: "/repo/.worktrees/second",
    nowMs: NOW,
    existingPaths: [],
    budgets: calculateLifecycleBudgets({
      worktreeCount: 1,
      branchCount: 1,
      activeExceptions: 0,
      expiredExceptions: 0,
    }),
    exception: null,
  });
  assert.deepEqual(allowed, { allowed: true, reasons: [] }, "null exception is treated as absent during admission");
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
  const budgets = {
    worktrees: { count: 13, warning: 12, exceeded: true },
    branches: { count: 31, warning: 30, exceeded: true },
    exceptions: { active: 1, expired: 2 },
  };
  const summary = summarizeWorktreeLifecycle(items, budgets);
  assert.deepEqual(summary.counts, {
    active: 1,
    recovery: 0,
    cooldown: 0,
    "review-needed": 0,
    "retire-after-gate": 1,
    uncertain: 0,
    protected: 1,
  });
  assert.deepEqual(summary.budgets, budgets, "the exact prevention budget object survives summary creation");
  assert.equal(summary.budgets, budgets, "summary creation preserves the supplied budget object");
  const text = renderWorktreeLifecycleReport(summary);
  assert.match(text, /3 registered \| 1 active .* 0 review-needed .* 1 cleanup-ready .* 1 protected/);
  assert.match(text, /Worktree budget: 13\/12 \(exceeded\)/);
  assert.match(text, /Local branch budget: 31\/30 \(exceeded\)/);
  assert.doesNotMatch(text, /retire after gate/i, "human report renames the lane");
  assert.match(text, /cleanup-ready/);
  assert.match(text, /branch-only/);
  assert.match(text, /No worktree or branch was changed/);
  assert.match(text, /- feat\/old \[branch-only\]\n/, "branch-only items render with their unit kind");
  assert.doesNotMatch(text, /feat\/old @/, "branch-only items omit the @ path marker");
  assert.match(text, /\? live\.ts/, "the routine text report retains exact dirty paths");
  assert.ok(
    text.endsWith("Report only. No worktree or branch was changed."),
    "the final safety line remains exact and final",
  );
}

{
  const items = [
    classifyLifecycleUnit(
      observation({
        branch: "feat/metadata-backfill",
        ref: "refs/heads/feat/metadata-backfill",
        metadata: null,
        mergedPr: { number: 60, headOid: "a".repeat(40), url: "https://example.test/60" },
        headOnDefaultBranch: true,
      }),
      NOW,
    ),
    classifyLifecycleUnit(
      observation({
        branch: "recovery/overdue",
        ref: "refs/heads/recovery/overdue",
        metadata: metadata({
          disposition: "recovery",
          reason: "Preserve operator recovery state",
          reviewAfter: "2026-07-28T12:00:00Z",
        }),
      }),
      NOW,
    ),
    classifyLifecycleUnit(
      observation({
        branch: "feat/duplicate-owner",
        ref: "refs/heads/feat/duplicate-owner",
        metadata: null,
        metadataErrors: [
          "duplicate structured worktree metadata records for feat/duplicate-owner",
        ],
      }),
      NOW,
    ),
    classifyLifecycleUnit(
      observation({
        branch: "feat/dirty-paths",
        ref: "refs/heads/feat/dirty-paths",
        changes: ["1 .M N... src/exact-dirty.ts", "? docs/exact-untracked.md"],
      }),
      NOW,
    ),
  ];
  const text = renderWorktreeLifecycleReport(
    summarizeWorktreeLifecycle(items, {
      worktrees: { count: 4, warning: 12, exceeded: false },
      branches: { count: 4, warning: 30, exceeded: false },
      exceptions: { active: 0, expired: 0 },
    }),
  );
  assert.match(text, /metadata backfill required/i);
  assert.match(text, /overdue recovery review/i);
  assert.match(text, /duplicate Bead ownership/i);
  assert.match(text, /src\/exact-dirty\.ts/);
  assert.match(text, /docs\/exact-untracked\.md/);
}

{
  const summary = summarizeWorktreeLifecycle(
    [
      {
        ...observation({
          branch: "feat/live",
          ref: "refs/heads/feat/live",
          path: "/repo/.worktrees/live",
        }),
        lane: "active",
        reasons: ["claimed by cave-1"],
      },
      {
        ...observation({
          kind: "branch-only",
          branch: "feat/old",
          ref: "refs/heads/feat/old",
          path: null,
          changes: ["? docs/note.md"],
          nonDisposableIgnoredPaths: ["src/exact.ts"],
          indexFlags: ["UU src/exact.ts"],
        }),
        lane: "retire-after-gate",
        reasons: ["merged PR landed"],
      },
      {
        ...observation({
          branch: "feat/review-needed",
          ref: "refs/heads/feat/review-needed",
          path: "/repo/.worktrees/review-needed",
        }),
        lane: "review-needed",
        reasons: ["Bead cave-review (blocked): Close administrative cleanup bead"],
      },
    ],
    {
      worktrees: { count: 3, warning: 12, exceeded: false },
      branches: { count: 3, warning: 30, exceeded: false },
      exceptions: { active: 0, expired: 0 },
    },
  );
  const expected = [
    "Worktree lifecycle: 3 registered | 1 active | 0 recovery | 0 cooldown | 1 review-needed | 1 cleanup-ready | 0 uncertain | 0 protected",
    "Worktree budget: 3/12 (within budget)",
    "Local branch budget: 3/30 (within budget)",
    "Managed exceptions: 0 active | 0 expired",
    "",
    "active",
    "- feat/live @ /repo/.worktrees/live",
    "  claimed by cave-1",
    "",
    "review-needed",
    "- feat/review-needed @ /repo/.worktrees/review-needed",
    "  Bead cave-review (blocked): Close administrative cleanup bead",
    "",
    "cleanup-ready",
    "- feat/old [branch-only]",
    "  merged PR landed",
    "  change: ? docs/note.md",
    "  non-disposable ignored: src/exact.ts",
    "  index flag: UU src/exact.ts",
    "",
    "Report only. No worktree or branch was changed.",
  ].join("\n");
  const expectedWithoutFooter = [
    "Worktree lifecycle: 3 registered | 1 active | 0 recovery | 0 cooldown | 1 review-needed | 1 cleanup-ready | 0 uncertain | 0 protected",
    "Worktree budget: 3/12 (within budget)",
    "Local branch budget: 3/30 (within budget)",
    "Managed exceptions: 0 active | 0 expired",
    "",
    "active",
    "- feat/live @ /repo/.worktrees/live",
    "  claimed by cave-1",
    "",
    "review-needed",
    "- feat/review-needed @ /repo/.worktrees/review-needed",
    "  Bead cave-review (blocked): Close administrative cleanup bead",
    "",
    "cleanup-ready",
    "- feat/old [branch-only]",
    "  merged PR landed",
    "  change: ? docs/note.md",
    "  non-disposable ignored: src/exact.ts",
    "  index flag: UU src/exact.ts",
  ].join("\n");
  assert.equal(
    renderWorktreeLifecycleReport(summary),
    expected,
    "default read-only rendering remains byte-for-byte unchanged",
  );
  assert.equal(
    renderWorktreeLifecycleReport(summary, { includeFooter: true }),
    expected,
    "the explicit read-only option matches the default renderer exactly",
  );
  assert.equal(
    renderWorktreeLifecycleReport(summary, { includeFooter: false }),
    expectedWithoutFooter,
    "the mutable apply renderer reuses the same report body without the report-only footer",
  );
}

console.log("worktree-lifecycle.test.ts: ok");

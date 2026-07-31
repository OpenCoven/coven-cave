// @ts-nocheck
import assert from "node:assert/strict";

const {
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

function observation(overrides = {}) {
  return {
    path: "/repo/.worktrees/feat-x",
    branch: "feat/x",
    head: "a".repeat(40),
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
    remoteRefsContainingHead: [],
    updatedAtMs: NOW - 2 * DAY,
    probeErrors: [],
    ...overrides,
  };
}

{
  const item = classifyWorktree(
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
  const item = classifyWorktree(
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
  const item = classifyWorktree(
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
  const item = classifyWorktree(
    observation({
      branch: null,
      ignoredPaths: ["node_modules/", ".next/"],
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "detached worktrees stay visible as recovery state");
  assert.match(item.reasons.join("\n"), /detached HEAD/);
}

{
  const item = classifyWorktree(
    observation({
      branch: "backup/feat-x-2026-07-29",
      remoteRefsContainingHead: ["origin/backup/feat-x-2026-07-29"],
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "backup branches are never cleanup candidates");
}

{
  const item = classifyWorktree(
    observation({
      mergedPr: { number: 45, headOid: "a".repeat(40), url: "https://example.test/45" },
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
      mergedPr: { number: 46, headOid: "a".repeat(40), url: "https://example.test/46" },
    }),
    NOW,
  );
  assert.equal(item.lane, "retire-after-gate", "old exact merged heads become owner-actionable");
  assert.match(item.reasons.join("\n"), /maintenance gate/);
}

{
  const item = classifyWorktree(
    observation({
      mergedPr: { number: 47, headOid: "b".repeat(40), url: "https://example.test/47" },
    }),
    NOW,
  );
  assert.equal(item.lane, "recovery", "a moved local tip is not retired using a stale merged PR");
  assert.match(item.reasons.join("\n"), /does not match/);
}

{
  const item = classifyWorktree(
    observation({
      probeErrors: ["Beads inventory unavailable"],
      mergedPr: { number: 48, headOid: "a".repeat(40), url: "https://example.test/48" },
    }),
    NOW,
  );
  assert.equal(item.lane, "uncertain", "missing ownership evidence fails closed");
}

{
  const item = classifyWorktree(
    observation({
      isPrimary: true,
      branch: "main",
      protectedBranch: true,
    }),
    NOW,
  );
  assert.equal(item.lane, "protected");
}

{
  const items = [
    classifyWorktree(observation({ isPrimary: true, branch: "main", protectedBranch: true }), NOW),
    classifyWorktree(observation({ changes: ["? live.ts"] }), NOW),
    classifyWorktree(
      observation({
        path: "/repo/.worktrees/old",
        branch: "feat/old",
        mergedPr: { number: 49, headOid: "a".repeat(40), url: "https://example.test/49" },
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
  assert.match(text, /3 registered \| 1 active .* 1 retire after gate .* 1 protected/);
  assert.match(text, /No worktree or branch was changed/);
  assert.match(text, /feat\/old/);
  assert.match(text, /\? live\.ts/, "the routine text report retains exact dirty paths");
}

console.log("worktree-lifecycle.test.ts: ok");

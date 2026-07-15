// @ts-nocheck
/**
 * Tests for src/lib/session-git-enrich.ts (cave-n37w): the async replacement
 * for /api/sessions/list's execFileSync git enrichment.
 *
 * Covers, with a fake injectable git runner:
 *  1. branch + worktree context enrichment (semantics parity with the old
 *     sync version)
 *  2. detached-HEAD fallback (rev-parse --short HEAD)
 *  3. the is-inside-work-tree gate short-circuits non-repo dirs
 *  4. missing directories never spawn git at all
 *  5. per-root dedup — many sessions on one root probe git once
 *  6. diffstat vs base ref + parseShortstat parsing
 *  7. MAX_DIFF_CALLS global cap
 *  8. failed base-ref resolution yields no diff and does not consume the cap
 *  9. root-level concurrency stays within ROOT_CONCURRENCY
 * 10. rows without a root pass through untouched
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  enrichSessionsWithGitContext,
  parseShortstat,
  MAX_DIFF_CALLS,
  ROOT_CONCURRENCY,
} from "./session-git-enrich.ts";

// Real directories: the lib stat-gates roots before probing git.
const scratch = mkdtempSync(path.join(tmpdir(), "session-git-enrich-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
function makeRoot(name) {
  const dir = path.join(scratch, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function session(id, root) {
  return { id, project_root: root, harness: "codex", title: id, status: "completed" };
}

/**
 * Fake git runner scripted per argv key. Records every call. `script` maps a
 * space-joined argv prefix to a value (string | null) or function(root).
 */
function fakeGit(script) {
  const calls = [];
  const runner = async (root, args) => {
    calls.push({ root, args });
    const key = args.join(" ");
    for (const [prefix, value] of Object.entries(script)) {
      if (key.startsWith(prefix)) {
        return typeof value === "function" ? value(root, args) : value;
      }
    }
    return null;
  };
  return { runner, calls };
}

const REPO_SCRIPT = {
  "rev-parse --is-inside-work-tree": "true",
  "branch --show-current": "feat/thing",
  "rev-parse --show-toplevel": (root) => root,
  "rev-parse --git-dir": ".git",
  "rev-parse --git-common-dir": ".git",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
  "diff origin/main...feat/thing --shortstat": " 3 files changed, 10 insertions(+), 2 deletions(-)",
};

// ── 1. branch + diff enrichment, semantics parity ───────────────────────────
{
  const rootA = makeRoot("repo-a");
  const { runner } = fakeGit(REPO_SCRIPT);
  const rows = await enrichSessionsWithGitContext([session("s1", rootA)], runner);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].git, {
    branch: "feat/thing",
    worktreeRoot: rootA,
    isWorktree: false,
  });
  assert.deepEqual(rows[0].diff, { additions: 10, deletions: 2 });
}

// ── 2. detached HEAD falls back to the short hash ───────────────────────────
{
  const root = makeRoot("repo-detached");
  const { runner, calls } = fakeGit({
    "rev-parse --is-inside-work-tree": "true",
    "branch --show-current": null,
    "rev-parse --short HEAD": "abc1234",
    "rev-parse --show-toplevel": (r) => r,
    "rev-parse --git-dir": ".git",
    "rev-parse --git-common-dir": ".git",
    "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
    "diff origin/main...abc1234 --shortstat": " 1 file changed, 1 insertion(+)",
  });
  const rows = await enrichSessionsWithGitContext([session("s1", root)], runner);
  assert.equal(rows[0].git.branch, "abc1234");
  assert.deepEqual(rows[0].diff, { additions: 1, deletions: 0 });
  assert.ok(calls.some((c) => c.args.join(" ") === "rev-parse --short HEAD"));
}

// ── 3. non-repo dirs stop at the is-inside-work-tree gate ──────────────────
{
  const root = makeRoot("not-a-repo");
  const { runner, calls } = fakeGit({ "rev-parse --is-inside-work-tree": null });
  const rows = await enrichSessionsWithGitContext([session("s1", root)], runner);
  assert.equal(rows[0].git, undefined);
  assert.equal(rows[0].diff, undefined);
  assert.equal(calls.length, 1, "only the gate probe may run for non-repo dirs");
}

// ── 4. missing directories never spawn git ──────────────────────────────────
{
  const { runner, calls } = fakeGit(REPO_SCRIPT);
  const rows = await enrichSessionsWithGitContext(
    [session("s1", path.join(scratch, "does-not-exist"))],
    runner,
  );
  assert.equal(rows[0].git, undefined);
  assert.equal(calls.length, 0, "stat gate must precede any git call");
}

// ── 5. sessions sharing a root share one probe set ──────────────────────────
{
  const root = makeRoot("repo-shared");
  const { runner, calls } = fakeGit(REPO_SCRIPT);
  const rows = await enrichSessionsWithGitContext(
    [session("s1", root), session("s2", root), session("s3", root)],
    runner,
  );
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.git.branch, "feat/thing");
    assert.deepEqual(row.diff, { additions: 10, deletions: 2 });
  }
  const diffCalls = calls.filter((c) => c.args[0] === "diff");
  assert.equal(diffCalls.length, 1, "one diff per root, not per session");
  const gateCalls = calls.filter((c) => c.args.join(" ") === "rev-parse --is-inside-work-tree");
  assert.equal(gateCalls.length, 1, "one context probe set per root");
}

// ── 6. parseShortstat parsing ────────────────────────────────────────────────
{
  assert.deepEqual(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)"), {
    additions: 10,
    deletions: 2,
  });
  assert.deepEqual(parseShortstat(" 1 file changed, 1 insertion(+)"), {
    additions: 1,
    deletions: 0,
  });
  assert.deepEqual(parseShortstat(""), { additions: 0, deletions: 0 });
  assert.equal(parseShortstat(null), null);
}

// ── 7. the global diff cap holds across many roots ──────────────────────────
{
  const roots = Array.from({ length: MAX_DIFF_CALLS + 8 }, (_, i) => makeRoot(`repo-cap-${i}`));
  const { runner, calls } = fakeGit(REPO_SCRIPT);
  const rows = await enrichSessionsWithGitContext(
    roots.map((root, i) => session(`s${i}`, root)),
    runner,
  );
  const diffCalls = calls.filter((c) => c.args[0] === "diff");
  assert.equal(diffCalls.length, MAX_DIFF_CALLS, "diff calls must stop at MAX_DIFF_CALLS");
  // Every root still gets branch context even past the diff cap.
  for (const row of rows) assert.equal(row.git.branch, "feat/thing");
  assert.equal(
    rows.filter((r) => r.diff).length,
    MAX_DIFF_CALLS,
    "rows beyond the cap carry no diff",
  );
}

// ── 8. missing base ref: no diff, and the cap is not consumed ───────────────
{
  const noBase = makeRoot("repo-no-base");
  const withBase = makeRoot("repo-with-base");
  const { runner, calls } = fakeGit({
    ...REPO_SCRIPT,
    "symbolic-ref --short refs/remotes/origin/HEAD": (root) =>
      root === noBase ? null : "origin/main",
    "rev-parse --verify --quiet": null,
  });
  const rows = await enrichSessionsWithGitContext(
    [session("s1", noBase), session("s2", withBase)],
    runner,
  );
  assert.equal(rows[0].diff, undefined, "no base ref -> no diff");
  assert.deepEqual(rows[1].diff, { additions: 10, deletions: 2 });
  const diffCalls = calls.filter((c) => c.args[0] === "diff");
  assert.equal(diffCalls.length, 1, "the failed-base root must not consume a diff slot");
}

// ── 9. root-level concurrency stays bounded ─────────────────────────────────
{
  const roots = Array.from({ length: 12 }, (_, i) => makeRoot(`repo-conc-${i}`));
  let inFlight = 0;
  let peak = 0;
  const perRootActive = new Set();
  const runner = async (root, args) => {
    // Count distinct roots being probed at once (the unit of parallelism).
    if (!perRootActive.has(root)) {
      perRootActive.add(root);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
    }
    await new Promise((r) => setTimeout(r, 2));
    const key = args.join(" ");
    if (key === "rev-parse --is-inside-work-tree") return "true";
    if (key === "branch --show-current") return "main";
    if (key === "rev-parse --show-toplevel") return root;
    if (key.startsWith("diff")) {
      // Last probe for the root — release its concurrency slot.
      perRootActive.delete(root);
      inFlight -= 1;
      return " 1 file changed, 1 insertion(+)";
    }
    if (key.startsWith("symbolic-ref")) return "origin/main";
    return ".git";
  };
  await enrichSessionsWithGitContext(
    roots.map((root, i) => session(`s${i}`, root)),
    runner,
  );
  assert.ok(
    peak <= ROOT_CONCURRENCY,
    `peak concurrent roots ${peak} must stay <= ROOT_CONCURRENCY (${ROOT_CONCURRENCY})`,
  );
  assert.ok(peak >= 2, "roots must actually be probed in parallel");
}

// ── 10. rootless rows pass through untouched ────────────────────────────────
{
  const { runner, calls } = fakeGit(REPO_SCRIPT);
  const bare = { id: "s1", project_root: "", harness: "codex", title: "s1", status: "completed" };
  const rows = await enrichSessionsWithGitContext([bare], runner);
  assert.equal(rows[0], bare, "rootless rows keep their identity");
  assert.equal(calls.length, 0);
}

// ── 11. PR attribution is per session, never per root-current-branch ────────
// (cave-9q24: stamping the root's checked-out branch's PR onto every session
// sharing the root let one merged PR mass-archive unrelated chats.)
{
  /** Fake BranchPrCache scripted per branch; records lookups. */
  function fakePrCache(byBranch) {
    const lookups = [];
    return {
      lookups,
      get(root, branch) {
        lookups.push({ root, branch });
        return byBranch[branch] ?? null;
      },
    };
  }
  const mergedPr = (branch) => ({
    repo: "acme/app",
    number: 189,
    url: "https://github.com/acme/app/pull/189",
    state: "merged",
    branch,
  });

  // 11a. Shared (non-worktree) checkout: rows WITHOUT a recorded workBranch
  // get NO PR context, even though the root's current branch has a merged PR.
  {
    const root = makeRoot("repo-shared-checkout");
    const { runner } = fakeGit(REPO_SCRIPT); // current branch: feat/thing, isWorktree false
    const prCache = fakePrCache({ "feat/thing": mergedPr("feat/thing") });
    const rows = await enrichSessionsWithGitContext(
      [session("unrelated-1", root), session("unrelated-2", root)],
      runner,
      prCache,
    );
    assert.equal(rows[0].pullRequest, undefined, "no recorded branch → no PR attribution");
    assert.equal(rows[1].pullRequest, undefined);
    assert.equal(prCache.lookups.length, 0, "unattributable rows must not probe the PR cache");
  }

  // 11b. A row's recorded workBranch drives its PR lookup — not the root's
  // current branch; rows without one still get nothing.
  {
    const root = makeRoot("repo-workbranch");
    const { runner } = fakeGit(REPO_SCRIPT); // root currently on feat/thing
    const prCache = fakePrCache({
      "feat/mine": mergedPr("feat/mine"),
      "feat/thing": mergedPr("feat/thing"),
    });
    const rows = await enrichSessionsWithGitContext(
      [
        { ...session("mine", root), workBranch: "feat/mine" },
        session("bystander", root),
      ],
      runner,
      prCache,
    );
    assert.deepEqual(rows[0].pullRequest, mergedPr("feat/mine"));
    assert.equal(rows[1].pullRequest, undefined, "bystander in the same root stays unstamped");
    assert.deepEqual(prCache.lookups, [{ root, branch: "feat/mine" }]);
  }

  // 11c. Worktree roots are branch-stable, so daemon-only rows (no recorded
  // branch) may fall back to the root's branch there.
  {
    const root = makeRoot("repo-worktree");
    const { runner } = fakeGit({
      ...REPO_SCRIPT,
      "rev-parse --git-dir": path.join(root, ".git/worktrees/feat-thing"),
      "rev-parse --git-common-dir": path.join(root, ".git"),
    });
    const prCache = fakePrCache({ "feat/thing": mergedPr("feat/thing") });
    const rows = await enrichSessionsWithGitContext([session("wt", root)], runner, prCache);
    assert.equal(rows[0].git.isWorktree, true);
    assert.deepEqual(rows[0].pullRequest, mergedPr("feat/thing"));
  }
}

console.log("session-git-enrich.test.ts: all assertions passed");

#!/usr/bin/env node
// Push commits that exist on no remote, so a local actor cannot destroy them.
//
// CLAUDE.md's corollary discipline is "push your branch to origin after every
// commit — the remote is the only store a local actor can't destroy". That is
// advice, and advice does not hold: a 2026-08-09 sweep found 174 commits
// across five branches sitting on no remote ref at all, including 135 on
// `docs/cave-zs85n-chat-sidebar-attention`. Two of those branches were back at
// risk 25 minutes after being pushed by hand, because live sessions kept
// committing locally. It is a continuous leak, not a backlog.
//
// The neighbouring hooks defend the two other failure modes and neither covers
// this one: `worktree-guard.mjs` blocks destructive Bash *from a Claude
// session*, and `worktree-autolock.mjs` locks at-risk worktrees against
// GitHub Desktop. A lock is a delay, not a backup — a second `--force` still
// takes the worktree, and neither hook moves a single commit off this machine.
//
// Retention here is a push, never a merge and never a PR: nothing lands, and
// no branch is deleted or rewritten.
//
// Advisory only: this never blocks a tool call and always exits 0.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THROTTLE_MS = 60_000;
// Bounds worst-case latency added to one tool call. Pushed worktrees drop out
// of the at-risk set, so successive passes reach the rest.
const MAX_PUSHES_PER_PASS = 3;
const PUSH_TIMEOUT_MS = 20_000;

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function git(args, cwd, timeout = 10_000) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

export function parseWorktrees(porcelain) {
  const records = [];
  let current = null;
  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), bare: false };
      records.push(current);
      continue;
    }
    if (!current) continue;
    if (line === "bare") current.bare = true;
  }
  return records;
}

// A tag name cannot carry `/` safely alongside a sibling of the same prefix —
// git cannot hold both `retention/fix` and `retention/fix/foo`, so a second
// branch sharing a prefix would collide. Flatten, exactly as the archive-tag
// route in CLAUDE.md does.
export function retentionTag(branch, sha) {
  const slug = String(branch).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `retention/${slug || "detached"}-${String(sha).slice(0, 9)}`;
}

// Commits reachable from HEAD but from no remote-tracking ref.
//
// `--remotes` is refs/remotes/*, which is remote-tracking BRANCHES only. Git
// keeps no remote-tracking refs for tags at all, so a branch archived as a
// pushed tag still counts as unpushed here — see remoteTagCommits below, which
// supplies the half this cannot see.
export function unpushedCount(worktreePath) {
  try {
    const n = Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes"], worktreePath).trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0; // unborn HEAD, or unreadable mid-creation — leave it alone
  }
}

export function headSha(worktreePath) {
  try {
    return git(["rev-parse", "HEAD"], worktreePath).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Commit ids the remote currently advertises as tags.
 *
 * The guard already treats "a remote branch OR a tag pushed to a remote" as
 * retention. This hook did not, so it re-pushed branches whose heads were
 * already archived: on 2026-08-10 twelve merged branches were tagged, verified
 * on the remote and deleted, and eight were re-created within minutes — every
 * one of them a branch whose worktree still existed. The two surfaces disagreed
 * about the same repository state, and the archive-tag retirement route in
 * CLAUDE.md could not work while they did (cave-nw3hq).
 *
 * Both ref forms are collected. An annotated tag advertises the tag object at
 * `refs/tags/x` and its commit at `refs/tags/x^{}`; a lightweight tag
 * advertises the commit directly. Taking both means the peeled commit is always
 * present, and the extra tag-object ids can never collide with a commit id.
 *
 * Returns null when the remote cannot be reached, which the caller treats as
 * "no proof" and pushes — the safe direction. Wrongly pushing costs a redundant
 * ref; wrongly skipping leaves commits on one machine, which is the leak this
 * hook exists to stop.
 */
export function remoteTagCommits(worktreePath) {
  try {
    const output = git(["ls-remote", "--tags", "origin"], worktreePath, PUSH_TIMEOUT_MS);
    const oids = new Set();
    for (const line of output.split("\n")) {
      const oid = line.slice(0, 40);
      if (/^[0-9a-f]{40}$/.test(oid)) oids.add(oid);
    }
    return oids;
  } catch {
    return null;
  }
}

/**
 * Branch names the remote currently advertises.
 *
 * Collected so this hook can tell a branch that was never pushed from one the
 * remote has since DELETED. Both are absent from `ls-remote`; only the second
 * must not be re-created.
 *
 * Returns null when the remote cannot be reached, which the caller treats as
 * "no proof of deletion" and falls back to the branch-first path — the same
 * safe direction remoteTagCommits takes.
 */
export function remoteBranchNames(worktreePath) {
  try {
    const output = git(["ls-remote", "--heads", "origin"], worktreePath, PUSH_TIMEOUT_MS);
    const names = new Set();
    for (const line of output.split("\n")) {
      const ref = line.slice(41).trim();
      if (ref.startsWith("refs/heads/")) names.add(ref.slice("refs/heads/".length));
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Did this branch ever exist on the remote?
 *
 * `refs/remotes/origin/<branch>` is written by a push or fetch of that branch
 * and survives the remote deleting it, until something prunes. So a local
 * remote-tracking ref plus an absence from `ls-remote --heads` is a branch the
 * remote deleted — a merged-and-auto-deleted PR head, in practice.
 *
 * A branch that has never been pushed has no such ref, so it stays on the
 * branch-first path and is still retained as a branch. If a prune has already
 * run, this reads false and the branch is pushed as before: a resurrected
 * branch, which is the pre-existing behaviour, never a lost commit.
 */
export function hadRemoteTracking(worktreePath, branch) {
  if (!branch) return false;
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], worktreePath);
    return true;
  } catch {
    return false;
  }
}

function branchOf(worktreePath) {
  try {
    const name = git(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath).trim();
    return name && name !== "HEAD" ? name : null;
  } catch {
    return null;
  }
}

function throttled(root) {
  const stamp = path.join(root, ".claude", "worktree-retention-push.stamp");
  try {
    if (Date.now() - statSync(stamp).mtimeMs < THROTTLE_MS) return true;
  } catch {
    // no stamp yet — run
  }
  try {
    mkdirSync(path.dirname(stamp), { recursive: true });
    writeFileSync(stamp, String(Date.now()));
  } catch {
    // best effort; a missing stamp only costs an extra pass
  }
  return false;
}

function record(root, entry) {
  try {
    appendFileSync(
      path.join(root, ".claude", "worktree-retention-push.log"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch {
    // logging must never break a tool call
  }
}

// Branch first: a remote branch is what every other surface here already reads
// as retention, and a fast-forward push cannot rewrite anyone's work. When it
// is refused — a diverged branch, or `branch-cap.yml` rolling back a newly
// created branch above 40 — fall back to a tag named for the exact commit.
// The tag is immutable and unique, so it never force-updates and never
// collides, and `branch-cap.yml` ignores it (`ref_type == 'branch'` only).
// `preferTag` skips the branch push entirely rather than letting it fail into
// the fallback: when the remote deleted the branch, pushing it SUCCEEDS and
// re-creates it, so there is no failure to fall back from.
export function retain(worktreePath, root, branch, { preferTag = false } = {}) {
  const sha = git(["rev-parse", "HEAD"], worktreePath).trim();
  if (branch && !preferTag) {
    try {
      git(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`], worktreePath, PUSH_TIMEOUT_MS);
      return { verdict: "pushed-branch", branch, sha };
    } catch (error) {
      record(root, {
        verdict: "branch-push-failed",
        worktree: worktreePath,
        branch,
        error: String(error?.message ?? error).slice(0, 300),
      });
    }
  }
  const tag = retentionTag(branch ?? "detached", sha);
  git(["push", "origin", `${sha}:refs/tags/${tag}`], worktreePath, PUSH_TIMEOUT_MS);
  return {
    verdict: "pushed-tag",
    branch,
    sha,
    tag,
    ...(preferTag ? { reason: "branch-deleted-upstream" } : {}),
  };
}

function main() {
  const root = projectRoot();
  if (process.env.WT_RETENTION_PUSH_DISABLE === "1") return;
  if (throttled(root)) return;

  let worktrees;
  try {
    worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], root));
  } catch {
    return; // not a git repo, or git unavailable — nothing to do
  }

  // Resolved lazily and at most once per pass: only worktrees that look at
  // risk need it, and a pass where nothing is at risk should stay offline.
  let tagCommits;
  const tagRetained = (worktreePath) => {
    if (tagCommits === undefined) tagCommits = remoteTagCommits(root);
    if (!tagCommits || tagCommits.size === 0) return false;
    const head = headSha(worktreePath);
    return head !== null && tagCommits.has(head);
  };

  // Same lazy-once-per-pass shape as tagRetained: a pass where nothing is at
  // risk never reaches the network.
  let branchNames;
  const deletedUpstream = (worktreePath, branch) => {
    if (!branch) return false;
    if (branchNames === undefined) branchNames = remoteBranchNames(root);
    if (!branchNames) return false; // remote unreachable — no proof, stay branch-first
    if (branchNames.has(branch)) return false;
    return hadRemoteTracking(worktreePath, branch);
  };

  let pushes = 0;
  const skipped = [];
  for (const wt of worktrees) {
    if (pushes >= MAX_PUSHES_PER_PASS) break;
    if (wt.bare) continue;
    const unpushed = unpushedCount(wt.path);
    if (unpushed === 0) continue;
    const branch = branchOf(wt.path);
    // `main` is protected and never the thing at risk; pushing it is exactly
    // the direct-to-main move the repository forbids.
    if (branch === "main") continue;

    // Already archived: the remote advertises a tag at exactly this HEAD, which
    // is the guard's own definition of retained. Re-creating the branch here is
    // what undid twelve deliberate archive-and-delete retirements (cave-nw3hq).
    //
    // Exact HEAD only. A tag that merely CONTAINS this head would also be
    // retention, but proving it needs the tag's commit locally and therefore a
    // fetch — too much for a hook on every tool call. That case still pushes,
    // which costs a redundant ref rather than a lost commit.
    if (tagRetained(wt.path)) {
      skipped.push(branch ?? wt.path);
      continue;
    }

    // The remote deleted this branch — a squash-merged PR head under
    // `delete_branch_on_merge`, in practice. Pushing the branch here SUCCEEDS
    // and resurrects it, which undoes a deliberate deletion, puts the branch
    // back against `branch-cap.yml`'s 40-branch ceiling, and can then lose the
    // retention again when the cap rolls it back. Retain as a tag instead: the
    // guard already reads a pushed tag as retention, and `branch-cap.yml`
    // ignores tags (`ref_type == 'branch'` only).
    //
    // The commits still need retaining — a squash merge puts a DIFFERENT
    // commit on main, so this head is on no remote ref at all (cave-fud4p).
    const preferTag = deletedUpstream(wt.path, branch);

    pushes += 1;
    try {
      record(root, { worktree: wt.path, unpushed, ...retain(wt.path, root, branch, { preferTag }) });
    } catch (error) {
      record(root, {
        verdict: "retention-failed",
        worktree: wt.path,
        branch,
        unpushed,
        error: String(error?.message ?? error).slice(0, 300),
      });
    }
  }

  // One summary line, not one per worktree. A skip is a steady state — an
  // archived branch whose worktree still exists stays skipped every pass — so
  // logging each one individually would write a line a minute per worktree
  // forever. The count is what tells you the rule is doing something.
  if (skipped.length > 0) {
    record(root, {
      verdict: "skipped-tag-retained",
      count: skipped.length,
      branches: skipped.slice(0, 10),
    });
  }
}

// Real-path comparison, matching worktree-autolock.mjs: a naive URL/argv
// comparison breaks on paths with spaces and on macOS symlinked /tmp, and a
// guard that silently never runs is the worst outcome.
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  try {
    main();
  } catch {
    // advisory hook: never fail the tool call
  }
  process.exit(0);
}

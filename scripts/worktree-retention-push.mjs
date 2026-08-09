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

// Commits reachable from HEAD but from no remote-tracking ref — the same
// "retained on a remote" test the guard and the autolock hook apply.
export function unpushedCount(worktreePath) {
  try {
    const n = Number(git(["rev-list", "--count", "HEAD", "--not", "--remotes"], worktreePath).trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0; // unborn HEAD, or unreadable mid-creation — leave it alone
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
export function retain(worktreePath, root, branch) {
  const sha = git(["rev-parse", "HEAD"], worktreePath).trim();
  if (branch) {
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
  return { verdict: "pushed-tag", branch, sha, tag };
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

  let pushes = 0;
  for (const wt of worktrees) {
    if (pushes >= MAX_PUSHES_PER_PASS) break;
    if (wt.bare) continue;
    const unpushed = unpushedCount(wt.path);
    if (unpushed === 0) continue;
    const branch = branchOf(wt.path);
    // `main` is protected and never the thing at risk; pushing it is exactly
    // the direct-to-main move the repository forbids.
    if (branch === "main") continue;
    pushes += 1;
    try {
      record(root, { worktree: wt.path, unpushed, ...retain(wt.path, root, branch) });
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

#!/usr/bin/env node
// Auto-lock worktrees that hold work a removal would destroy.
//
// `git worktree lock` is the only mechanism that survives an actor outside
// Claude Code. `scripts/worktree-guard.mjs` blocks destructive Bash *from a
// Claude session*; it never sees GitHub Desktop, which on 2026-08-03 executed
// 18 `git worktree remove` calls (8 with a single `--force`) and 114 direct
// pushes to `main`. Git refuses to remove a locked worktree unless `--force`
// is given TWICE — Desktop has never escalated past one — so a lock defeats
// every removal actually observed.
//
// Locking by hand is a snapshot: a worktree created a minute later is
// unprotected. This runs as a PreToolUse hook so protection re-applies on its
// own as worktrees appear.
//
// Deliberately does NOT lock clean, fully-pushed worktrees. Removing one of
// those loses nothing (the branch and its commits outlive the worktree), and
// locking it would only force an unlock during routine cleanup. Same
// philosophy as the guard, which lets clean+pushed cleanup pass silently.
//
// Advisory only: this never blocks a tool call and always exits 0.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const THROTTLE_MS = 60_000;
const REASON_PREFIX = "auto-locked";

function projectRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

// `git worktree list --porcelain` emits blank-line-separated records. Only the
// `worktree` line is guaranteed; `locked` appears with or without a reason.
export function parseWorktrees(porcelain) {
  const records = [];
  let current = null;
  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), locked: false, bare: false };
      records.push(current);
      continue;
    }
    if (!current) continue;
    if (line === "locked" || line.startsWith("locked ")) current.locked = true;
    if (line === "bare") current.bare = true;
  }
  return records;
}

// At risk = a removal would destroy something unrecoverable.
//   dirty            → uncommitted edits exist nowhere else
//   commits off-remote → committed but on neither a remote branch nor a
//                        remote tag
//
// `rev-list HEAD --not --remotes` alone is NOT the test the guard applies, and
// the comment that claimed it was is how this hook came to fight the
// documented retirement route (cave-qbr34). `--remotes` is refs/remotes/*,
// which is remote-tracking BRANCHES; git keeps no remote-tracking refs for tags
// at all. So a branch retired the recommended way — archived as a pushed tag,
// then deleted — read as unretained, was re-locked on the next tool call, and
// could never be removed. Two `beads:worktrees:apply` runs were defeated by
// exactly this, and WT_AUTOLOCK_DISABLE=1 does not help: the hook fires per
// tool call, so a unit unlocked in one call is re-locked before the next.
//
// The missing half is `remoteTagCommits`, which asks the remote what tags it
// actually has — the same helper `worktree-retention-push.mjs` already uses for
// this exact blind spot (cave-nw3hq, where it re-created twelve branches it had
// just been asked to retire). Note what is deliberately NOT used: `--tags`
// would count LOCAL tags, and a local-only tag is not retention — it dies with
// the checkout, which is the hole the guard exists to close.
export function riskOf(worktreePath, tagRetained = () => false) {
  let dirty = 0;
  let unpushed = 0;
  try {
    dirty = git(["status", "--porcelain"], worktreePath).split("\n").filter(Boolean).length;
  } catch {
    return null; // unreadable (mid-creation, or a dead registration) — leave it alone
  }
  try {
    unpushed = Number(
      git(["rev-list", "--count", "HEAD", "--not", "--remotes"], worktreePath).trim(),
    );
    if (!Number.isFinite(unpushed)) unpushed = 0;
  } catch {
    unpushed = 0; // detached/unborn HEAD — dirtiness alone decides
  }
  // Only asked once the branch test already says "unretained", so a pass with
  // nothing at risk stays offline. An unreachable remote leaves `unpushed`
  // standing and the tree locked: a lock is reversible, while treating an
  // unanswerable question as "retained" hands out the one verdict that permits
  // destruction.
  if (unpushed > 0 && tagRetained(worktreePath)) unpushed = 0;
  if (dirty === 0 && unpushed === 0) return null;
  return { dirty, unpushed };
}

// Commit oids the REMOTE holds under a tag, HEAD included when a tag points at
// it. `ls-remote` prints both the tag object and its peeled `^{}` commit on
// separate lines; collecting every oid covers annotated and lightweight tags
// without having to tell them apart.
//
// Deliberately duplicated from `worktree-retention-push.mjs` rather than
// imported. Every hook in this directory loads standalone — none imports a
// sibling — and the symlink test copies THIS FILE ALONE into a temp directory
// to prove the hook still fires. An unresolvable import would throw at load,
// and a guard that silently never runs is the worst outcome available here
// (see the isDirectRun comment below). Keep the two in step by hand; both name
// each other.
export function remoteTagCommits(worktreePath) {
  try {
    const output = git(["ls-remote", "--tags", "origin"], worktreePath);
    const oids = new Set();
    for (const line of output.split("\n")) {
      const oid = line.slice(0, 40);
      if (/^[0-9a-f]{40}$/.test(oid)) oids.add(oid);
    }
    return oids;
  } catch {
    return null; // offline or no remote — the caller keeps the tree locked
  }
}

export function headShaOf(worktreePath) {
  try {
    return git(["rev-parse", "HEAD"], worktreePath).trim() || null;
  } catch {
    return null;
  }
}

export function reasonFor({ dirty, unpushed }, today) {
  const parts = [];
  if (dirty > 0) parts.push(`${dirty} uncommitted path${dirty === 1 ? "" : "s"}`);
  if (unpushed > 0) parts.push(`${unpushed} commit${unpushed === 1 ? "" : "s"} not on any remote`);
  return (
    `${REASON_PREFIX} ${today}: ${parts.join(", ")} — a removal would lose this. ` +
    `Unlock when you are done: git worktree unlock <path>`
  );
}

function throttled(root) {
  const stamp = path.join(root, ".claude", "worktree-autolock.stamp");
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
      path.join(root, ".claude", "worktree-autolock.log"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  } catch {
    // logging must never break a tool call
  }
}

function main() {
  const root = projectRoot();
  if (process.env.WT_AUTOLOCK_DISABLE === "1") return;
  if (throttled(root)) return;

  let worktrees;
  try {
    worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], root));
  } catch {
    return; // not a git repo, or git unavailable — nothing to do
  }

  // Resolved lazily and at most once per pass, matching the retention-push
  // hook: only a worktree the branch test already calls unretained needs it, so
  // a pass where everything is pushed never touches the network.
  let tagCommits;
  const tagRetained = (worktreePath) => {
    if (tagCommits === undefined) tagCommits = remoteTagCommits(root);
    if (!tagCommits || tagCommits.size === 0) return false;
    const head = headShaOf(worktreePath);
    return head !== null && tagCommits.has(head);
  };

  // The first record is the main working tree; git refuses to lock it.
  for (const wt of worktrees.slice(1)) {
    if (wt.locked || wt.bare) continue;
    const risk = riskOf(wt.path, tagRetained);
    if (!risk) continue;
    const today = new Date().toISOString().slice(0, 10);
    try {
      git(["worktree", "lock", "--reason", reasonFor(risk, today), wt.path], root);
      record(root, { verdict: "locked", worktree: wt.path, ...risk });
    } catch (error) {
      record(root, { verdict: "lock-failed", worktree: wt.path, error: String(error?.message ?? error) });
    }
  }
}

// "Am I being run directly?" — compared as REAL paths, not as URL strings, the
// same way `check-beads-jsonl-duplicates.mjs` does it. The naive
// `import.meta.url === \`file://${process.argv[1]}\`` fails two ways here, and
// both make the hook silently never run — the worst outcome for a guard, since
// worktrees would look protected while nothing locked them:
//   1. no percent-encoding — a checkout under a path with a space gives
//      `file:///tmp/a b/x.mjs` while import.meta.url is `file:///tmp/a%20b/x.mjs`;
//   2. symlinks — on macOS `/tmp` is a symlink to `/private/tmp`, so argv[1]
//      can be `/tmp/...` while import.meta.url resolves to `/private/tmp/...`.
// realpathSync on both sides collapses both cases.
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Importable for tests; only acts when run as the hook itself. The hook's JSON
// payload on stdin is deliberately left unread — nothing here depends on which
// Bash command triggered it, and reading stdin on import would block a test
// attached to a TTY.
if (isDirectRun()) {
  try {
    main();
  } catch {
    // advisory hook: never fail the tool call
  }
  process.exit(0);
}

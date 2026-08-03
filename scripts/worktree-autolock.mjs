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
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

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
//   commits off-remote → committed but not yet on any remote
// `rev-list HEAD --not --remotes` counts commits absent from every remote ref,
// which is the same "retained on a remote" test the guard applies.
export function riskOf(worktreePath) {
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
  if (dirty === 0 && unpushed === 0) return null;
  return { dirty, unpushed };
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

  // The first record is the main working tree; git refuses to lock it.
  for (const wt of worktrees.slice(1)) {
    if (wt.locked || wt.bare) continue;
    const risk = riskOf(wt.path);
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

// Importable for tests; only acts when run as the hook itself. The hook's JSON
// payload on stdin is deliberately left unread — nothing here depends on which
// Bash command triggered it, and reading stdin on import would block a test
// attached to a TTY.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch {
    // advisory hook: never fail the tool call
  }
  process.exit(0);
}

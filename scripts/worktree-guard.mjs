#!/usr/bin/env node
/**
 * worktree-guard.mjs — PreToolUse hook (matcher: Bash) that blocks the
 * destructive-op class of cross-session damage (docs/multi-session-coordination.md §5).
 *
 * Incident that prompted this (2026-07-03): an actor pushed another session's
 * in-progress branch, merged it as PR #2290, then ran the standard post-merge
 * cleanup — `git worktree remove` + `git branch -D` — destroying the owning
 * session's worktree mid-edit. Every uncommitted change was lost. The same husk
 * pattern (worktree gutted while a dev server / tsc still ran inside it) had
 * already hit `.worktrees/library-worldclass-ux` and `.worktrees/split-collapse-*`.
 * A sibling incident (#2286) chained `git push origin --delete` after a FAILED
 * merge, which auto-closed the still-open PR.
 *
 * Unlike surface-claim-guard (advisory), this hook BLOCKS (exit 2) — these ops
 * destroy unrecoverable state, and every blocked case is either a mistake or a
 * one-keystroke bypass away:
 *
 *   • `git worktree remove <path>` / `rm -rf .worktrees/<name>` (the worktree
 *     ROOT, not paths inside it) is blocked when the worktree is DIRTY or its
 *     HEAD exists on no remote ref — i.e. destruction would orphan real work.
 *     Husk dirs (no .git link) and clean+pushed worktrees pass silently, so
 *     post-merge cleanup and husk GC stay frictionless.
 *   • `git branch -D <name>` is blocked when the branch tip is not contained in
 *     any remote-tracking ref (deleting it would orphan unpushed commits).
 *   • `git push <remote> --delete <branch>` (or `push <remote> :<branch>`) is
 *     blocked when an OPEN PR still has that head (deleting the branch closes
 *     the PR — the #2286 failure). Needs `gh` + network; fails OPEN.
 *
 * Deliberate destruction is allowed by prefixing the command with
 * `WT_GUARD_BYPASS=1 ` — the guard only ensures it can't happen by accident.
 * On any internal error the guard exits 0: a hook bug must never brick Bash.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const BYPASS = "WT_GUARD_BYPASS=1";
/** Fast pre-filter: commands that can't possibly match skip all work. */
const INTEREST = /worktree\s+remove|\.worktrees\b|branch\s+(?:-D|-fd|-df|--delete\s+--force)|push\b[^|;&]*(?:--delete|\s:\S)/;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stderr.write(
    `⛔ worktree-guard blocked this command.\n${reason}\n` +
      `If this destruction is deliberate, re-run prefixed with \`${BYPASS} \` — but first make sure ` +
      `no live session owns this work (docs/multi-session-coordination.md §5; ` +
      `on 2026-07-03 a "cleanup" like this destroyed another session's in-progress worktree).`,
  );
  process.exit(2);
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
}

/** Tokens of one shell segment, minus quotes. Good enough for git/rm argv. */
function tokens(segment) {
  return (segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((t) => t.replace(/^['"]|['"]$/g, ""));
}

/** Split a compound command on unquoted |, ;, &&, || — coarse but sufficient. */
function segments(command) {
  return command.split(/\|\||&&|[;|]/).map((s) => s.trim()).filter(Boolean);
}

/** Absolute path of a candidate target, resolved against the hook cwd. */
function resolveTarget(raw, cwd) {
  const clean = raw.replace(/\/+$/, "");
  return path.isAbsolute(clean) ? clean : path.resolve(cwd, clean);
}

/**
 * Classify a candidate path: a `.worktrees/<name>` ROOT, the whole
 * `.worktrees` CONTAINER, or null (deeper paths are the owner's own business).
 */
function worktreeRoot(abs) {
  const parts = abs.split(path.sep);
  const i = parts.lastIndexOf(".worktrees");
  if (i === -1) return null;
  if (i === parts.length - 1) return { container: abs };
  return i === parts.length - 2 ? { root: abs } : null;
}

/** "" = safe to destroy; otherwise a human reason it is not. */
function destructionRisk(wtPath) {
  if (!existsSync(wtPath)) return "";
  if (!existsSync(path.join(wtPath, ".git"))) return ""; // husk — GC freely
  try {
    if (!statSync(wtPath).isDirectory()) return "";
    const dirty = git(["-C", wtPath, "status", "--porcelain"], undefined).trim();
    if (dirty) {
      const n = dirty.split("\n").length;
      return `\`${wtPath}\` has ${n} uncommitted change(s) — a session may be mid-task in it.`;
    }
    const head = git(["-C", wtPath, "rev-parse", "HEAD"], undefined).trim();
    const onRemote = git(["-C", wtPath, "branch", "-r", "--contains", head], undefined).trim();
    if (!onRemote) return `\`${wtPath}\` HEAD (${head.slice(0, 8)}) exists on NO remote ref — removing it orphans unpushed commits.`;
    return "";
  } catch {
    return ""; // can't assess (mid-teardown, permissions) — don't brick cleanup
  }
}

function checkWorktreeRemove(seg, cwd) {
  const m = seg.match(/\bgit\b.*\bworktree\s+remove\s+(.*)$/);
  if (!m) return;
  for (const tok of tokens(m[1])) {
    if (tok.startsWith("-")) continue;
    const risk = destructionRisk(resolveTarget(tok, cwd));
    if (risk) block(`\`git worktree remove\` targets live work:\n${risk}`);
  }
}

function checkRmRf(seg, cwd) {
  const toks = tokens(seg);
  if (toks[0] !== "rm") return;
  const flags = toks.filter((t) => t.startsWith("-")).join("");
  if (!(flags.includes("r") && flags.includes("f")) && !flags.includes("R")) return;
  for (const tok of toks.slice(1)) {
    if (tok.startsWith("-")) continue;
    if (!tok.includes(".worktrees")) continue;
    const hit = worktreeRoot(resolveTarget(tok, cwd));
    if (!hit) continue; // a path INSIDE a worktree — its owner's business
    if (hit.root) {
      const risk = destructionRisk(hit.root);
      if (risk) block(`\`rm -rf\` targets a live worktree root:\n${risk}`);
    } else if (hit.container && existsSync(hit.container)) {
      // Deleting ALL worktrees at once — block if any child holds live work.
      try {
        for (const child of readdirSync(hit.container)) {
          const risk = destructionRisk(path.join(hit.container, child));
          if (risk) block(`\`rm -rf ${tok}\` wipes every worktree, including live work:\n${risk}`);
        }
      } catch {
        /* unreadable container — allow */
      }
    }
  }
}

function checkBranchDelete(seg, cwd) {
  const m = seg.match(/\bgit\b.*\bbranch\s+(?:-D|-fd|-df|--delete\s+--force)\s+(.*)$/);
  if (!m) return;
  for (const name of tokens(m[1])) {
    if (name.startsWith("-")) continue;
    try {
      const tip = git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], cwd).trim();
      if (!tip) continue;
      const onRemote = git(["branch", "-r", "--contains", tip], cwd).trim();
      if (!onRemote) {
        block(
          `\`git branch -D ${name}\` would orphan unpushed commits: its tip (${tip.slice(0, 8)}) exists on no remote ref.\n` +
            `Push the branch first (\`git push -u origin ${name}\`) or confirm the commits are disposable.`,
        );
      }
    } catch {
      /* branch missing or git unavailable — allow */
    }
  }
}

function checkRemoteBranchDelete(seg, cwd) {
  const del = seg.match(/\bgit\b.*\bpush\b[^|;&]*?--delete\s+(.+)$/);
  const refspec = seg.match(/\bgit\b.*\bpush\b\s+\S+\s+:(\S+)/);
  const names = [];
  if (del) {
    // `--delete` may come before or after the remote name — filter remotes out.
    let remotes = [];
    try {
      remotes = git(["remote"], cwd).trim().split("\n").filter(Boolean);
    } catch {
      remotes = ["origin"];
    }
    names.push(...tokens(del[1]).filter((t) => !t.startsWith("-") && !remotes.includes(t)));
  }
  if (refspec) names.push(refspec[1]);
  for (const name of names) {
    try {
      const out = execFileSync("gh", ["pr", "list", "--head", name, "--state", "open", "--json", "number"], {
        cwd,
        encoding: "utf8",
        timeout: 8000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const open = JSON.parse(out || "[]");
      if (Array.isArray(open) && open.length > 0) {
        block(
          `Deleting remote branch \`${name}\` would CLOSE still-open PR #${open[0].number} (the #2286 failure: ` +
            `a chained cleanup deleted the branch after a merge that had actually FAILED).\n` +
            `Verify the PR is MERGED first: \`gh pr view ${open[0].number} --json state\`.`,
        );
      }
    } catch {
      /* gh missing / offline / not a repo — fail open */
    }
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return allow();
  }
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !INTEREST.test(command)) return allow();
  if (command.includes(BYPASS)) return allow();
  const cwd =
    (typeof input.cwd === "string" && input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  for (const seg of segments(command)) {
    checkWorktreeRemove(seg, cwd);
    checkRmRf(seg, cwd);
    checkBranchDelete(seg, cwd);
    checkRemoteBranchDelete(seg, cwd);
  }
  return allow();
}

try {
  main();
} catch {
  allow(); // a guard bug must never brick every Bash call
}

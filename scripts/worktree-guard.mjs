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
 *
 * "Retained" means a remote BRANCH or a TAG that is present on a remote. Tags
 * count because archiving a branch as a signed, pushed tag preserves its OIDs
 * more durably than a branch does — merging deletes the branch, never the tag.
 * Requiring a branch made the guard block six provably-archived cleanups during
 * one sweep (2026-07-29), and six bypasses to delete preserved work is how the
 * bypass stops being read. A LOCAL-only tag never counts: it dies with the
 * machine. Verifying a tag is remote needs the network (git keeps no
 * remote-tracking refs for tags), and that probe fails CLOSED — unlike the
 * warn-only probes here, it gates deletion, so "cannot verify" must not read as
 * "verified".
 *   • `git push <remote> --delete <branch>` (or `push <remote> :<branch>`) is
 *     blocked when an OPEN PR still has that head (deleting the branch closes
 *     the PR — the #2286 failure). Needs `gh` + network; fails OPEN.
 *   • `mv .worktrees/<name> <elsewhere>` is blocked on the same risk test:
 *     git's admin file keeps pointing at the old path, so moving a live
 *     worktree strands its work exactly like deleting it would.
 *
 * Paths are resolved against the SEGMENT's effective cwd, which both a leading
 * `cd <dir> &&` and git's `-C <dir>` move. Resolving against the hook's cwd
 * instead made those forms silently unguarded (cave-6d2dp).
 *
 * Deliberate destruction is allowed by prefixing the command with
 * `WT_GUARD_BYPASS=1 ` — the guard only ensures it can't happen by accident.
 * Honoured bypasses AND blocked attempts are appended to
 * `.claude/worktree-guard-bypass.log` (gitignored, one JSON line each with a
 * `verdict` field) so a later post-mortem can tell a deliberate override from
 * a gap in the guard — the question cave-boor8 could not answer. Blocks are
 * recorded too because their absence is itself evidence: a worktree that was
 * never the subject of a block or a bypass yet disappeared was destroyed by
 * something that does not route through the hook at all (external terminal,
 * editor, automation) — the one hole no PreToolUse hook can close.
 * On any internal error the guard exits 0: a hook bug must never brick Bash.
 */

import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
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

/** Set once in main() so block() can record what it refused. */
const CTX = { command: null, cwd: null, session: null };

function block(reason) {
  recordEvent("block", reason);
  process.stderr.write(
    `⛔ worktree-guard blocked this command.\n${reason}\n` +
      `If this destruction is deliberate, re-run prefixed with \`${BYPASS} \` — but first make sure ` +
      `no live session owns this work (docs/multi-session-coordination.md §5; ` +
      `on 2026-07-03 a "cleanup" like this destroyed another session's in-progress worktree).`,
  );
  process.exit(2);
}

/**
 * Record every honoured bypass AND every block.
 *
 * On 2026-07-29 a worktree holding 3 uncommitted files was destroyed and the
 * post-mortem (cave-boor8) could not establish whether the guard had been
 * bypassed or circumvented — the bypass path left no trace at all. Appends
 * here make that question answerable: a bypass entry names the deliberate
 * override; a block entry followed by the worktree's disappearance names an
 * actor that retried OUTSIDE the hook; and no entry at all means the
 * destruction never routed through Bash — the unhookable hole. Best-effort by
 * construction: any failure is swallowed, because refusing a command over a
 * logging problem would be a worse bug than the missing record.
 */
function recordEvent(verdict, reason) {
  try {
    if (typeof CTX.command !== "string") return;
    const root = process.env.CLAUDE_PROJECT_DIR || CTX.cwd;
    const line = `${JSON.stringify({
      at: new Date().toISOString(),
      verdict,
      session: CTX.session ?? null,
      cwd: CTX.cwd,
      command: CTX.command.length > 500 ? `${CTX.command.slice(0, 500)}…` : CTX.command,
      ...(reason ? { reason: reason.length > 300 ? `${reason.slice(0, 300)}…` : reason } : {}),
    })}\n`;
    // .claude/* is gitignored (except settings.json), so this never enters the repo.
    appendFileSync(path.join(root, ".claude", "worktree-guard-bypass.log"), line);
  } catch {
    /* logging must never block a command */
  }
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
 * The directory a segment's relative paths actually resolve against.
 *
 * Two things move it, and missing either let a real removal through: a leading
 * `cd <dir> &&` in the same compound command, and git's own `-C <dir>`. Before
 * this, `cd .worktrees && git worktree remove x` (or `git -C <repo> worktree
 * remove x`) resolved `x` against the HOOK's cwd, so destructionRisk() stat'd a
 * path that didn't exist, returned "safe", and the removal sailed through.
 */
function cdTargetOf(seg) {
  const m = seg.match(/^cd\s+(?!-)(\S+|"[^"]*"|'[^']*')\s*$/);
  return m ? m[1].replace(/^['"]|['"]$/g, "") : null;
}

/** `-C <dir>` (repeatable in git, applied left to right) for one segment. */
function gitDashCDir(toks, cwd) {
  let dir = cwd;
  for (let i = 0; i < toks.length - 1; i++) {
    if (toks[i] === "-C") dir = resolveTarget(toks[i + 1], dir);
  }
  return dir;
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
/** PIDs from this process up to init — a hook that blocked on its OWN shell's
 *  cwd would make every in-worktree cleanup impossible. */
function ownAncestry() {
  const mine = new Set();
  let pid = process.pid;
  for (let hops = 0; hops < 32 && pid > 1; hops += 1) {
    mine.add(String(pid));
    try {
      const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 });
      const parent = Number.parseInt(out.trim(), 10);
      if (!Number.isFinite(parent) || parent <= 1) break;
      pid = parent;
    } catch {
      break;
    }
  }
  return mine;
}

/** Processes whose cwd sits inside `wtPath`.
 *
 *  `git status` only sees a session that has SAVED edits. A session driving the
 *  worktree by absolute path — editing files in it while its own cwd is the
 *  primary checkout, or running `pnpm test:app` in it — leaves a clean, pushed
 *  worktree that this guard used to wave through. That is the husk case named
 *  at the top of this file (a worktree gutted while a dev server or tsc still
 *  ran inside it), and it is the one shape the earlier checks cannot see.
 *
 *  One `lsof` over cwd descriptors only: no directory walk, so node_modules
 *  costs nothing. Fails open like every other probe here — a guard that bricks
 *  Bash when lsof is missing or slow is worse than one that misses a case. */
function liveProcesses(wtPath) {
  // lsof reports ITSELF, and a child inherits this process's cwd — so cleaning
  // up a worktree while standing in it made the guard block its own caller
  // ("1 process(es) are still working in it: pid N (lsof)"). ownAncestry()
  // cannot help: the probe is a DESCENDANT of the guard, and it has already
  // exited by the time any ps walk could classify it.
  //
  // Running the probe from the filesystem root is the fix that holds
  // everywhere: its cwd then cannot match the worktree prefix no matter how
  // many helpers it forks (some lsof builds do), which pid bookkeeping alone
  // would miss. Scanning is system-wide, so its own cwd does not affect output.
  // spawnSync additionally exposes the pid, kept below as a cheap backstop.
  const probe = spawnSync("lsof", ["-d", "cwd", "-F", "pcn"], {
    cwd: path.parse(process.cwd()).root || path.sep,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  // lsof exits non-zero when some processes are unreadable; keep partial output.
  const out = typeof probe.stdout === "string" ? probe.stdout : "";
  if (!out) return [];
  const mine = ownAncestry();
  if (probe.pid) mine.add(String(probe.pid));
  // The kernel hands lsof the CANONICAL path, so `/var/...` on macOS comes back
  // as `/private/var/...`. Comparing the caller's spelling against it silently
  // matches nothing — the check would look installed and catch zero cases.
  let root = wtPath;
  try {
    root = realpathSync(wtPath);
  } catch {
    /* unreadable — fall back to the literal path */
  }
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  const hits = [];
  let pid = "";
  let cmd = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) {
      pid = line.slice(1);
      cmd = "";
    } else if (line.startsWith("c")) {
      cmd = line.slice(1);
    } else if (line.startsWith("n")) {
      const dir = line.slice(1);
      if (dir !== root && !dir.startsWith(prefix)) continue;
      if (mine.has(pid)) continue;
      if (!hits.some((h) => h.pid === pid)) hits.push({ pid, cmd });
    }
  }
  return hits;
}

/** Tag names present on ANY configured remote, fetched at most once per run.
 *
 *  Git keeps no remote-tracking refs for tags, so there is no offline way to
 *  tell a pushed tag from a local one — and the difference is the whole point,
 *  since a local tag dies with the machine. One `ls-remote` per remote answers
 *  it for every tag at once. Affordable here because this only runs when a
 *  destructive command is already in flight, never on the hot edit path.
 *
 *  Fails CLOSED: if ls-remote errors (offline, auth, timeout) the set stays
 *  empty, so no tag is credited and the guard blocks. Every other probe in this
 *  file fails open, but those decide whether to *warn*; this one decides whether
 *  deletion is safe, and "cannot verify" must never read as "verified".
 */
const remoteTagCache = new Map();
function remoteTags(cwd) {
  // Keyed by the repo's COMMON git dir, not by cwd: every worktree of one repo
  // shares one lookup, while a command that reaches into a second repo (via
  // `git -C`) never inherits the first repo's tags.
  let key = cwd || ".";
  try {
    key = git(["-C", cwd || ".", "rev-parse", "--path-format=absolute", "--git-common-dir"], undefined).trim() || key;
  } catch {
    /* not a repo we can identify — fall back to the raw cwd as the key */
  }
  const cached = remoteTagCache.get(key);
  if (cached) return cached;
  const found = new Set();
  remoteTagCache.set(key, found);
  let names = [];
  try {
    names = git(["remote"], cwd).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return found;
  }
  for (const remote of names.slice(0, 4)) {
    try {
      for (const line of git(["ls-remote", "--tags", remote], cwd).split("\n")) {
        const m = /refs\/tags\/(.+?)(?:\^\{\})?$/.exec(line.trim());
        if (m) found.add(m[1]);
      }
    } catch {
      /* this remote is unreachable — credit nothing from it */
    }
  }
  return found;
}

/** Where `oid` is durably retained, or "" if nowhere. A remote branch is the
 *  cheap offline answer; a tag pushed to a remote counts too, and is in fact
 *  the stronger one — merging deletes the branch but never the tag. */
function retainedOnRemote(oid, cwd) {
  try {
    if (git(["branch", "-r", "--contains", oid], cwd).trim()) return "a remote branch";
  } catch {
    /* fall through to tags */
  }
  let tags = [];
  try {
    tags = git(["for-each-ref", "--format=%(refname:short)", "--contains", oid, "refs/tags"], cwd)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return "";
  }
  if (!tags.length) return "";
  const pushed = remoteTags(cwd);
  const hit = tags.find((t) => pushed.has(t));
  return hit ? `remote tag ${hit}` : "";
}

/** Both destructive paths offer the same two ways out, so word them once. */
function retentionAdvice(ref) {
  return (
    `Push it (\`git push -u origin ${ref}\`), or archive the commits as a tag ` +
    `(\`git tag -s archive/${ref.replace(/\//g, "-")} <oid> && git push origin archive/…\`) — ` +
    `a pushed tag counts as retention and outlives the branch.`
  );
}

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
    if (!retainedOnRemote(head, wtPath)) {
      return `\`${wtPath}\` HEAD (${head.slice(0, 8)}) exists on NO remote ref — removing it orphans unpushed commits.`;
    }
    const live = liveProcesses(wtPath);
    if (live.length) {
      const who = live.slice(0, 3).map((h) => `pid ${h.pid} (${h.cmd || "?"})`).join(", ");
      const more = live.length > 3 ? ` and ${live.length - 3} more` : "";
      return `\`${wtPath}\` is clean and pushed, but ${live.length} process(es) are still working in it: ${who}${more}.`;
    }
    return "";
  } catch {
    return ""; // can't assess (mid-teardown, permissions) — don't brick cleanup
  }
}

function checkWorktreeRemove(seg, cwd) {
  const m = seg.match(/\bgit\b.*\bworktree\s+remove\s+(.*)$/);
  if (!m) return;
  const base = gitDashCDir(tokens(seg), cwd);
  for (const tok of tokens(m[1])) {
    if (tok.startsWith("-")) continue;
    const risk = destructionRisk(resolveTarget(tok, base));
    if (risk) block(`\`git worktree remove\` targets live work:\n${risk}`);
  }
}

/**
 * Moving a worktree root is as destructive as deleting it: git's admin file
 * still points at the old path, so the worktree is broken and any uncommitted
 * work is stranded somewhere the owning session will not look. `git worktree
 * move` is the supported operation and is left alone.
 */
function checkMove(seg, cwd) {
  const toks = tokens(seg);
  if (toks[0] !== "mv") return;
  const operands = toks.slice(1).filter((t) => !t.startsWith("-"));
  if (operands.length < 2) return;
  for (const tok of operands.slice(0, -1)) {
    const hit = worktreeRoot(resolveTarget(tok, cwd));
    if (!hit) continue; // a path inside a worktree is the owner's business
    if (hit.root) {
      const risk = destructionRisk(hit.root);
      if (risk) block(`\`mv\` would strand a live worktree (git still points at the old path):\n${risk}`);
    } else if (hit.container && existsSync(hit.container)) {
      // Moving the container strands every child just like removing it does.
      try {
        for (const child of readdirSync(hit.container)) {
          const risk = destructionRisk(path.join(hit.container, child));
          if (risk) block(`\`mv ${tok}\` wipes every worktree, including live work:\n${risk}`);
        }
      } catch {
        /* unreadable container — allow */
      }
    }
  }
}

function checkRmRf(seg, cwd) {
  const toks = tokens(seg);
  if (toks[0] !== "rm") return;
  const flags = toks.filter((t) => t.startsWith("-")).join("");
  if (!(flags.includes("r") && flags.includes("f")) && !flags.includes("R")) return;
  for (const tok of toks.slice(1)) {
    if (tok.startsWith("-")) continue;
    // Classify the RESOLVED path, never the raw token: after `cd .worktrees`
    // the token is a bare name like `feature-x` and a substring test on it
    // silently skips a real worktree root.
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
      if (!retainedOnRemote(tip, cwd)) {
        block(
          `\`git branch -D ${name}\` would orphan unpushed commits: its tip (${tip.slice(0, 8)}) exists on no remote ref.\n` +
            retentionAdvice(name),
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
  const cwd =
    (typeof input.cwd === "string" && input.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  CTX.command = command;
  CTX.cwd = cwd;
  CTX.session = input?.session_id ?? null;
  if (/^\s*WT_GUARD_BYPASS=1(?:\s|$)/.test(command)) {
    recordEvent("bypass", null);
    return allow();
  }

  // Relative paths resolve against the segment's effective cwd, which a leading
  // `cd` in the same compound command moves for everything after it.
  let segCwd = cwd;
  for (const seg of segments(command)) {
    const cdTo = cdTargetOf(seg);
    if (cdTo) {
      segCwd = resolveTarget(cdTo, segCwd);
      continue;
    }
    checkWorktreeRemove(seg, segCwd);
    checkRmRf(seg, segCwd);
    checkMove(seg, segCwd);
    checkBranchDelete(seg, segCwd);
    checkRemoteBranchDelete(seg, segCwd);
  }
  return allow();
}

try {
  main();
} catch {
  allow(); // a guard bug must never brick every Bash call
}

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
 *   • `mv .worktrees/<name> <elsewhere>` is blocked on the same risk test:
 *     git's admin file keeps pointing at the old path, so moving a live
 *     worktree strands its work exactly like deleting it would.
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

const FULL_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const STRICT_GIT_UNSAFE_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_EXEC_PATH",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_PAGER",
  "GIT_LITERAL_PATHSPECS",
  "GIT_GLOB_PATHSPECS",
  "GIT_NOGLOB_PATHSPECS",
  "GIT_ICASE_PATHSPECS",
];

function strictRefuse(reason) {
  process.stderr.write(`worktree-guard strict refusal: ${reason}\n`);
  process.exit(2);
}

function strictGitEnv() {
  const env = { ...process.env };
  for (const key of STRICT_GIT_UNSAFE_ENV) delete env[key];
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_PAGER = "cat";
  return env;
}

function strictGit(args, cwd) {
  const probe = spawnSync("git", args, {
    cwd,
    env: strictGitEnv(),
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.error) throw new Error(`git probe failed: ${probe.error.message}`);
  if (probe.signal) throw new Error(`git probe ended on signal ${probe.signal}`);
  if (probe.status !== 0) throw new Error(`git probe exited ${probe.status}`);
  if (probe.stderr !== "") throw new Error("git probe returned unexpected diagnostics");
  if (typeof probe.stdout !== "string") throw new Error("git probe returned malformed output");
  return probe.stdout;
}

function strictSingleOid(output, label) {
  const lines = output.split("\n");
  if (lines.length !== 2 || lines[1] !== "" || !FULL_OID.test(lines[0])) {
    throw new Error(`${label} returned a malformed full OID`);
  }
  return lines[0];
}

function strictRegisteredWorktree(target) {
  const output = strictGit(["-C", target, "worktree", "list", "--porcelain", "-z"]);
  if (!output.endsWith("\0\0")) throw new Error("worktree registry returned malformed output");
  const records = output.slice(0, -2).split("\0\0");
  let found = false;
  for (const record of records) {
    const fields = record.split("\0");
    if (!fields[0]?.startsWith("worktree ") || fields[0].length === "worktree ".length) {
      throw new Error("worktree registry returned a malformed record");
    }
    const registeredPath = fields[0].slice("worktree ".length);
    if (!path.isAbsolute(registeredPath) || fields.slice(1).some((field) => !field)) {
      throw new Error("worktree registry returned malformed fields");
    }
    if (registeredPath === target) found = true;
  }
  if (!found) throw new Error("target is not an exactly registered worktree");
}

function strictRemoteNames(target) {
  const output = strictGit(["-C", target, "remote"]);
  if (!output.endsWith("\n")) throw new Error("git remote returned malformed output");
  const remotes = output.slice(0, -1).split("\n");
  if (remotes.length === 1 && remotes[0] === "") throw new Error("repository has no configured remotes");
  if (remotes.some((remote) => !remote || /\s/.test(remote)) || new Set(remotes).size !== remotes.length) {
    throw new Error("git remote returned malformed names");
  }
  return remotes;
}

function strictRemoteRefs(output, remote) {
  if (output && !output.endsWith("\n")) throw new Error(`remote ${remote} returned malformed output`);
  const refs = [];
  const seen = new Set();
  for (const line of output ? output.slice(0, -1).split("\n") : []) {
    const match = /^([0-9a-f]+)\t(refs\/(heads|tags)\/(.+))$/.exec(line);
    if (!match || !FULL_OID.test(match[1]) || !match[4] || seen.has(match[2])) {
      throw new Error(`remote ${remote} returned malformed refs`);
    }
    if (match[3] === "heads" && match[4].endsWith("^{}")) {
      throw new Error(`remote ${remote} returned a malformed branch ref`);
    }
    seen.add(match[2]);
    refs.push({ oid: match[1], ref: match[2], kind: match[3], name: match[4] });
  }
  return refs;
}

function strictRetainedOnRemote(target, head) {
  let retained = false;
  for (const remote of strictRemoteNames(target)) {
    const output = strictGit(["-C", target, "ls-remote", "--heads", "--tags", remote]);
    const refs = strictRemoteRefs(output, remote);
    const peeledTags = new Set(
      refs.filter((entry) => entry.kind === "tags" && entry.name.endsWith("^{}"))
        .map((entry) => entry.name.slice(0, -3)),
    );
    for (const entry of refs) {
      if (entry.oid !== head) continue;
      if (entry.kind === "heads") retained = true;
      if (entry.kind === "tags" && entry.name.endsWith("^{}")) retained = true;
      if (entry.kind === "tags" && !entry.name.endsWith("^{}") && !peeledTags.has(entry.name)) retained = true;
    }
  }
  if (!retained) throw new Error("HEAD is not retained by any configured remote");
}

function strictLiveProcesses(target) {
  const testLsof =
    process.env.WT_GUARD_TEST_MODE === "1" && process.env.WT_GUARD_TEST_LSOF_BIN
      ? process.env.WT_GUARD_TEST_LSOF_BIN
      : "lsof";
  const probe = spawnSync(testLsof, ["-d", "cwd", "-F", "pcn"], {
    cwd: path.parse(process.cwd()).root || path.sep,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (probe.error) throw new Error(`lsof probe failed: ${probe.error.message}`);
  if (probe.signal) throw new Error(`lsof probe ended on signal ${probe.signal}`);
  if (probe.status !== 0) throw new Error(`lsof probe exited ${probe.status}`);
  if (probe.stderr !== "") throw new Error("lsof probe returned unexpected diagnostics");
  if (typeof probe.stdout !== "string" || !probe.stdout || !probe.stdout.endsWith("\n")) {
    throw new Error("lsof probe returned malformed output");
  }

  const prefix = target.endsWith(path.sep) ? target : `${target}${path.sep}`;
  let state = "pid";
  let processRecord = null;
  let recordCount = 0;

  for (const line of probe.stdout.slice(0, -1).split("\n")) {
    if (state === "pid") {
      if (!/^p[0-9]+$/.test(line)) throw new Error("lsof probe returned a malformed pid");
      processRecord = { pid: line.slice(1), command: "" };
      state = "command";
    } else if (state === "command") {
      if (!line.startsWith("c") || line.length === 1) throw new Error("lsof probe returned a malformed command");
      processRecord.command = line.slice(1);
      state = "descriptor";
    } else if (state === "descriptor") {
      if (line !== "fcwd") throw new Error("lsof probe returned a malformed cwd descriptor");
      state = "name";
    } else if (state === "name") {
      const cwd = line.slice(1);
      if (!line.startsWith("n") || !cwd || !path.isAbsolute(cwd)) {
        throw new Error("lsof probe returned a malformed cwd name");
      }
      let canonicalCwd;
      try {
        canonicalCwd = realpathSync(cwd);
      } catch (error) {
        throw new Error(`lsof cwd cannot be resolved: ${error.message}`);
      }
      recordCount += 1;
      if (canonicalCwd === target || canonicalCwd.startsWith(prefix)) {
        throw new Error(`process ${processRecord.pid} has cwd inside target`);
      }
      processRecord = null;
      state = "pid";
    } else {
      throw new Error("lsof probe entered an invalid parser state");
    }
  }
  if (state !== "pid" || processRecord) throw new Error("lsof probe returned an incomplete final record");
  if (!recordCount) throw new Error("lsof probe returned no process records");
}

function runStrictWorktreeRemove(args) {
  if (
    args.length !== 4 ||
    args[0] !== "--strict-worktree-remove" ||
    args[2] !== "--expected-head"
  ) {
    throw new Error("expected --strict-worktree-remove <absolute-path> --expected-head <full-oid>");
  }
  const requestedPath = args[1];
  const expectedHead = args[3];
  if (!path.isAbsolute(requestedPath)) throw new Error("target path must be absolute");
  if (!FULL_OID.test(expectedHead)) throw new Error("expected HEAD must be a full OID");

  let target;
  try {
    target = realpathSync(requestedPath);
  } catch (error) {
    throw new Error(`target cannot be resolved: ${error.message}`);
  }
  if (!statSync(target).isDirectory()) throw new Error("target is not a directory");
  strictRegisteredWorktree(target);

  const actualHead = strictSingleOid(
    strictGit(["-C", target, "rev-parse", "--verify", "HEAD"]),
    "git rev-parse HEAD",
  );
  if (actualHead !== expectedHead) throw new Error("target HEAD does not match expected HEAD");

  const status = strictGit([
    "-c", "core.fsmonitor=false",
    "-c", "core.filemode=true",
    "-c", "status.showUntrackedFiles=all",
    "-c", "diff.ignoreSubmodules=none",
    "-c", "status.submoduleSummary=true",
    // Repository-owned .gitignore and .git/info/exclude remain intentionally
    // ignored here; Branch Curator's normative ignored-state proof owns them.
    // Only external/configured excludes are neutralized by this strict barrier.
    "-c", `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
    "-C", target,
    "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none",
  ]);
  if (status !== "") throw new Error("target worktree is not clean");

  strictRetainedOnRemote(target, actualHead);
  strictLiveProcesses(target);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: "strict-worktree-remove",
    path: target,
    head: actualHead,
  })}\n`);
  process.exitCode = 0;
}

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

/** Cache key: the repo's COMMON git dir, so every worktree of one repo shares
 *  one lookup while a command reaching into a second repo (via `git -C`) never
 *  inherits the first repo's tags. */
function repoKey(cwd) {
  try {
    return (
      git(["-C", cwd || ".", "rev-parse", "--path-format=absolute", "--git-common-dir"], undefined).trim() ||
      cwd ||
      "."
    );
  } catch {
    return cwd || "."; // not a repo we can identify — key on the raw cwd
  }
}

function remoteNames(cwd) {
  try {
    return git(["remote"], cwd)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Tag names present on ONE remote, fetched at most once per repo+remote.
 *
 *  Git keeps no remote-tracking refs for tags, so there is no offline way to
 *  tell a pushed tag from a local one — and that difference is the whole point,
 *  since a local tag dies with the machine. One `ls-remote` answers it for every
 *  tag on that remote at once.
 *
 *  Fails CLOSED: if ls-remote errors (offline, auth, timeout) the set stays
 *  empty, so nothing is credited and the guard blocks. Every other probe in this
 *  file fails open, but those decide whether to *warn*; this one decides whether
 *  deletion is safe, and "cannot verify" must never read as "verified".
 */
function tagsOnRemote(cwd, remote) {
  const key = repoKey(cwd);
  let perRemote = remoteTagCache.get(key);
  if (!perRemote) {
    perRemote = new Map();
    remoteTagCache.set(key, perRemote);
  }
  const cached = perRemote.get(remote);
  if (cached) return cached;
  const found = new Set();
  perRemote.set(remote, found);
  try {
    for (const line of git(["ls-remote", "--tags", remote], cwd).split("\n")) {
      const m = /refs\/tags\/(.+?)(?:\^\{\})?$/.exec(line.trim());
      if (m) found.add(m[1]);
    }
  } catch {
    /* this remote is unreachable — credit nothing from it */
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
  // Every remote is probed — an archive tag pushed to a second remote is just as
  // durable as one on origin, and capping the scan would reintroduce exactly the
  // false block this helper exists to remove. Ordered scan with an early return
  // keeps the ordinary single-remote case at one ls-remote.
  for (const remote of remoteNames(cwd)) {
    const pushed = tagsOnRemote(cwd, remote);
    const hit = tags.find((t) => pushed.has(t));
    if (hit) return `remote tag ${hit} on ${remote}`;
  }
  return "";
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

const directArgs = process.argv.slice(2);
if (directArgs.length > 0) {
  try {
    runStrictWorktreeRemove(directArgs);
  } catch (error) {
    strictRefuse(error instanceof Error ? error.message : "unknown strict probe error");
  }
} else {
  try {
    main();
  } catch {
    allow(); // a guard bug must never brick every Bash call
  }
}

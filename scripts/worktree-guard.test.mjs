// Tests for the destructive-op PreToolUse hook (scripts/worktree-guard.mjs).
// The hook must BLOCK (exit 2) destruction of dirty/unpushed worktrees, deletion
// of branches whose tip exists on no remote, and remote-branch deletion while a
// PR is still open — and pass EVERYTHING else silently (exit 0), including husk
// GC, clean+pushed cleanup, paths inside a worktree, the bypass token, and any
// garbage input. A guard bug must never brick Bash.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "worktree-guard.mjs");
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const isWin = process.platform === "win32";
const BYPASS = "WT_GUARD_BYPASS=1";
const STRICT_GIT_ENV_KEYS = [
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

function runHook(command, cwd, extraEnv = {}) {
  const payload = JSON.stringify({ session_id: "test", cwd, tool_name: "Bash", tool_input: { command } });
  return spawnSync("node", [script], {
    input: payload,
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...extraEnv },
  });
}

function runStrict(args, cwd, extraEnv = {}) {
  const env = { ...process.env };
  delete env.WT_GUARD_TEST_MODE;
  delete env.WT_GUARD_TEST_LSOF_BIN;
  for (const key of STRICT_GIT_ENV_KEYS) delete env[key];
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)) delete env[key];
  }
  return spawnSync("node", [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
}

function lsofStub(output = "p4242\ncidle\nfcwd\nn/\n", status = 0, errorOutput = "", name = "lsof-stub") {
  const bin = mkdtempSync(path.join(tmpdir(), "wt-guard-lsof-"));
  const executable = path.join(bin, name);
  writeFileSync(
    executable,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\nprocess.stderr.write(${JSON.stringify(errorOutput)});\nprocess.exit(${status});\n`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

function strictArgs(wt, head) {
  return ["--strict-worktree-remove", wt, "--expected-head", head];
}

function strictEnv(executable = lsofStub()) {
  return { WT_GUARD_TEST_MODE: "1", WT_GUARD_TEST_LSOF_BIN: executable };
}

function gitWrapper(options = {}) {
  const bin = mkdtempSync(path.join(tmpdir(), "wt-guard-git-"));
  const executable = path.join(bin, "git");
  const stateFile = path.join(bin, "state");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const options = ${JSON.stringify(options)};
const args = process.argv.slice(2);
const isLsRemote = args.includes("ls-remote");
const isFetch = args.includes("fetch");
if (isFetch && options.fetchLog) {
  appendFileSync(options.fetchLog, JSON.stringify(args) + "\\n");
}
if (isLsRemote && options.lsRemoteOutput !== undefined) {
  process.stdout.write(options.lsRemoteOutput);
  process.exit(0);
}
if (args.includes("merge-base") && args.includes("--is-ancestor") && options.mergeBaseStatus !== undefined) {
  process.exit(options.mergeBaseStatus);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { encoding: "utf8", env: process.env });
if (result.error) throw result.error;
if (isLsRemote && options.driftRef) {
  const count = existsSync(${JSON.stringify(stateFile)}) ? Number(readFileSync(${JSON.stringify(stateFile)}, "utf8")) : 0;
  writeFileSync(${JSON.stringify(stateFile)}, String(count + 1));
  if (count >= 1) {
    const lines = result.stdout.split("\\n").map((line) =>
      line.endsWith("\\t" + options.driftRef) ? options.driftOid + "\\t" + options.driftRef : line
    );
    result.stdout = lines.join("\\n");
  }
}
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exit(Number.isInteger(result.status) ? result.status : 127);
`,
  );
  chmodSync(executable, 0o755);
  return `${bin}${path.delimiter}${process.env.PATH}`;
}

function fetchCalls(fetchLog) {
  const contents = readFileSync(fetchLog, "utf8");
  return contents ? contents.trimEnd().split("\n").map((line) => JSON.parse(line)) : [];
}

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A real repo with an initial commit, a bare "origin", and one worktree. */
function repoWithWorktree({ push = false, dirty = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "wt-guard-"));
  sh("git", ["init", "-q", "-b", "main"], dir);
  sh("git", ["config", "user.email", "t@t"], dir);
  sh("git", ["config", "user.name", "t"], dir);
  sh("git", ["config", "commit.gpgsign", "false"], dir);
  writeFileSync(path.join(dir, "a.txt"), "a\n");
  sh("git", ["add", "."], dir);
  sh("git", ["commit", "-q", "-m", "init"], dir);
  const bare = mkdtempSync(path.join(tmpdir(), "wt-guard-origin-"));
  // `-b main` so the bare origin's HEAD does not follow the host's
  // init.defaultBranch; this fixture pushes `main` and nothing else.
  sh("git", ["init", "-q", "-b", "main", "--bare", bare], bare);
  sh("git", ["remote", "add", "origin", bare], dir);
  sh("git", ["push", "-q", "-u", "origin", "main"], dir);
  const wt = path.join(dir, ".worktrees", "feature-x");
  sh("git", ["worktree", "add", "-q", "-b", "feature-x", wt], dir);
  writeFileSync(path.join(wt, "b.txt"), "b\n");
  sh("git", ["-C", wt, "add", "."], dir);
  sh("git", ["-C", wt, "commit", "-q", "-m", "wt work"], dir);
  if (push) sh("git", ["-C", wt, "push", "-q", "-u", "origin", "feature-x"], dir);
  if (dirty) writeFileSync(path.join(wt, "c.txt"), "uncommitted\n");
  return { dir, wt, bare };
}

/** A clean feature worktree whose HEAD is retained by a later remote main tip. */
function repoWithMergedWorktreeAndAdvancedMain() {
  const fixture = repoWithWorktree({ push: false });
  const initial = sh("git", ["-C", fixture.dir, "rev-parse", "main^{}"], fixture.dir).trim();
  const featureHead = sh("git", ["-C", fixture.wt, "rev-parse", "HEAD^{}"], fixture.dir).trim();

  sh("git", ["-C", fixture.dir, "merge", "-q", "--ff-only", featureHead], fixture.dir);
  sh("git", ["-C", fixture.dir, "push", "-q", "origin", "main"], fixture.dir);
  writeFileSync(path.join(fixture.dir, "after-merge.txt"), "later remote main work\n");
  sh("git", ["-C", fixture.dir, "add", "after-merge.txt"], fixture.dir);
  sh("git", ["-C", fixture.dir, "commit", "-q", "-m", "advance main after feature merge"], fixture.dir);
  sh("git", ["-C", fixture.dir, "push", "-q", "origin", "main"], fixture.dir);
  const remoteMain = sh("git", ["-C", fixture.dir, "ls-remote", "--heads", "origin", "refs/heads/main"], fixture.dir)
    .split("\t", 1)[0];

  assert.equal(
    spawnSync("git", ["-C", fixture.dir, "merge-base", "--is-ancestor", featureHead, remoteMain]).status,
    0,
    "fixture sanity: feature HEAD is an ancestor of freshly advertised remote main",
  );
  assert.equal(
    sh("git", ["-C", fixture.dir, "ls-remote", "--heads", "origin", "refs/heads/feature-x"], fixture.dir),
    "",
    "fixture sanity: no same-named remote feature ref exists",
  );

  // Keep the tracking ref deliberately stale: the strict guard must prove
  // retention from the fresh advertisement without updating local refs.
  sh("git", ["-C", fixture.dir, "update-ref", "refs/remotes/origin/main", initial], fixture.dir);
  const gitCommonDir = path.resolve(
    fixture.dir,
    sh("git", ["-C", fixture.dir, "rev-parse", "--git-common-dir"], fixture.dir).trim(),
  );
  const fetchHeadPath = path.join(gitCommonDir, "FETCH_HEAD");
  writeFileSync(fetchHeadPath, "sentinel FETCH_HEAD content\n");

  return { ...fixture, featureHead, remoteMain, fetchHeadPath };
}

function repoWithTagRetainedWorktree({ annotated }) {
  const fixture = repoWithWorktree({ push: false });
  const featureHead = sh("git", ["-C", fixture.wt, "rev-parse", "HEAD^{}"], fixture.dir).trim();
  writeFileSync(path.join(fixture.wt, "tagged-later.txt"), "later tag retention\n");
  sh("git", ["-C", fixture.wt, "add", "tagged-later.txt"], fixture.dir);
  sh("git", ["-C", fixture.wt, "commit", "-q", "-m", "later tag retention"], fixture.dir);
  const tagName = annotated ? "archive/annotated-later" : "archive/lightweight-later";
  const tagArgs = annotated
    ? ["-C", fixture.wt, "tag", "-a", tagName, "-m", "retained"]
    : ["-C", fixture.wt, "tag", tagName];
  sh("git", tagArgs, fixture.dir);
  sh("git", ["-C", fixture.wt, "push", "-q", "origin", `refs/tags/${tagName}`], fixture.dir);
  sh("git", ["-C", fixture.wt, "reset", "-q", "--hard", featureHead], fixture.dir);
  return { ...fixture, featureHead, tagName };
}

function gitMetadataSnapshot(dir) {
  const commonDir = sh("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], dir).trim();
  const fetchHead = path.join(commonDir, "FETCH_HEAD");
  return {
    refs: sh("git", ["-C", dir, "for-each-ref", "--format=%(refname)%00%(objectname)"], dir),
    fetchHeadExists: existsSync(fetchHead),
    fetchHead: existsSync(fetchHead) ? readFileSync(fetchHead, "utf8") : null,
  };
}

// ── 1. Removing a DIRTY worktree is blocked ────────────────────────────────────
{
  const { dir, wt } = repoWithWorktree({ push: true, dirty: true });
  for (const cmd of [`git worktree remove ${wt}`, `git worktree remove --force ${wt}`, `rm -rf ${wt}`]) {
    const res = runHook(cmd, dir);
    assert.equal(res.status, 2, `blocks: ${cmd}`);
    assert.match(res.stderr, /uncommitted change/, "explains the dirt");
    assert.match(res.stderr, /WT_GUARD_BYPASS=1/, "offers the deliberate-destruction bypass");
  }
}

// ── 2. Removing a clean worktree whose HEAD is unpushed is blocked ─────────────
{
  const { dir, wt } = repoWithWorktree({ push: false });
  const res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(res.status, 2, "blocks removal of an unpushed worktree");
  assert.match(res.stderr, /NO remote ref/, "explains the orphaned commits");
}

// ── 3. Clean + pushed worktree removal passes silently (normal cleanup) ───────
{
  const { dir, wt } = repoWithWorktree({ push: true });
  const res = runHook(`git worktree remove ${wt} && git branch -D feature-x`, dir);
  assert.equal(res.status, 0, "clean+pushed cleanup is frictionless");
  assert.equal(res.stdout.trim(), "", "and silent");
}

// ── 3b. Clean + pushed, but a process is still working IN it → blocked ────────
// The husk case named in the guard's own header: a session driving a worktree by
// absolute path (or running its test suite there) leaves `git status` clean and
// the branch pushed, so every earlier check waves the removal through while the
// work is still live.
if (!isWin) {
  const { dir, wt } = repoWithWorktree({ push: true });
  const child = execFileSync("node", ["-e", `
    const { spawn } = require("node:child_process");
    const p = spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { cwd: ${JSON.stringify(wt)}, detached: true, stdio: "ignore" });
    p.unref(); console.log(p.pid);
  `], { encoding: "utf8" }).trim();
  try {
    // Give the child a moment to land its cwd.
    execFileSync("node", ["-e", "setTimeout(()=>{}, 400)"]);
    const res = runHook(`git worktree remove ${wt}`, dir);
    assert.equal(res.status, 2, "blocks removal while a process is working inside the worktree");
    assert.match(res.stderr, /still working in it/, "names the live processes");
    // The bypass still wins — the guard advises, it does not imprison.
    const forced = runHook(`${BYPASS} git worktree remove ${wt}`, dir);
    assert.equal(forced.status, 0, "explicit bypass overrides the live-process block");
  } finally {
    try { process.kill(Number(child)); } catch { /* already gone */ }
  }
}

// ── 3c. The guard must not see its OWN probe as live work ────────────────────
// Cleaning up a worktree while standing in it is the single most common
// legitimate case. The guard's lsof child inherits that cwd and lsof reports
// itself, so the guard blocked its own caller with "1 process(es) are still
// working in it: pid <n> (lsof)" — every routine cleanup demanded a bypass,
// which is the one habit a destructive-op guard must never teach.
// ownAncestry() cannot cover this: lsof is a DESCENDANT of the guard, and it
// has already exited by the time any ps walk could classify it.
if (!isWin) {
  const { dir, wt } = repoWithWorktree({ push: true });
  const res = runHook(`git worktree remove ${wt}`, wt);
  // Report the guard's own reason on failure: asserting bare status turns any
  // platform difference into an unreadable "2 !== 0".
  const why = `guard said: ${JSON.stringify(res.stderr)}`;
  assert.doesNotMatch(res.stderr, /still working in it/, `the probe is never reported as live work — ${why}`);
  assert.doesNotMatch(res.stderr, /lsof/, `and is never named as an owner — ${why}`);
  assert.equal(res.status, 0, `cleanup from inside the worktree is not blocked — ${why}`);
}

// ── 3d. A tag ON A REMOTE is retention; a LOCAL-ONLY tag is not ──────────────
// Archiving a branch as a signed tag and pushing it preserves the OIDs more
// durably than a branch does — a tag is not auto-deleted on merge. The guard
// only consulted `branch -r --contains`, so on 2026-07-29 a worktree sweep that
// archived seven branches as pushed tags had to bypass the guard six times to
// clean them up. Six bypasses to delete provably-preserved work is how the
// bypass becomes a reflex.
// The local/remote distinction is the whole point: a local tag dies with the
// machine, so it must NOT count.
{
  const { dir, wt } = repoWithWorktree({ push: false });
  const tip = sh("git", ["-C", wt, "rev-parse", "HEAD"], dir).trim();

  // Local-only tag → still blocked.
  sh("git", ["-C", wt, "tag", "-a", "archive/local-only", "-m", "local", tip], dir);
  let res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(res.status, 2, "a LOCAL-only tag is not retention — still blocked");
  assert.match(res.stderr, /NO remote ref/, "and says so");
  res = runHook(`git branch -D feature-x`, wt);
  assert.equal(res.status, 2, "branch -D also blocked by a local-only tag");

  // Push the tag → now retained, both ops pass.
  sh("git", ["-C", wt, "push", "-q", "origin", "archive/local-only"], dir);
  res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(
    res.status,
    0,
    `a tag pushed to a remote IS retention — guard said: ${JSON.stringify(res.stderr)}`,
  );
  res = runHook(`git branch -D feature-x`, wt);
  assert.equal(
    res.status,
    0,
    `branch -D allowed once the tip is on a remote tag — guard said: ${JSON.stringify(res.stderr)}`,
  );
}

// ── 3d-ii. Unverifiable retention must read as NO retention ──────────────────
// The tag probe needs the network (git keeps no remote-tracking ref for tags).
// If that lookup fails, the guard must block: "cannot verify" is not "verified",
// and this probe gates deletion rather than a warning.
{
  const { dir, wt } = repoWithWorktree({ push: false });
  const tip = sh("git", ["-C", wt, "rev-parse", "HEAD"], dir).trim();
  sh("git", ["-C", wt, "tag", "-a", "archive/pushed", "-m", "a", tip], dir);
  sh("git", ["-C", wt, "push", "-q", "origin", "archive/pushed"], dir);
  assert.equal(runHook(`git worktree remove ${wt}`, dir).status, 0, "baseline: pushed tag allows removal");
  sh("git", ["-C", dir, "remote", "set-url", "origin", path.join(dir, "does-not-exist.git")], dir);
  const res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(res.status, 2, "an unreachable remote credits no tag — blocks instead of assuming");
  assert.match(res.stderr, /NO remote ref/);
}

// ── 3d-iii. A lightweight tag counts the same as an annotated one ─────────────
{
  const { dir, wt } = repoWithWorktree({ push: false });
  sh("git", ["-C", wt, "tag", "archive/lightweight"], dir);
  sh("git", ["-C", wt, "push", "-q", "origin", "archive/lightweight"], dir);
  const res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(res.status, 0, `lightweight tag is retention too — guard said: ${JSON.stringify(res.stderr)}`);
}

// ── 3d-iv. EVERY remote is probed, not just the first ────────────────────────
// A tag pushed to a second remote is exactly as durable as one on origin, so
// capping the scan would reintroduce the false block this helper removes. The
// scan is ordered with an early return, so the ordinary one-remote case still
// costs a single ls-remote; this pins that the cap is gone.
// Five extra remotes with the tag on the LAST one: this is the case an earlier
// draft got wrong by scanning only the first four, and a 2-remote fixture would
// not have caught it.
if (!isWin) {
  const { dir, wt } = repoWithWorktree({ push: false });
  let last = "";
  for (const n of ["r1", "r2", "r3", "r4", "r5"]) {
    last = mkdtempSync(path.join(tmpdir(), `wt-guard-${n}-`));
    sh("git", ["init", "-q", "-b", "main", "--bare", last], last);
    sh("git", ["-C", dir, "remote", "add", n, last], dir);
  }
  sh("git", ["-C", wt, "tag", "-a", "archive/last-remote", "-m", "a"], dir);
  sh("git", ["-C", wt, "push", "-q", "r5", "archive/last-remote"], dir);
  const res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(
    res.status,
    0,
    `a tag on the 6th remote is retention too — guard said: ${JSON.stringify(res.stderr)}`,
  );
}

// ── 3e. The block message must teach the archive route ───────────────────────
{
  const { dir, wt } = repoWithWorktree({ push: false });
  const res = runHook(`git branch -D feature-x`, wt);
  assert.equal(res.status, 2, "unpushed tip is blocked");
  assert.match(res.stderr, /git tag/, "offers archiving as a tag, not only pushing the branch");
}

// ── 4. Husk dirs (no .git link) and paths INSIDE a worktree pass ───────────────
{
  const { dir } = repoWithWorktree({ push: true });
  const husk = path.join(dir, ".worktrees", "old-husk");
  mkdirSync(husk, { recursive: true });
  writeFileSync(path.join(husk, "tsconfig.tsbuildinfo"), "x");
  assert.equal(runHook(`rm -rf ${husk}`, dir).status, 0, "husk GC is not blocked");
  assert.equal(
    runHook(`rm -rf ${path.join(dir, ".worktrees", "feature-x", "node_modules")}`, dir).status,
    0,
    "deleting inside a worktree is the owner's business",
  );
}

// ── 5. rm -rf of the whole .worktrees container is blocked when work is live ──
{
  const { dir } = repoWithWorktree({ push: true, dirty: true });
  const res = runHook(`rm -rf ${path.join(dir, ".worktrees")}`, dir);
  assert.equal(res.status, 2, "wiping every worktree at once is blocked while one is dirty");
  assert.match(res.stderr, /wipes every worktree/);
}

// ── 6. branch -D with an unpushed tip is blocked; pushed tip passes ────────────
{
  const { dir, wt } = repoWithWorktree({ push: false });
  sh("git", ["worktree", "remove", "--force", wt], dir); // free the branch (bypass not needed: raw git)
  const blocked = runHook("git branch -D feature-x", dir);
  assert.equal(blocked.status, 2, "unpushed branch deletion is blocked");
  assert.match(blocked.stderr, /orphan unpushed commits/);
  sh("git", ["push", "-q", "origin", "feature-x"], dir);
  assert.equal(runHook("git branch -D feature-x", dir).status, 0, "pushed branch deletion passes");
}

// ── 7. Remote-branch deletion is blocked while a PR is still open (stub gh) ────
if (!isWin) {
  const { dir } = repoWithWorktree({ push: true });
  const bin = mkdtempSync(path.join(tmpdir(), "wt-guard-bin-"));
  const mkGh = (json) => {
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh\necho '${json}'\n`);
    chmodSync(path.join(bin, "gh"), 0o755);
  };
  mkGh('[{"number":2286}]');
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  for (const cmd of ["git push origin --delete feature-x", "git push origin :feature-x"]) {
    const res = runHook(cmd, dir, env);
    assert.equal(res.status, 2, `blocks: ${cmd}`);
    assert.match(res.stderr, /still-open PR #2286/, "names the PR it would close");
  }
  mkGh("[]");
  assert.equal(runHook("git push origin --delete feature-x", dir, env).status, 0, "no open PR → passes");
}

// ── 8. The bypass token allows deliberate destruction, and is RECORDED ────────
// cave-boor8: a worktree with 3 uncommitted files was destroyed and the
// post-mortem could not tell a deliberate override from a hole in the guard,
// because the bypass path left no trace whatsoever.
{
  const { dir, wt } = repoWithWorktree({ push: false, dirty: true });
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const res = runHook(`WT_GUARD_BYPASS=1 git worktree remove --force ${wt}`, dir);
  assert.equal(res.status, 0, "bypass token is honored");

  const log = path.join(dir, ".claude", "worktree-guard-bypass.log");
  assert.ok(existsSync(log), "an honored bypass is recorded");
  const entry = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
  assert.match(entry.command, /worktree remove/, "the record names the command that was let through");
  assert.equal(entry.session, "test", "and the session that ran it");
  assert.equal(entry.verdict, "bypass", "and that it was a deliberate override");
  assert.ok(Date.parse(entry.at) > 0, "and when");

  // A second bypass appends rather than truncating — the log is a history.
  runHook(`WT_GUARD_BYPASS=1 rm -rf ${wt}`, dir);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2, "bypasses accumulate");
}

// ── 8c. BLOCKS are recorded too — absence of any entry is itself evidence ──────
// cave-boor8's second half: a block entry followed by the worktree's
// disappearance names an actor that retried outside the hook; no entry at all
// means the destruction never routed through Bash. Both readings need blocks
// in the log, not just bypasses.
{
  const { dir, wt } = repoWithWorktree({ push: true, dirty: true });
  mkdirSync(path.join(dir, ".claude"), { recursive: true });
  const res = runHook(`git worktree remove ${wt}`, dir);
  assert.equal(res.status, 2, "still blocks");

  const log = path.join(dir, ".claude", "worktree-guard-bypass.log");
  assert.ok(existsSync(log), "the refusal is recorded");
  const entry = JSON.parse(readFileSync(log, "utf8").trim().split("\n").pop());
  assert.equal(entry.verdict, "block", "as a block, distinct from a bypass");
  assert.match(entry.command, /worktree remove/, "naming the refused command");
  assert.match(entry.reason, /uncommitted change/, "and why it was refused");
}

// ── 8b. A missing .claude dir must not brick the command ──────────────────────
{
  const { dir, wt } = repoWithWorktree({ push: false, dirty: true });
  // no .claude/ here — appendFileSync will throw and must be swallowed
  assert.equal(
    runHook(`WT_GUARD_BYPASS=1 git worktree remove --force ${wt}`, dir).status,
    0,
    "a logging failure never blocks a command",
  );
}

// ── 8c. `cd` and `git -C` no longer hide a removal from the guard ─────────────
// The gap that let cave-boor8 happen: relative targets were resolved against the
// HOOK's cwd, so these forms stat'd a nonexistent path and were waved through.
{
  const { dir } = repoWithWorktree({ push: true, dirty: true });
  const cases = [
    ["cd .worktrees && git worktree remove feature-x", "cd moves the resolution base"],
    [`git -C ${dir} worktree remove .worktrees/feature-x`, "-C moves the resolution base"],
    ["cd .worktrees && rm -rf feature-x", "cd applies to rm too"],
  ];
  for (const [cmd, why] of cases) {
    const res = runHook(cmd, dir);
    assert.equal(res.status, 2, `blocks (${why}): ${cmd}`);
    assert.match(res.stderr, /uncommitted change/, "and says why");
  }
  // A cd that walks somewhere unrelated must not create false positives.
  assert.equal(
    runHook("cd /tmp && rm -rf feature-x", dir).status,
    0,
    "an unrelated path outside .worktrees still passes",
  );
}

// ── 8d. Moving a live worktree strands it just as badly as deleting it ────────
{
  const { dir, wt } = repoWithWorktree({ push: true, dirty: true });
  const res = runHook(`mv ${wt} /tmp/parked-worktree`, dir);
  assert.equal(res.status, 2, "moving a live worktree root is blocked");
  assert.match(res.stderr, /strand a live worktree/, "explains that git still points at the old path");

  // Moving something INSIDE a worktree, or a husk, is nobody else's business.
  assert.equal(
    runHook(`mv ${path.join(wt, "c.txt")} /tmp/c.txt`, dir).status,
    0,
    "moving a file inside a worktree passes",
  );
}

// ── 8e. Moving the whole container must scan every child ─────────────────────
{
  const { dir } = repoWithWorktree({ push: true, dirty: true });
  const res = runHook(`mv ${path.join(dir, ".worktrees")} /tmp/parked-worktrees`, dir);
  assert.equal(res.status, 2, "moving every worktree is blocked while one is dirty");
  assert.match(res.stderr, /wipes every worktree/);
}

// ── 8f. Only a leading bypass assignment is honoured ─────────────────────────
{
  const { dir, wt } = repoWithWorktree({ push: true, dirty: true });
  const res = runHook(`echo ${BYPASS} && rm -rf ${wt}`, dir);
  assert.equal(res.status, 2, "a bypass-looking argument cannot disable a later destructive command");
  assert.match(res.stderr, /uncommitted change/);
}

// ── 9. Non-matching commands and garbage input never block ────────────────────
{
  const { dir } = repoWithWorktree({});
  assert.equal(runHook("ls -la && pnpm test", dir).status, 0, "unrelated commands pass the prefilter");
  for (const input of ["not json", "", "{}", '{"tool_input":{}}']) {
    const res = spawnSync("node", [script], { input, cwd: dir, encoding: "utf8", env: process.env });
    assert.equal(res.status, 0, `exits 0 on input ${JSON.stringify(input)}`);
  }
}

await test("strict exact branch tips fetch only the exact advertised source", () => {
  const exact = repoWithWorktree({ push: true });
  const exactHead = sh("git", ["-C", exact.wt, "rev-parse", "HEAD"], exact.dir).trim();
  const mainHead = sh("git", ["-C", exact.dir, "rev-parse", "main"], exact.dir).trim();
  const fetchLog = path.join(mkdtempSync(path.join(tmpdir(), "wt-guard-fetch-log-")), "fetch.jsonl");
  writeFileSync(fetchLog, "");
  const metadataBefore = gitMetadataSnapshot(exact.dir);
  const result = runStrict(strictArgs(exact.wt, exactHead), exact.dir, {
    ...strictEnv(),
    PATH: gitWrapper({
      fetchLog,
      lsRemoteOutput:
        `${mainHead}\trefs/heads/main\n` +
        `${exactHead}\trefs/heads/feature-x\n`,
    }),
  });
  assert.equal(result.status, 0, `an exact advertised branch tip is retained: ${result.stderr}`);
  const calls = fetchCalls(fetchLog);
  assert.equal(calls.length, 1, "exact retention uses one source-only fetch");
  const separator = calls[0].indexOf("--");
  assert.deepEqual(
    calls[0].slice(separator + 2),
    ["refs/heads/feature-x:"],
    "exact retention fetches only the exact HEAD source",
  );
  assert.deepEqual(gitMetadataSnapshot(exact.dir), metadataBefore, "exact-tip proof changes no refs or FETCH_HEAD");
});

await test("strict exact branch tip drift at post-fetch recheck is refused", () => {
  const drift = repoWithWorktree({ push: true });
  const exactHead = sh("git", ["-C", drift.wt, "rev-parse", "HEAD"], drift.dir).trim();
  const driftOid = sh("git", ["-C", drift.dir, "rev-parse", "main"], drift.dir).trim();
  const metadataBefore = gitMetadataSnapshot(drift.dir);
  const result = runStrict(strictArgs(drift.wt, exactHead), drift.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ driftRef: "refs/heads/feature-x", driftOid }),
  });
  assert.equal(result.status, 2, "an exact source that changes after fetch is refused");
  assert.equal(result.stdout, "", "exact-tip drift emits no allow evidence");
  assert.match(result.stderr, /changed refs\/heads\/feature-x/);
  assert.deepEqual(
    gitMetadataSnapshot(drift.dir),
    metadataBefore,
    "exact-tip drift changes no refs or FETCH_HEAD",
  );
});

await test("strict ancestry fetches 17 advertised sources in two bounded batches", () => {
  const batched = repoWithMergedWorktreeAndAdvancedMain();
  const unrelatedHead = sh(
    "git",
    ["-C", batched.dir, "rev-parse", "refs/remotes/origin/main"],
    batched.dir,
  ).trim();
  const advertisedLines = [];
  for (let index = 0; index < 17; index += 1) {
    const name = `refs/heads/batch-${String(index).padStart(2, "0")}`;
    const oid = index === 16 ? batched.remoteMain : unrelatedHead;
    sh("git", ["-C", batched.dir, "push", "-q", "origin", `${oid}:${name}`], batched.dir);
    advertisedLines.push(`${oid}\t${name}`);
  }
  const fetchLog = path.join(mkdtempSync(path.join(tmpdir(), "wt-guard-fetch-log-")), "fetch.jsonl");
  writeFileSync(fetchLog, "");
  const metadataBefore = gitMetadataSnapshot(batched.dir);
  const result = runStrict(strictArgs(batched.wt, batched.featureHead), batched.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ fetchLog, lsRemoteOutput: `${advertisedLines.join("\n")}\n` }),
  });
  assert.equal(result.status, 0, `the seventeenth source retains HEAD: ${result.stderr}`);
  const calls = fetchCalls(fetchLog);
  assert.equal(calls.length, 2, "17 sources use exactly two source-only fetch batches");
  const batchSizes = calls.map((args) => {
    const separator = args.indexOf("--");
    return args.slice(separator + 2).length;
  });
  assert.deepEqual(batchSizes, [16, 1], "ancestry batches never exceed 16 sources");
  assert.deepEqual(gitMetadataSnapshot(batched.dir), metadataBefore, "batched ancestry changes no refs or FETCH_HEAD");
});

await test("strict exact branch tips must be fetchable", () => {
  const broken = repoWithWorktree({ push: false });
  const brokenHead = sh("git", ["-C", broken.wt, "rev-parse", "HEAD"], broken.dir).trim();
  writeFileSync(path.join(broken.bare, "refs", "heads", "aaa-broken"), `${brokenHead}\n`);
  const metadataBefore = gitMetadataSnapshot(broken.dir);
  const result = runStrict(strictArgs(broken.wt, brokenHead), broken.dir, strictEnv());
  assert.equal(result.status, 2, "an exact advertised HEAD whose object cannot be fetched is refused");
  assert.equal(result.stdout, "");
  assert.deepEqual(gitMetadataSnapshot(broken.dir), metadataBefore, "failed exact fetch changes no refs or FETCH_HEAD");
});

await test("strict retention has a hard aggregate candidate bound", () => {
  const excessive = repoWithWorktree({ push: false });
  const excessiveHead = sh("git", ["-C", excessive.wt, "rev-parse", "HEAD"], excessive.dir).trim();
  const advertisement = Array.from(
    { length: 257 },
    (_, index) => `${excessiveHead}\trefs/heads/generated-${String(index).padStart(3, "0")}`,
  ).join("\n") + "\n";
  const metadataBefore = gitMetadataSnapshot(excessive.dir);
  const result = runStrict(strictArgs(excessive.wt, excessiveHead), excessive.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ lsRemoteOutput: advertisement }),
  });
  assert.equal(result.status, 2, "more than 256 advertised candidate sources is refused before fetch");
  assert.equal(result.stdout, "");
  assert.deepEqual(gitMetadataSnapshot(excessive.dir), metadataBefore, "candidate overflow changes no refs or FETCH_HEAD");
});

await test("strict advertisements use one repository OID width", () => {
  const mixed = repoWithWorktree({ push: false });
  const mixedHead = sh("git", ["-C", mixed.wt, "rev-parse", "HEAD"], mixed.dir).trim();
  const advertisement =
    `${mixedHead}\trefs/heads/exact-head\n` +
    `${"a".repeat(64)}\trefs/heads/mixed-width\n`;
  const metadataBefore = gitMetadataSnapshot(mixed.dir);
  const result = runStrict(strictArgs(mixed.wt, mixedHead), mixed.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ lsRemoteOutput: advertisement }),
  });
  assert.equal(result.status, 2, "mixed 40/64-bit advertised OIDs are refused");
  assert.equal(result.stdout, "");
  assert.deepEqual(gitMetadataSnapshot(mixed.dir), metadataBefore, "mixed-width refusal changes no refs or FETCH_HEAD");
});

await test("strict-worktree-remove is a fail-closed direct guard", () => {
  let result;
  const merged = repoWithMergedWorktreeAndAdvancedMain();
  const refsBeforeMergedRetention = sh(
    "git",
    ["-C", merged.dir, "for-each-ref", "--format=%(refname)%00%(objectname)"],
    merged.dir,
  );
  const fetchHeadBeforeMergedRetention = readFileSync(merged.fetchHeadPath, "utf8");
  const mergedResult = runStrict(strictArgs(merged.wt, merged.featureHead), merged.dir, strictEnv());
  assert.equal(
    mergedResult.status,
    0,
    `a feature HEAD retained by a later freshly advertised remote main is allowed: ${mergedResult.stderr}`,
  );
  assert.equal(mergedResult.stderr, "", "merged retention allow writes no diagnostics");
  assert.deepEqual(JSON.parse(mergedResult.stdout), {
    ok: true,
    mode: "strict-worktree-remove",
    path: realpathSync(merged.wt),
    head: merged.featureHead,
  });
  assert.equal(
    sh("git", ["-C", merged.dir, "for-each-ref", "--format=%(refname)%00%(objectname)"], merged.dir),
    refsBeforeMergedRetention,
    "fresh ancestry proof does not create or update any local ref",
  );
  assert.equal(
    readFileSync(merged.fetchHeadPath, "utf8"),
    fetchHeadBeforeMergedRetention,
    "fresh ancestry proof does not overwrite FETCH_HEAD",
  );

  for (const annotated of [false, true]) {
    const tagged = repoWithTagRetainedWorktree({ annotated });
    const metadataBefore = gitMetadataSnapshot(tagged.dir);
    const tagResult = runStrict(strictArgs(tagged.wt, tagged.featureHead), tagged.dir, strictEnv());
    assert.equal(
      tagResult.status,
      0,
      `${annotated ? "annotated" : "lightweight"} commit-bearing tag ancestry is retention: ${tagResult.stderr}`,
    );
    assert.equal(tagResult.stderr, "");
    assert.equal(tagResult.stdout.split("\n").length, 2, "tag retention emits exactly one allow line");
    assert.deepEqual(gitMetadataSnapshot(tagged.dir), metadataBefore, "tag proof changes no refs or FETCH_HEAD");
  }

  const forgedPeel = repoWithWorktree({ push: false });
  const forgedPeelHead = sh("git", ["-C", forgedPeel.wt, "rev-parse", "HEAD"], forgedPeel.dir).trim();
  sh("git", ["-C", forgedPeel.dir, "tag", "-a", "archive/forged", "-m", "forged", "main"], forgedPeel.dir);
  sh("git", ["-C", forgedPeel.dir, "push", "-q", "origin", "refs/tags/archive/forged"], forgedPeel.dir);
  const forgedBaseOid = sh(
    "git",
    ["-C", forgedPeel.dir, "ls-remote", "--tags", "origin", "refs/tags/archive/forged"],
    forgedPeel.dir,
  ).split("\t", 1)[0];
  const forgedMainOid = sh("git", ["-C", forgedPeel.dir, "rev-parse", "main"], forgedPeel.dir).trim();
  result = runStrict(strictArgs(forgedPeel.wt, forgedPeelHead), forgedPeel.dir, {
    ...strictEnv(),
    PATH: gitWrapper({
      lsRemoteOutput:
        `${forgedMainOid}\trefs/heads/main\n` +
        `${forgedBaseOid}\trefs/tags/archive/forged\n` +
        `${forgedPeelHead}\trefs/tags/archive/forged^{}\n`,
    }),
  });
  assert.equal(result.status, 2, "a forged HEAD-matching peeled line cannot fast-allow deletion");
  assert.equal(result.stdout, "", "forged peel emits no allow evidence");
  assert.match(result.stderr, /peeled|tag/, "forged base/peel relationship is explained");

  for (const [label, output] of [
    [
      "duplicate ref",
      `${forgedMainOid}\trefs/heads/main\n${forgedMainOid}\trefs/heads/main\n`,
    ],
    [
      "peeled tag without base",
      `${forgedPeelHead}\trefs/tags/archive/orphan^{}\n`,
    ],
    [
      "malformed advertised OID",
      `abc123\trefs/heads/main\n`,
    ],
    [
      "invalid advertised refname",
      `${forgedMainOid}\trefs/heads/bad..name\n`,
    ],
  ]) {
    const metadataBeforeMalformedAdvertisement = gitMetadataSnapshot(forgedPeel.dir);
    result = runStrict(strictArgs(forgedPeel.wt, forgedPeelHead), forgedPeel.dir, {
      ...strictEnv(),
      PATH: gitWrapper({ lsRemoteOutput: output }),
    });
    assert.equal(result.status, 2, `${label} advertisement is refused`);
    assert.equal(result.stdout, "", `${label} emits no allow evidence`);
    assert.deepEqual(
      gitMetadataSnapshot(forgedPeel.dir),
      metadataBeforeMalformedAdvertisement,
      `${label} changes no refs or FETCH_HEAD`,
    );
  }

  const everyRemote = repoWithWorktree({ push: true });
  const everyRemoteHead = sh("git", ["-C", everyRemote.wt, "rev-parse", "HEAD"], everyRemote.dir).trim();
  sh(
    "git",
    ["-C", everyRemote.dir, "remote", "add", "unreachable", path.join(everyRemote.dir, "missing-remote.git")],
    everyRemote.dir,
  );
  result = runStrict(strictArgs(everyRemote.wt, everyRemoteHead), everyRemote.dir, strictEnv());
  assert.equal(result.status, 2, "every configured remote must answer before an exact branch allow");
  assert.equal(result.stdout, "");

  const drift = repoWithMergedWorktreeAndAdvancedMain();
  const driftOid = sh("git", ["-C", drift.dir, "rev-parse", "main^"], drift.dir).trim();
  result = runStrict(strictArgs(drift.wt, drift.featureHead), drift.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ driftRef: "refs/heads/main", driftOid }),
  });
  assert.equal(result.status, 2, "advertisement drift between discovery and fetch recheck is refused");
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /changed refs\/heads\/main/, "drift refusal identifies the changed source");

  const mergeBaseError = repoWithMergedWorktreeAndAdvancedMain();
  result = runStrict(strictArgs(mergeBaseError.wt, mergeBaseError.featureHead), mergeBaseError.dir, {
    ...strictEnv(),
    PATH: gitWrapper({ mergeBaseStatus: 7 }),
  });
  assert.equal(result.status, 2, "merge-base status other than 0 or 1 is refused");
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ancestry probe exited 7/, "unexpected merge-base status is explicit");

  const safe = repoWithWorktree({ push: true });
  const safeHead = sh("git", ["-C", safe.wt, "rev-parse", "HEAD"], safe.dir).trim();
  const safeResult = runStrict(strictArgs(safe.wt, safeHead), safe.dir, strictEnv());
  assert.equal(safeResult.status, 0, `safe strict removal is allowed: ${safeResult.stderr}`);
  assert.equal(safeResult.stderr, "", "safe strict removal writes no diagnostics");
  assert.ok(safeResult.stdout.endsWith("\n"), "allow evidence is newline terminated");
  assert.equal(safeResult.stdout.split("\n").length, 2, "allow evidence is exactly one line");
  const allow = JSON.parse(safeResult.stdout);
  assert.deepEqual(Object.keys(allow), ["ok", "mode", "path", "head"], "allow evidence has only the contract keys");
  assert.deepEqual(allow, {
    ok: true,
    mode: "strict-worktree-remove",
    path: realpathSync(safe.wt),
    head: safeHead,
  });

  const externalExclude = repoWithWorktree({ push: true });
  const externalExcludeHead = sh(
    "git",
    ["-C", externalExclude.wt, "rev-parse", "HEAD"],
    externalExclude.dir,
  ).trim();
  const excludesFile = path.join(externalExclude.dir, "external-excludes");
  writeFileSync(excludesFile, "hidden-by-external.txt\n");
  sh("git", ["-C", externalExclude.wt, "config", "core.excludesFile", excludesFile], externalExclude.dir);
  writeFileSync(path.join(externalExclude.wt, "hidden-by-external.txt"), "must remain visible\n");
  const externalExcludeResult = runStrict(
    strictArgs(externalExclude.wt, externalExcludeHead),
    externalExclude.dir,
    strictEnv(),
  );
  assert.equal(externalExcludeResult.status, 2, "configured external excludes cannot hide an untracked path");
  assert.equal(externalExcludeResult.stdout, "");

  if (!isWin) {
    const filemode = repoWithWorktree({ push: true });
    const filemodeHead = sh("git", ["-C", filemode.wt, "rev-parse", "HEAD"], filemode.dir).trim();
    sh("git", ["-C", filemode.wt, "config", "core.filemode", "false"], filemode.dir);
    chmodSync(path.join(filemode.wt, "b.txt"), 0o755);
    const filemodeResult = runStrict(strictArgs(filemode.wt, filemodeHead), filemode.dir, strictEnv());
    assert.equal(filemodeResult.status, 2, "repo core.filemode=false cannot hide a tracked executable-bit change");
    assert.equal(filemodeResult.stdout, "");
  }

  for (const [ambient, label] of [
    [
      { GIT_DIR: path.join(safe.dir, "missing-git-dir"), GIT_WORK_TREE: path.join(safe.dir, "missing-work-tree") },
      "ambient GIT_DIR/GIT_WORK_TREE",
    ],
    [{ GIT_INDEX_FILE: path.join(safe.dir, "missing-index") }, "ambient GIT_INDEX_FILE"],
    [{ GIT_CONFIG_COUNT: "1" }, "malformed ambient GIT_CONFIG_COUNT injection"],
  ]) {
    const ambientResult = runStrict(strictArgs(safe.wt, safeHead), safe.dir, { ...strictEnv(), ...ambient });
    assert.equal(ambientResult.status, 0, `${label} cannot redirect strict Git: ${ambientResult.stderr}`);
    assert.equal(ambientResult.stderr, "");
  }

  const dirty = repoWithWorktree({ push: true, dirty: true });
  sh("git", ["config", "status.showUntrackedFiles", "no"], dirty.wt);
  const dirtyHead = sh("git", ["-C", dirty.wt, "rev-parse", "HEAD"], dirty.dir).trim();
  result = runStrict(strictArgs(dirty.wt, dirtyHead), dirty.dir, {
    ...strictEnv(),
    WT_GUARD_BYPASS: "1",
  });
  assert.equal(result.status, 2, "strict mode sees untracked dirt hidden by repo config and ignores bypass");
  assert.equal(result.stdout, "", "dirty refusal emits no allow evidence");

  const unpushed = repoWithWorktree({ push: false });
  const unpushedHead = sh("git", ["-C", unpushed.wt, "rev-parse", "HEAD"], unpushed.dir).trim();
  result = runStrict(strictArgs(unpushed.wt, unpushedHead), unpushed.dir, strictEnv());
  assert.equal(result.status, 2, "clean unpushed worktree is refused");
  assert.equal(result.stdout, "");

  const brokenFetch = repoWithWorktree({ push: false });
  const brokenFetchHead = sh("git", ["-C", brokenFetch.wt, "rev-parse", "HEAD"], brokenFetch.dir).trim();
  const brokenRef = path.join(brokenFetch.bare, "refs", "heads", "aaa-broken");
  writeFileSync(brokenRef, `${brokenFetchHead}\n`);
  assert.match(
    sh("git", ["-C", brokenFetch.dir, "ls-remote", "--heads", "origin"], brokenFetch.dir),
    new RegExp(`${brokenFetchHead}\\trefs/heads/aaa-broken`),
    "fixture sanity: the remote freshly advertises the missing object",
  );
  result = runStrict(strictArgs(brokenFetch.wt, brokenFetchHead), brokenFetch.dir, strictEnv());
  assert.equal(result.status, 2, "a freshly advertised ref whose object cannot be fetched is refused");
  assert.equal(result.stdout, "", "fetch uncertainty emits no allow evidence");
  assert.match(result.stderr, /git probe/, "fetch failure is reported as strict uncertainty");

  result = runStrict(strictArgs(safe.wt, "0".repeat(40)), safe.dir, strictEnv());
  assert.equal(result.status, 2, "audited HEAD drift is refused");
  assert.equal(result.stdout, "");

  const missing = path.join(safe.dir, ".worktrees", "missing");
  result = runStrict(strictArgs(missing, safeHead), safe.dir, strictEnv());
  assert.equal(result.status, 2, "missing absolute target is refused");
  assert.equal(result.stdout, "");

  const copied = path.join(safe.dir, ".worktrees", "unregistered-copy");
  mkdirSync(copied, { recursive: true });
  writeFileSync(path.join(copied, ".git"), readFileSync(path.join(safe.wt, ".git")));
  result = runStrict(strictArgs(copied, safeHead), safe.dir, strictEnv());
  assert.equal(result.status, 2, "a .git-bearing directory absent from the exact worktree registry is refused");
  assert.equal(result.stdout, "");

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, strictEnv(path.join(safe.dir, "missing-lsof")));
  assert.equal(result.status, 2, "a missing strict lsof executable is refused");
  assert.equal(result.stdout, "");

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, strictEnv(lsofStub("", 7)));
  assert.equal(result.status, 2, "a failing strict lsof probe is refused");
  assert.equal(result.stdout, "");

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, strictEnv(lsofStub(undefined, 0, "warning\n")));
  assert.equal(result.status, 2, "strict lsof stderr is uncertainty and is refused");
  assert.equal(result.stdout, "");

  result = runStrict(
    strictArgs(safe.wt, safeHead),
    safe.dir,
    strictEnv(lsofStub("p4242\ncidle\nn/\n")),
  );
  assert.equal(result.status, 2, "a successful lsof stream missing fcwd is malformed and refused");
  assert.equal(result.stdout, "");

  const canonicalSafe = realpathSync(safe.wt);
  result = runStrict(
    strictArgs(safe.wt, safeHead),
    safe.dir,
    strictEnv(lsofStub(`p99123\ncworker\nfcwd\nn${canonicalSafe}\n`)),
  );
  assert.equal(result.status, 2, "a process with cwd at the exact target is refused");
  assert.equal(result.stdout, "");

  for (const args of [
    strictArgs("relative/worktree", safeHead),
    ["--strict-worktree-remove", safe.wt],
    strictArgs(safe.wt, "abc123"),
    [...strictArgs(safe.wt, safeHead), "extra"],
    ["--unknown"],
  ]) {
    result = runStrict(args, safe.dir, strictEnv());
    assert.equal(result.status, 2, `malformed strict argv is refused: ${JSON.stringify(args)}`);
    assert.equal(result.stdout, "", "malformed strict argv emits no allow evidence");
    assert.notEqual(result.stderr, "", "malformed strict argv explains the refusal");
  }

  const productionLsof = lsofStub(undefined, 0, "", "lsof");
  const productionPath = `${path.dirname(productionLsof)}${path.delimiter}${process.env.PATH}`;
  const failingOverride = lsofStub("", 9);

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, {
    PATH: productionPath,
    WT_GUARD_TEST_MODE: "1",
  });
  assert.equal(result.status, 0, "test mode alone still uses the production PATH lsof");
  assert.equal(result.stderr, "");

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, {
    PATH: productionPath,
    WT_GUARD_TEST_LSOF_BIN: failingOverride,
  });
  assert.equal(result.status, 0, "the override variable alone still uses the production PATH lsof");
  assert.equal(result.stderr, "");

  result = runStrict(strictArgs(safe.wt, safeHead), safe.dir, {
    PATH: productionPath,
    WT_GUARD_TEST_MODE: "1",
    WT_GUARD_TEST_LSOF_BIN: failingOverride,
  });
  assert.equal(result.status, 2, "both test seam variables activate the failing override");
  assert.equal(result.stdout, "");
});

console.log("worktree-guard.test.mjs passed");

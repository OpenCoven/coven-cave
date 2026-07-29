// Tests for the destructive-op PreToolUse hook (scripts/worktree-guard.mjs).
// The hook must BLOCK (exit 2) destruction of dirty/unpushed worktrees, deletion
// of branches whose tip exists on no remote, and remote-branch deletion while a
// PR is still open — and pass EVERYTHING else silently (exit 0), including husk
// GC, clean+pushed cleanup, paths inside a worktree, the bypass token, and any
// garbage input. A guard bug must never brick Bash.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "worktree-guard.mjs");
const isWin = process.platform === "win32";
const BYPASS = "WT_GUARD_BYPASS=1";

function runHook(command, cwd, extraEnv = {}) {
  const payload = JSON.stringify({ session_id: "test", cwd, tool_name: "Bash", tool_input: { command } });
  return spawnSync("node", [script], {
    input: payload,
    cwd,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...extraEnv },
  });
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
  sh("git", ["init", "-q", "--bare", bare], bare);
  sh("git", ["remote", "add", "origin", bare], dir);
  sh("git", ["push", "-q", "-u", "origin", "main"], dir);
  const wt = path.join(dir, ".worktrees", "feature-x");
  sh("git", ["worktree", "add", "-q", "-b", "feature-x", wt], dir);
  writeFileSync(path.join(wt, "b.txt"), "b\n");
  sh("git", ["-C", wt, "add", "."], dir);
  sh("git", ["-C", wt, "commit", "-q", "-m", "wt work"], dir);
  if (push) sh("git", ["-C", wt, "push", "-q", "-u", "origin", "feature-x"], dir);
  if (dirty) writeFileSync(path.join(wt, "c.txt"), "uncommitted\n");
  return { dir, wt };
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
  assert.equal(res.status, 0, "cleanup from inside the worktree is not blocked by the guard's own probe");
  assert.doesNotMatch(res.stderr, /still working in it/, "the probe is never reported as live work");
  assert.doesNotMatch(res.stderr, /lsof/, "and never named as an owner");
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

console.log("worktree-guard.test.mjs passed");

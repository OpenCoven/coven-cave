// Tests for the destructive-op PreToolUse hook (scripts/worktree-guard.mjs).
// The hook must BLOCK (exit 2) destruction of dirty/unpushed worktrees, deletion
// of branches whose tip exists on no remote, and remote-branch deletion while a
// PR is still open — and pass EVERYTHING else silently (exit 0), including husk
// GC, clean+pushed cleanup, paths inside a worktree, the bypass token, and any
// garbage input. A guard bug must never brick Bash.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "worktree-guard.mjs");
const isWin = process.platform === "win32";

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

// ── 8. The bypass token allows deliberate destruction ──────────────────────────
{
  const { dir, wt } = repoWithWorktree({ push: false, dirty: true });
  const res = runHook(`WT_GUARD_BYPASS=1 git worktree remove --force ${wt}`, dir);
  assert.equal(res.status, 0, "bypass token is honored");
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

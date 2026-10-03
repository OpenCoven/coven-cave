// @ts-nocheck
/**
 * The changes route against real repositories in unusual git states (#5781):
 * a paused rebase, a repository with no commits yet, and a user whose diff
 * config colours output and drops prefixes. Each drives the real handler.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "changes-git-states-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const workspace = path.join(scratch, "workspace");
mkdirSync(workspace);
// Never the developer's own Cave home, projects or git config.
process.env.WORKSPACE_ROOT = workspace;
process.env.COVEN_HOME = path.join(scratch, "coven-home");
process.env.COVEN_CAVE_HOME = path.join(scratch, "coven-home", "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(scratch, "no-projects.json");
process.env.GIT_CONFIG_GLOBAL = path.join(scratch, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
writeFileSync(process.env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n");

const { GET, POST } = await import("./route.ts");

const post = async (body) => {
  const res = await POST(new Request("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};
const get = async (params) => {
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`http://127.0.0.1/api/changes?${new URLSearchParams(params)}`));
  return { status: res.status, json: await res.json() };
};

let count = 0;
function repo({ commit = true } = {}) {
  const dir = path.join(workspace, `repo-${count++}`);
  mkdirSync(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "f.txt"), "base\n");
  if (commit) {
    git("add", "-A");
    git("commit", "-q", "-m", "base");
  }
  return { dir, git };
}
const read = (dir, rel) => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), "utf8") : null);

// ── 1. No commit and no pull request mid-rebase ─────────────────────────────
// The desk's commit used to land inside the paused rebase, on a new `cave/`
// branch, and `git rebase --continue` then rewrote the branch with it.
{
  const { dir, git } = repo();
  git("checkout", "-q", "-b", "feature");
  writeFileSync(path.join(dir, "f.txt"), "feature\n");
  git("commit", "-q", "-am", "feature edit");
  git("checkout", "-q", "main");
  writeFileSync(path.join(dir, "f.txt"), "main\n");
  git("commit", "-q", "-am", "main edit");
  git("checkout", "-q", "feature");
  assert.throws(() => git("rebase", "main"));
  writeFileSync(path.join(dir, "f.txt"), "resolved\n");
  git("add", "f.txt");
  const head = git("rev-parse", "HEAD");
  const branches = git("branch", "--list");

  const commit = await post({ projectRoot: dir, action: "commit", message: "desk commit mid-rebase" });
  assert.equal(commit.status, 409);
  assert.match(commit.json.error, /^a rebase is in progress in this repository; finish it \(git rebase --continue\)/);
  assert.notEqual(commit.json.stale, true, "not the reviewed-list refusal, which re-reads the changes");
  assert.equal(git("rev-parse", "HEAD"), head, "HEAD didn't move");
  assert.equal(git("branch", "--list"), branches, "no cave/ branch");
  assert.ok(existsSync(path.join(dir, ".git", "rebase-merge")), "the rebase is still paused where it was");

  const pr = await post({ projectRoot: dir, action: "create-pr", title: "Partial rebase" });
  assert.equal(pr.status, 409);
  assert.match(pr.json.error, /then open a pull request$/);

  git("rebase", "--continue");
  assert.match(git("log", "--format=%s", "-2"), /^feature edit\nmain edit\n$/, "the rebase finishes with its own commit");
}

// ── 2. Before the first commit, reverting a staged file can be undone ───────
{
  const { dir, git } = repo({ commit: false });
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src", "app.ts"), "app\n");
  git("add", "-A");
  const revert = await post({ projectRoot: dir, path: "src/app.ts", confirmUntracked: true });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(read(dir, "src/app.ts"), null, "the revert deleted it");
  const patch = readFileSync(revert.json.checkpointPath, "utf8");
  assert.match(patch, /\+\+\+ b\/src\/app\.ts/, "its safety checkpoint has it");

  const restore = await post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: path.basename(revert.json.checkpointPath) });
  assert.equal(restore.status, 200, JSON.stringify(restore.json));
  assert.ok(restore.json.restored.includes("src/app.ts"));
  assert.equal(read(dir, "src/app.ts"), "app\n", "and the restore brings it back");
}

// ── 3. Colour and prefix config reach neither checkpoints nor diffs ─────────
{
  const { dir, git } = repo();
  git("config", "color.ui", "always");
  git("config", "diff.noprefix", "true");
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const diff = await get({ projectRoot: dir, path: "f.txt" });
  assert.equal(diff.status, 200);
  assert.ok(!diff.json.diff.includes("\u001b["), "no escape codes in the viewer's diff");
  assert.match(diff.json.diff, /^diff --git a\/f\.txt b\/f\.txt$/m);

  const revert = await post({ projectRoot: dir, path: "f.txt" });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(read(dir, "f.txt"), "base\n");
  const restore = await post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: path.basename(revert.json.checkpointPath) });
  assert.equal(restore.status, 200, JSON.stringify(restore.json));
  assert.deepEqual(restore.json.restored, ["f.txt"], "the undo restores the edit instead of reporting nothing to do");
  assert.equal(read(dir, "f.txt"), "edited\n");
}

console.log("changes route git states: ok");

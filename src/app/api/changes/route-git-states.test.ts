// @ts-nocheck
/**
 * The changes route against real repositories in unusual git states (#5781):
 * a paused rebase, a repository with no commits yet, and a user whose diff
 * config colours output and drops prefixes. Each drives the real handler.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
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
// The route always signs (`commit -S`), so commits here sign with a
// throwaway SSH key; nothing else in the tests signs.
const signingKey = path.join(scratch, "signing-key");
execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", signingKey]);
writeFileSync(
  process.env.GIT_CONFIG_GLOBAL,
  `[user]\n\tname = Test\n\temail = test@example.com\n\tsigningkey = ${signingKey}\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = false\n`,
);

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
  // No editor: `rebase --continue` keeps the pick's message.
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_EDITOR: "true" } });
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

const listed = async (dir) => (await get({ projectRoot: dir })).json.files.map((file) => [file.path, file.status, file.renamedFrom ?? null]);

// ── 4. A rename reverts as a whole (#5781) ──────────────────────────────────
// It was refused as "a new file", and the edit card's confirmed Undo deleted
// the new path while the original stayed deleted too.
{
  const { dir, git } = repo();
  git("mv", "f.txt", "g.txt");
  assert.deepEqual(await listed(dir), [["g.txt", "renamed", "f.txt"]]);
  for (const confirmUntracked of [false, true]) {
    if (confirmUntracked) git("mv", "f.txt", "g.txt");
    const revert = await post({ projectRoot: dir, path: "g.txt", confirmUntracked });
    assert.equal(revert.status, 200, JSON.stringify(revert.json));
    assert.equal(revert.json.reverted, "unrename");
    assert.equal(read(dir, "f.txt"), "base\n", "the original is back");
    assert.equal(read(dir, "g.txt"), null, "and the new path is gone");
    assert.equal(git("status", "--porcelain"), "", "with nothing left staged");
  }
}

// ── 5. A worktree rename (` R`) lists no phantom and reverts (#5781) ────────
{
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "ab cd.txt"), "spaced\n");
  git("add", "-A");
  git("commit", "-q", "-m", "spaced");
  execFileSync("mv", [path.join(dir, "ab cd.txt"), path.join(dir, "moved.txt")]);
  git("add", "-N", "moved.txt");
  assert.match(git("status", "--porcelain=v1"), /^ R "ab cd\.txt" -> moved\.txt$/m);
  assert.deepEqual(await listed(dir), [["moved.txt", "renamed", "ab cd.txt"]], "no phantom cd.txt row");
  const revert = await post({ projectRoot: dir, path: "moved.txt" });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(read(dir, "ab cd.txt"), "spaced\n");
  assert.equal(read(dir, "moved.txt"), null);
}

// ── 6. A copy reverts by removing the copy, leaving its original (#5781) ────
{
  const { dir, git } = repo();
  git("config", "status.renames", "copies");
  writeFileSync(path.join(dir, "dup.txt"), "base\n");
  writeFileSync(path.join(dir, "f.txt"), "base\nedited\n");
  git("add", "-A");
  assert.deepEqual(await listed(dir), [["dup.txt", "renamed", "f.txt"], ["f.txt", "modified", null]]);
  const revert = await post({ projectRoot: dir, path: "dup.txt" });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(read(dir, "dup.txt"), null, "the copy is gone");
  assert.equal(read(dir, "f.txt"), "base\nedited\n", "the original and its edit stay");
}

// ── 7. A conflict reads as one, and Revert refuses it (#5781) ───────────────
{
  const { dir, git } = repo();
  git("checkout", "-q", "-b", "feature");
  writeFileSync(path.join(dir, "f.txt"), "feature\n");
  git("commit", "-q", "-am", "feature");
  git("checkout", "-q", "main");
  writeFileSync(path.join(dir, "f.txt"), "main\n");
  git("commit", "-q", "-am", "main");
  assert.throws(() => git("merge", "feature"));
  assert.deepEqual(await listed(dir), [["f.txt", "conflicted", null]]);
  writeFileSync(path.join(dir, "f.txt"), "hand-resolved\n");
  const revert = await post({ projectRoot: dir, path: "f.txt" });
  assert.equal(revert.status, 409);
  assert.match(revert.json.error, /merge conflict; resolve it, or stop the operation that left it, in a terminal/);
  assert.equal(read(dir, "f.txt"), "hand-resolved\n", "the resolution is untouched");
}

// ── 8. The first commit lands on its branch (#5781) ─────────────────────────
{
  const { dir, git } = repo({ commit: false });
  const commit = await post({ projectRoot: dir, action: "commit", message: "first" });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.equal(commit.json.branch, "main");
  assert.equal(commit.json.branchCreated, false, "no cave/ branch off a branch with no history");
  assert.equal(git("log", "--format=%s"), "first\n");
  assert.equal(git("branch", "--list", "cave/*"), "");
}

// ── 9. A symlink that points outside is a file inside (#5781) ───────────────
{
  // Real targets: a dangling link never tripped the old check.
  const outside = path.join(scratch, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, "a.conf"), "A\n");
  writeFileSync(path.join(outside, "b.conf"), "B\n");
  const { dir, git } = repo();
  symlinkSync(path.join(outside, "a.conf"), path.join(dir, "config.link"));
  git("add", "-A");
  git("commit", "-q", "-m", "link");
  rmSync(path.join(dir, "config.link"));
  symlinkSync(path.join(outside, "b.conf"), path.join(dir, "config.link"));
  const diff = await get({ projectRoot: dir, path: "config.link" });
  assert.equal(diff.status, 200, JSON.stringify(diff.json));
  assert.match(diff.json.diff, /b\.conf/);
  const revert = await post({ projectRoot: dir, path: "config.link" });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(readlinkSync(path.join(dir, "config.link")), path.join(outside, "a.conf"));
  const restore = await post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: path.basename(revert.json.checkpointPath) });
  assert.equal(restore.status, 200, JSON.stringify(restore.json));
  assert.equal(readlinkSync(path.join(dir, "config.link")), path.join(outside, "b.conf"), "and its undo restores the link");
  assert.deepEqual([read(outside, "a.conf"), read(outside, "b.conf")], ["A\n", "B\n"], "nothing was written through it");
  // A path under a linked folder that leads outside is still refused.
  symlinkSync(outside, path.join(dir, "escape"));
  writeFileSync(path.join(outside, "x.txt"), "outside\n");
  assert.equal((await get({ projectRoot: dir, path: "escape/x.txt" })).status, 403);
}

// ── 10. A huge untracked file is left out, and can't be reverted (#5781) ────
{
  const { dir } = repo();
  writeFileSync(path.join(dir, "big.bin"), "");
  truncateSync(path.join(dir, "big.bin"), 51 * 1024 * 1024);
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const checkpoint = await post({ projectRoot: dir, action: "checkpoint" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.json));
  assert.deepEqual(checkpoint.json.skipped, ["big.bin"]);
  assert.ok(lstatSync(checkpoint.json.checkpointPath).size < 1024 * 1024, "the checkpoint holds the edit, not the 51 MB file");
  const revertBig = await post({ projectRoot: dir, path: "big.bin", confirmUntracked: true });
  assert.equal(revertBig.status, 413);
  assert.ok(existsSync(path.join(dir, "big.bin")), "the big file is still there");
  const revertEdit = await post({ projectRoot: dir, path: "f.txt" });
  assert.equal(revertEdit.status, 200, "other reverts still work");
}

// ── 11. Many untracked files go in one pass, all of them (#5781) ────────────
{
  const { dir } = repo();
  mkdirSync(path.join(dir, "gen"));
  for (let i = 0; i < 400; i++) writeFileSync(path.join(dir, "gen", `file-${i}.txt`), `${i}\n`);
  const checkpoint = await post({ projectRoot: dir, action: "checkpoint" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.json));
  const patch = readFileSync(checkpoint.json.checkpointPath, "utf8");
  assert.equal(patch.match(/^diff --git /gm).length, 400);
}

// ── 12. Only the newest checkpoints are kept (#5781) ────────────────────────
{
  const { dir } = repo();
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const dirOf = (file) => path.dirname(file);
  let last = "";
  for (let i = 0; i < 53; i++) {
    const checkpoint = await post({ projectRoot: dir, action: "checkpoint" });
    assert.equal(checkpoint.status, 200);
    last = checkpoint.json.checkpointPath;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  const kept = readdirSync(dirOf(last)).filter((name) => name.endsWith(".patch")).sort();
  assert.equal(kept.length, 50);
  assert.equal(kept.at(-1), path.basename(last), "the newest stays");
}

console.log("changes route git states: ok");

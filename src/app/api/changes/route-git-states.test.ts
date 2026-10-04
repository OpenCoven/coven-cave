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
// A commit's time limit, short enough to drive a hook past it (#5781).
process.env.COVEN_CAVE_GIT_LONG_TIMEOUT_MS = "3000";
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

const hook = (dir, name, body) => {
  writeFileSync(path.join(dir, ".git", "hooks", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};

// ── 13. A commit whose post-commit hook outruns the limit landed (#5781) ────
// It was reported as failed, and the rollback reset the index under the new
// commit, so its own files read as deleted and untracked.
{
  const { dir, git } = repo();
  hook(dir, "post-commit", "sleep 6");
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "slow hook after" });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.match(commit.json.warning, /^the commit landed, but a hook after it was still running after 3 seconds$/);
  assert.equal(git("log", "-1", "--format=%s").trim(), "slow hook after");
  assert.equal(git("status", "--porcelain"), "", "the index matches the new commit");
}

// ── 14. A commit whose pre-commit hook outruns the limit says so (#5781) ────
{
  const { dir, git } = repo();
  hook(dir, "pre-commit", "sleep 6");
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const head = git("rev-parse", "HEAD");
  const commit = await post({ projectRoot: dir, action: "commit", message: "slow hook before" });
  assert.equal(commit.status, 504, JSON.stringify(commit.json));
  assert.match(commit.json.error, /didn't finish within 3 seconds, so nothing was committed; a commit hook may be slow/);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("status", "--porcelain"), " M f.txt\n", "nothing left staged");
}

// ── 15. `status.showUntrackedFiles=no` doesn't hide new files (#5781) ───────
{
  const { dir, git } = repo();
  git("config", "status.showUntrackedFiles", "no");
  writeFileSync(path.join(dir, "new.txt"), "new\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "add new" });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.match(git("show", "--name-only", "--format=", "HEAD"), /^new\.txt$/m);
}

// ── 16. A name in either Unicode form finds its file (#5781) ────────────────
{
  const { dir, git } = repo();
  const nfd = "cafe\u0301.txt";
  writeFileSync(path.join(dir, nfd), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "cafe");
  writeFileSync(path.join(dir, nfd), "two\n");
  for (const name of [nfd, nfd.normalize("NFC")]) {
    const diff = await get({ projectRoot: dir, path: name });
    assert.equal(diff.status, 200, `${JSON.stringify(name)}: ${JSON.stringify(diff.json)}`);
    assert.match(diff.json.diff, /^\+two$/m);
  }
}

// ── 17. Diffs for a removed file, a rename and a new file (#5781) ───────────
{
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "gone.txt"), "bye\n");
  writeFileSync(path.join(dir, "old.txt"), "one\ntwo\nthree\nfour\n");
  git("add", "-A");
  git("commit", "-q", "-m", "more");
  git("rm", "-q", "gone.txt");
  git("mv", "old.txt", "new.txt");
  writeFileSync(path.join(dir, "new.txt"), "one\ntwo\nthree\nFOUR\n");
  writeFileSync(path.join(dir, "fresh.txt"), "fresh\n");
  const removed = await get({ projectRoot: dir, path: "gone.txt" });
  assert.match(removed.json.diff, /^deleted file mode/m, "a git rm'd file shows its deletion");
  assert.match(removed.json.diff, /^-bye$/m);
  const renamed = await get({ projectRoot: dir, path: "new.txt" });
  assert.match(renamed.json.diff, /^rename from old\.txt$/m, "a rename reads as one");
  assert.match(renamed.json.diff, /^-four$/m);
  assert.doesNotMatch(renamed.json.diff, /^\+one$/m, "not as a whole new file");
  const fresh = await get({ projectRoot: dir, path: "fresh.txt" });
  assert.match(fresh.json.diff, /^\+\+\+ b\/fresh\.txt$/m);
  assert.ok(!fresh.json.diff.includes(scratch), "no absolute path in the headers");
}

// ── 18. Before the first commit, a staged file diffs from nothing (#5781) ───
{
  const { dir, git } = repo({ commit: false });
  writeFileSync(path.join(dir, "start.txt"), "hello\n");
  git("add", "-A");
  const staged = await get({ projectRoot: dir, path: "start.txt" });
  assert.equal(staged.status, 200, JSON.stringify(staged.json));
  assert.match(staged.json.diff, /^\+hello$/m, "the staged file's start shows");
}

// ── 19. A folder that's gone says so (#5781) ───────────────────────────────
{
  const gone = await get({ projectRoot: path.join(workspace, "never-made") });
  assert.equal(gone.status, 404, JSON.stringify(gone.json));
  assert.equal(gone.json.missingRoot, true, "the desk can tell a gone folder from a failure");
}

// An independent process, an agent in the session's terminal: outside the
// commit's process tree, its environment and its private index.
const agentGit = (dir, args) =>
  `env -i PATH="$PATH" HOME="${process.env.HOME}" GIT_CONFIG_GLOBAL="${process.env.GIT_CONFIG_GLOBAL}" GIT_CONFIG_NOSYSTEM=1 git -C "${dir}" ${args}`;
const reviewed = async (dir) =>
  (await get({ projectRoot: dir })).json.files.map((file) => ({ path: file.path, changeVersion: file.changeVersion }));

// ── 20. Another process's commit during the desk's isn't the desk's (#5795) ─
// It was reported as landed, with the agent's commit (and the desk's reviewed
// file, swept in by `-a`) offered for a PR as the desk's own.
{
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "agent.txt"), "agent\n");
  git("add", "agent.txt");
  git("commit", "-q", "-m", "seed agent file");
  hook(dir, "pre-commit", ['echo "agent edit" > agent.txt', agentGit(dir, 'commit -q --no-verify -am "agent: wip"')].join("\n"));
  writeFileSync(path.join(dir, "f.txt"), "desk edit\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "desk: reviewed change", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 500, JSON.stringify(commit.json));
  assert.match(commit.json.error, /another commit landed on cave\/\S+ while the desk was committing, and it isn't the desk's$/);
  assert.equal(git("log", "-1", "--format=%s").trim(), "agent: wip", "the agent's commit is kept");
  assert.match(git("rev-parse", "--abbrev-ref", "HEAD").trim(), /^cave\//, "and the checkout stays on it");
  assert.ok(!git("log", "--all", "--format=%s").includes("desk: reviewed change"));
}

// ── 21. A hook that refuses while another process commits is a refusal ─────
{
  const { dir, git } = repo();
  hook(dir, "pre-commit", [
    "echo agent > agent.txt",
    agentGit(dir, "add agent.txt"),
    agentGit(dir, 'commit -q --no-verify -m "agent: unrelated work"'),
    'echo "lint failed: 3 problems" >&2',
    "exit 1",
  ].join("\n"));
  writeFileSync(path.join(dir, "f.txt"), "desk edit\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "desk: wire it", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 500, JSON.stringify(commit.json));
  assert.match(commit.json.error, /^commit failed: lint failed: 3 problems; another commit landed/);
  assert.ok(!git("log", "--all", "--format=%s").includes("desk: wire it"));
  assert.equal(git("status", "--porcelain"), " M f.txt\n", "the desk's edit is left as it was");
}

// ── 22. A file another process stages during the commit stays out (#5795) ──
// The commit staged the reviewed files, then committed the whole index.
{
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "f.txt"), "reviewed desk edit\n");
  const expectedChanges = await reviewed(dir);
  hook(dir, "pre-commit", ['echo "never reviewed" > secret.txt', agentGit(dir, "add secret.txt")].join("\n"));
  const commit = await post({ projectRoot: dir, action: "commit", message: "desk: reviewed", expectedChanges });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.equal(git("show", "--name-only", "--format=", "HEAD").trim(), "f.txt", "only the reviewed file");
  assert.equal(git("status", "--porcelain"), "A  secret.txt\n", "the other staging is kept, and the index matches the commit");
}

// ── 23. A reviewed commit whose post-commit hook outruns the limit landed ──
// Judged by its private index's tree (#5795); the real index then matches.
{
  const { dir, git } = repo();
  hook(dir, "post-commit", "sleep 6");
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  writeFileSync(path.join(dir, "new.txt"), "new\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "reviewed slow hook after", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.match(commit.json.warning, /^the commit landed, but a hook after it was still running after 3 seconds$/);
  assert.equal(git("log", "-1", "--format=%s").trim(), "reviewed slow hook after");
  assert.equal(git("status", "--porcelain"), "", "the real index learned the commit");
}

console.log("changes route git states: ok");

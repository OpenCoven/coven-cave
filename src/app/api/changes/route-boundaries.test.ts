// @ts-nocheck
/**
 * The changes route at its boundaries (#5795): the paired phone, a .env
 * file's contents, the environment repository hooks and `gh` receive, where
 * `gh` is found, branch names, a separate push URL, the PR lookup's cache,
 * and the summary every poll shares. Each drives the real handler against
 * throwaway repositories.
 *
 * The server's PATH here holds no `gh`, like the desktop sidecar's: only a
 * folder of the tools git and the hooks need. The fake `gh` is on the PATH
 * the login shell reports, which is where the user's Homebrew `gh` lives.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), "changes-boundaries-")));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const workspace = path.join(scratch, "workspace");
mkdirSync(workspace);

// The tools git, its signing and the hooks need, found on the PATH this test
// started with; never `gh`. `git` logs each run, so the summary's processes
// can be counted.
const tools = path.join(scratch, "tools");
mkdirSync(tools);
const which = (name) => {
  try {
    return execFileSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};
const realGit = which("git");
for (const name of ["ssh-keygen", "sh", "env", "cat", "sleep", "mkdir", "rm", "sed", "tr", "uname", "basename", "dirname"]) {
  const found = which(name);
  if (found) symlinkSync(found, path.join(tools, name));
}
const gitLog = path.join(scratch, "git.log");
writeFileSync(path.join(tools, "git"), `#!/bin/sh\necho "$*" >> "${gitLog}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });

const fakebin = path.join(scratch, "fakebin");
mkdirSync(fakebin);
const ghLog = path.join(scratch, "gh.log");
const ghEnvLog = path.join(scratch, "gh.env");
writeFileSync(
  path.join(fakebin, "gh"),
  `#!/bin/sh\necho "$*" >> "${ghLog}"\nenv >> "${ghEnvLog}"\ncase "$1" in\n  api) echo "[]" ;;\n  pr) echo "https://github.com/acme/widget/pull/42" ;;\nesac\n`,
  { mode: 0o755 },
);
const loginShell = path.join(scratch, "login-shell");
writeFileSync(loginShell, `#!/bin/sh\necho "${fakebin}:${tools}"\n`, { mode: 0o755 });

process.env.PATH = tools;
process.env.SHELL = loginShell;
process.env.HOME = path.join(scratch, "home");
mkdirSync(process.env.HOME);
process.env.WORKSPACE_ROOT = workspace;
process.env.COVEN_HOME = path.join(scratch, "coven-home");
process.env.COVEN_CAVE_HOME = path.join(scratch, "coven-home", "cave");
process.env.CAVE_PROJECTS_PATH_OVERRIDE = path.join(scratch, "no-projects.json");
const permissionConfig = path.join(scratch, "permission-config.json");
process.env.CAVE_PERMISSION_CONFIG_PATH_OVERRIDE = permissionConfig;
process.env.GIT_CONFIG_GLOBAL = path.join(scratch, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GH_CONFIG_DIR = path.join(scratch, "gh-config");
process.env.COVEN_CAVE_GIT_LONG_TIMEOUT_MS = "8000";
// Stand-ins for the desktop sidecar's own secrets (names seen on a live one).
process.env.COVEN_CAVE_AUTH_TOKEN = "cave-secret-auth";
process.env.COVEN_CAVE_ACCESS_TOKEN = "cave-secret-access";
const signingKey = path.join(scratch, "signing-key");
execFileSync(path.join(tools, "ssh-keygen"), ["-q", "-t", "ed25519", "-N", "", "-f", signingKey]);
writeFileSync(
  process.env.GIT_CONFIG_GLOBAL,
  `[user]\n\tname = Test\n\temail = test@example.com\n\tsigningkey = ${signingKey}\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = false\n`,
);

const { GET, POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const { branchPrCache } = await import("../../../lib/branch-pr-context.ts");

const PHONE = { "x-coven-cave-mobile-access": "1" };
const post = async (body, headers = {}) => {
  const res = await POST(new NextRequest("http://127.0.0.1/api/changes", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: await res.json() };
};
const get = async (params, headers = {}) => {
  const res = await GET(new NextRequest(`http://127.0.0.1/api/changes?${new URLSearchParams(params)}`, { headers }));
  return { status: res.status, json: await res.json() };
};

let count = 0;
function repo() {
  const dir = path.join(workspace, `repo-${count++}`);
  mkdirSync(dir);
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "f.txt"), "base\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { dir, git };
}
/** A repository with a local bare origin whose default is main. */
function withRemote() {
  const { dir, git } = repo();
  const bare = `${dir}.git`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  git("remote", "add", "origin", bare);
  git("push", "-q", "-u", "origin", "main");
  git("remote", "set-head", "origin", "-a");
  const remoteTip = (branch) => execFileSync("git", ["--git-dir", bare, "rev-parse", `refs/heads/${branch}`], { encoding: "utf8" }).trim();
  return { dir, git, bare, remoteTip };
}
const read = (dir, rel) => (existsSync(path.join(dir, rel)) ? readFileSync(path.join(dir, rel), "utf8") : null);
const reviewed = async (dir) =>
  (await get({ projectRoot: dir })).json.files.map((file) => ({ path: file.path, changeVersion: file.changeVersion }));
const hook = (dir, name, body) => {
  writeFileSync(path.join(dir, ".git", "hooks", name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
};
/** Commit what's changed through the desk, then open its PR. */
async function commitAndOpenPr(dir, message = "Desk change") {
  const commit = await post({ projectRoot: dir, action: "commit", message, expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  const pr = await post({
    projectRoot: dir,
    action: "create-pr",
    title: "Desk PR",
    expectedBranch: commit.json.branch,
    expectedHead: commit.json.headOid,
  });
  return { commit, pr };
}

// ── 1. The phone's Git writes follow its file-edit opt-in (#5795) ──────────
// With phone saves off, a revert from the phone deleted an untracked file.
{
  const { dir } = repo();
  writeFileSync(path.join(dir, "new.txt"), "agent work\n");
  writeFileSync(permissionConfig, JSON.stringify({ version: 1, allowMobileFileWrites: false }));
  const refused = await post({ projectRoot: dir, path: "new.txt", confirmUntracked: true }, PHONE);
  assert.equal(refused.status, 403, JSON.stringify(refused.json));
  assert.match(refused.json.error, /Allow file edits from phone/);
  assert.equal(read(dir, "new.txt"), "agent work\n", "nothing was reverted");
  for (const body of [
    { action: "commit", message: "from the phone" },
    { action: "create-pr", title: "from the phone" },
    { action: "switch-branch", branch: "main" },
    { action: "create-worktree", branch: "phone-wt" },
    { action: "checkpoint" },
  ]) {
    assert.equal((await post({ projectRoot: dir, ...body }, PHONE)).status, 403, body.action);
  }
  const list = await get({ projectRoot: dir }, PHONE);
  assert.equal(list.status, 200, "reading stays open to the phone");
  assert.deepEqual(list.json.files.map((file) => file.path), ["new.txt"]);

  writeFileSync(permissionConfig, JSON.stringify({ version: 1, allowMobileFileWrites: true }));
  const allowed = await post({ projectRoot: dir, path: "new.txt", confirmUntracked: true }, PHONE);
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.equal(read(dir, "new.txt"), null, "with the opt-in on, the phone can revert");
  rmSync(permissionConfig);
}

// ── 2. A .env file's contents stay out of diffs and checkpoint text ─────────
{
  const { dir, git } = repo();
  mkdirSync(path.join(dir, "config"));
  writeFileSync(path.join(dir, "config", ".Env.production"), "TOKEN=old\n");
  git("add", "-A");
  git("commit", "-q", "-m", "config");
  writeFileSync(path.join(dir, ".env"), "API_KEY=supersecret\n");
  writeFileSync(path.join(dir, "config", ".Env.production"), "TOKEN=supersecret-prod\n");
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  for (const file of [".env", "config/.Env.production"]) {
    const diff = await get({ projectRoot: dir, path: file });
    assert.equal(diff.status, 200, `${file}: ${JSON.stringify(diff.json)}`);
    assert.doesNotMatch(diff.json.diff, /supersecret/, `${file}: no secret in its diff`);
    assert.match(diff.json.diff, /A \.env file changed\. Its contents aren't shown/);
  }
  assert.match((await get({ projectRoot: dir, path: "f.txt" })).json.diff, /^\+edited$/m, "other diffs are whole");

  const checkpoint = await post({ projectRoot: dir, action: "checkpoint" });
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint.json));
  const name = path.basename(checkpoint.json.checkpointPath);
  const text = await get({ projectRoot: dir, checkpoint: name });
  assert.equal(text.status, 200);
  assert.doesNotMatch(text.json.patch, /supersecret/, "the checkpoint text holds no secret");
  assert.match(text.json.patch, /^diff --git a\/\.env b\/\.env\n# A \.env file changed/m, "but says the file is in it");
  assert.match(text.json.patch, /^\+edited$/m, "and shows the other files' changes");
  assert.match(readFileSync(checkpoint.json.checkpointPath, "utf8"), /supersecret/, "the file itself keeps the contents");

  // So a restore still brings them back.
  const revert = await post({ projectRoot: dir, path: ".env", confirmUntracked: true });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.equal(read(dir, ".env"), null);
  const restore = await post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: path.basename(revert.json.checkpointPath) });
  assert.equal(restore.status, 200, JSON.stringify(restore.json));
  assert.equal(read(dir, ".env"), "API_KEY=supersecret\n");
}

// ── 3. Hooks and `gh` run without Cave's secrets, and `gh` is found ─────────
// A pre-push hook recorded COVEN_CAVE_AUTH_TOKEN; and on the desktop's PATH
// the desk said "GitHub CLI (gh) not found" after pushing (#5795).
{
  const { dir, remoteTip } = withRemote();
  const dumps = path.join(scratch, "hook-env");
  mkdirSync(dumps);
  for (const name of ["pre-commit", "post-commit", "pre-push"]) hook(dir, name, `env > "${path.join(dumps, name)}"`);
  writeFileSync(path.join(dir, "f.txt"), "desk change\n");
  writeFileSync(ghEnvLog, "");
  writeFileSync(ghLog, "");
  const { commit, pr } = await commitAndOpenPr(dir);
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  assert.equal(pr.json.url, "https://github.com/acme/widget/pull/42");
  assert.match(readFileSync(ghLog, "utf8"), /^pr create /m, "the gh on the login shell's PATH opened it");
  assert.equal(remoteTip(commit.json.branch), commit.json.headOid);
  for (const [name, text] of [
    ...["pre-commit", "post-commit", "pre-push"].map((name) => [name, readFileSync(path.join(dumps, name), "utf8")]),
    ["gh", readFileSync(ghEnvLog, "utf8")],
  ]) {
    assert.match(text, /^HOME=/m, `${name}: its environment was recorded`);
    assert.doesNotMatch(text, /cave-secret|COVEN_CAVE_/, `${name}: no Cave secret`);
  }
}

// ── 3b. A refused commit's rollback runs its hooks without them too ────────
// Committing from main makes a `cave/` branch; when a hook refuses, the
// rollback checks main out again, which runs post-checkout.
{
  const { dir, git } = repo();
  const dump = path.join(scratch, "post-checkout.env");
  hook(dir, "post-checkout", `env >> "${dump}"`);
  hook(dir, "pre-commit", 'echo "lint failed" >&2\nexit 1');
  writeFileSync(path.join(dir, "f.txt"), "refused\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "Refused", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 500, JSON.stringify(commit.json));
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD").trim(), "main", "rolled back");
  const text = readFileSync(dump, "utf8");
  assert.equal(text.match(/^HOME=/gm)?.length, 2, "post-checkout ran for the branch and for the rollback");
  assert.doesNotMatch(text, /cave-secret|COVEN_CAVE_/);
}

// ── 4. Branch names git takes open a PR (#5795) ────────────────────────────
// The desk's own allow-list refused them after the commit had succeeded.
{
  for (const name of ["fix/café", "feature/issue#12", `long/${"a".repeat(130)}`]) {
    const { dir, git, remoteTip } = withRemote();
    git("checkout", "-q", "-b", name);
    writeFileSync(path.join(dir, "f.txt"), `on ${name}\n`);
    const { commit, pr } = await commitAndOpenPr(dir, `Change on ${name}`);
    assert.equal(commit.json.branch, name, "the commit stays on the branch");
    assert.equal(pr.status, 200, `${name}: ${JSON.stringify(pr.json)}`);
    assert.equal(remoteTip(name), commit.json.headOid);
  }
  const { dir, git } = withRemote();
  git("checkout", "-q", "-b", "feature");
  for (const expectedBranch of ["-f", "a..b", "@{-1}", "has space"]) {
    const pr = await post({ projectRoot: dir, action: "create-pr", title: "Bad", expectedBranch });
    assert.equal(pr.status, 400, `${expectedBranch}: ${JSON.stringify(pr.json)}`);
    assert.equal(pr.json.error, "invalid expected branch");
  }
}

// ── 5. A push URL apart from the fetch URL (#5795) ─────────────────────────
// The push landed; the check asked the fetch URL, and read it as a failure.
{
  const { dir, git, bare, remoteTip } = withRemote();
  git("remote", "set-url", "origin", path.join(scratch, "no-such-fetch-mirror.git"));
  git("remote", "set-url", "--push", "origin", bare);
  writeFileSync(path.join(dir, "f.txt"), "pushed over the push URL\n");
  const { commit, pr } = await commitAndOpenPr(dir);
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  assert.equal(remoteTip(commit.json.branch), commit.json.headOid);

  // A push that fails is still reported as one.
  git("remote", "set-url", "--push", "origin", path.join(scratch, "no-such-push-target.git"));
  writeFileSync(path.join(dir, "f.txt"), "never pushed\n");
  const again = await commitAndOpenPr(dir, "Second change");
  assert.equal(again.pr.status, 502, JSON.stringify(again.pr.json));
  assert.match(again.pr.json.error, /^git push failed: /);
}

// ── 6. Create PR drops the branch's cached PR lookup (#5795) ───────────────
// The lookup kept answering "no PR" for a minute after the desk opened one.
{
  const { dir } = withRemote();
  writeFileSync(path.join(dir, "f.txt"), "for a PR\n");
  const commit = await post({ projectRoot: dir, action: "commit", message: "PR lookup", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  const branch = commit.json.branch;
  assert.equal(await branchPrCache.resolve(dir, branch), null, "no PR yet, and that answer is kept");
  assert.equal(branchPrCache.get(dir, branch), null);
  const pr = await post({ projectRoot: dir, action: "create-pr", title: "PR lookup", expectedBranch: branch, expectedHead: commit.json.headOid });
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  assert.equal(branchPrCache.get(dir, branch), undefined, "the next read asks GitHub again");
}

// ── 6b. The PR lookup finds `gh` the same way (#5795) ──────────────────────
// It ran a bare `gh` on the server's PATH and cached "no PR" when it failed.
{
  const { dir, git } = repo();
  git("remote", "add", "origin", "https://github.com/acme/widget.git");
  writeFileSync(ghLog, "");
  assert.equal(await branchPrCache.resolve(dir, "feature/lookup"), null);
  assert.match(readFileSync(ghLog, "utf8"), /^api -X GET repos\/acme\/widget\/pulls -f head=acme:feature\/lookup /m);
}

// ── 7. One summary read per repository at a time, never stale after a write ─
// Each poll cost 5 git processes and a real path per changed file, in every
// tab (#5795).
{
  const { dir } = repo();
  mkdirSync(path.join(dir, "gen"));
  for (let i = 0; i < 40; i++) writeFileSync(path.join(dir, "gen", `file-${i}.txt`), `${i}\n`);
  writeFileSync(path.join(dir, "f.txt"), "edited\n");

  const realpath = fs.promises.realpath;
  const resolved = [];
  fs.promises.realpath = (target, ...rest) => {
    resolved.push(String(target));
    return realpath(target, ...rest);
  };
  writeFileSync(gitLog, "");
  let polls;
  try {
    polls = await Promise.all(Array.from({ length: 4 }, () => get({ projectRoot: dir })));
  } finally {
    fs.promises.realpath = realpath;
  }
  for (const poll of polls) {
    assert.equal(poll.status, 200);
    assert.equal(poll.json.files.length, 41);
    assert.equal(poll.json.branch, "main");
    assert.equal(poll.json.worktree, null);
  }
  const runs = readFileSync(gitLog, "utf8").trim().split("\n");
  assert.equal(runs.filter((run) => /\bstatus\b/.test(run)).length, 1, `one status for four polls: ${runs.join(" | ")}`);
  assert.equal(runs.filter((run) => /\bdiff\b/.test(run)).length, 1, "one numstat");
  assert.equal(runs.filter((run) => /^rev-parse/.test(run) && !/--show-toplevel/.test(run)).length, 1, "the branch and worktree in one rev-parse");
  assert.equal(resolved.filter((target) => target === path.join(dir, "gen")).length, 1, "one real path for the folder of 40 files");

  // Kept for a moment: a change made outside Cave shows on a later poll.
  writeFileSync(path.join(dir, "outside.txt"), "an agent's write\n");
  assert.ok(!(await get({ projectRoot: dir })).json.files.some((file) => file.path === "outside.txt"), "the kept list answers");
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  assert.ok((await get({ projectRoot: dir })).json.files.some((file) => file.path === "outside.txt"), "and then a fresh one");

  // A write drops it at once: the refresh after a revert or a commit is new.
  const revert = await post({ projectRoot: dir, path: "f.txt" });
  assert.equal(revert.status, 200, JSON.stringify(revert.json));
  assert.ok(!(await get({ projectRoot: dir })).json.files.some((file) => file.path === "f.txt"), "the reverted file is gone from the list");
  const commit = await post({ projectRoot: dir, action: "commit", message: "everything", expectedChanges: await reviewed(dir) });
  assert.equal(commit.status, 200, JSON.stringify(commit.json));
  assert.deepEqual((await get({ projectRoot: dir })).json.files, [], "nothing is left after the commit");
}

console.log("changes route boundaries: ok");

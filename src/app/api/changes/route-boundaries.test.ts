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
// How the fake gh answers, by the word in gh.mode: signed in to github.com
// and github.acme.example (an Enterprise host) unless "signed-out"; `pr
// create` prints a github.com link unless "ghe", "no-url", "exists", "slow"
// or "mute" (fails, saying nothing).
const ghMode = path.join(scratch, "gh.mode");
writeFileSync(
  path.join(fakebin, "gh"),
  [
    "#!/bin/sh",
    `echo "$*" >> "${ghLog}"`,
    `env >> "${ghEnvLog}"`,
    `mode=$(cat "${ghMode}" 2>/dev/null)`,
    'case "$1" in',
    "  api) echo \"[]\" ;;",
    '  auth) case "$mode:$4" in',
    "    signed-out:*) echo \"no oauth token found for $4\" >&2; exit 1 ;;",
    "    *:github.com|*:github.acme.example) echo gho_fake ;;",
    "    *) echo \"no oauth token found for $4\" >&2; exit 1 ;;",
    "  esac ;;",
    '  pr) case "$mode" in',
    "    ghe) echo https://github.acme.example/acme/widget/pull/7 ;;",
    "    no-url) echo \"Creating pull request for the branch\" ;;",
    "    exists) echo 'a pull request for branch \"x\" into branch \"main\" already exists:' >&2; echo https://github.com/acme/widget/pull/41 >&2; exit 1 ;;",
    "    slow) sleep 30 ;;",
    "    mute) exit 1 ;;",
    "    *) echo https://github.com/acme/widget/pull/42 ;;",
    "  esac ;;",
    "esac",
    "",
  ].join("\n"),
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
// https remotes go nowhere: a proxy on a closed port refuses at once, so a
// github.com fetch URL is named without the network.
writeFileSync(
  process.env.GIT_CONFIG_GLOBAL,
  `[user]\n\tname = Test\n\temail = test@example.com\n\tsigningkey = ${signingKey}\n[gpg]\n\tformat = ssh\n[commit]\n\tgpgsign = false\n[http]\n\tproxy = http://127.0.0.1:9\n`,
);
// A fake daemon for folders outside the workspace, on a socket of its own.
process.env.COVEN_SOCKET = path.join(scratch, "d.sock");

const { GET, POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");
const { branchPrCache } = await import("../../../lib/branch-pr-context.ts");
const { withRepositoryMutation } = await import("../../../lib/server/keyed-transaction-lock.ts");

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
/** A repository whose origin is on GitHub by its URL, and pushes to a local
 *  bare repository whose default is main. Create PR opens only on GitHub
 *  (#5795); fetching the https URL fails at once, through the dead proxy. */
function withRemote({ url = "https://github.com/acme/widget.git" } = {}) {
  const { dir, git } = repo();
  const bare = `${dir}.git`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  git("remote", "add", "origin", bare);
  git("push", "-q", "-u", "origin", "main");
  git("remote", "set-head", "origin", "-a");
  git("remote", "set-url", "origin", url);
  git("remote", "set-url", "--push", "origin", bare);
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
// Here the fetch URL is github.com over https, which can't be reached.
{
  const { dir, git, remoteTip } = withRemote();
  assert.throws(() => git("ls-remote", "origin"), "the fetch URL answers nothing");
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const setGhMode = (mode) => writeFileSync(ghMode, mode);
const remoteBranches = (bare) =>
  execFileSync("git", ["--git-dir", bare, "for-each-ref", "--format=%(refname)", "refs/heads"], { encoding: "utf8" }).trim().split("\n");
/** A commit on a feature branch of a fresh withRemote() repository. */
function featureCommit(options) {
  const remote = withRemote(options);
  remote.git("checkout", "-q", "-b", "feature/x");
  writeFileSync(path.join(remote.dir, "f.txt"), "feature work\n");
  remote.git("commit", "-q", "-am", "Feature work");
  return remote;
}

// ── 8. The summary says whether origin is on GitHub (#5795) ────────────────
// The panel offered Create PR for a GitLab, a bare or no remote.
{
  setGhMode("");
  const summary = async (dir) => (await get({ projectRoot: dir })).json.githubOrigin;
  assert.equal(await summary(repo().dir), false, "no origin");
  const folder = withRemote();
  folder.git("remote", "set-url", "origin", folder.bare);
  assert.equal(await summary(folder.dir), false, "a bare repository in a folder");
  assert.equal(await summary(withRemote().dir), true, "github.com");
  assert.equal(await summary(withRemote({ url: "https://github.acme.example/acme/widget.git" }).dir), true, "an Enterprise host gh is signed in to");
  assert.equal(await summary(withRemote({ url: "git@gitlab.com:acme/widget.git" }).dir), false, "GitLab");
}

// ── 9. Create PR asks whether a PR can be opened before pushing (#5795) ────
// The branch was pushed, then left on a GitLab or bare remote, and gh's
// "gh auth login" advice misled.
{
  setGhMode("");
  const refused = async (remote, status, pattern) => {
    writeFileSync(ghLog, "");
    const pr = await post({ projectRoot: remote.dir, action: "create-pr", title: "Refused" });
    assert.equal(pr.status, status, JSON.stringify(pr.json));
    assert.match(pr.json.error, pattern);
    assert.deepEqual(remoteBranches(remote.bare), ["refs/heads/main"], "nothing was pushed");
    assert.doesNotMatch(readFileSync(ghLog, "utf8"), /^pr create/m);
  };
  const folder = featureCommit();
  folder.git("remote", "set-url", "origin", folder.bare);
  await refused(folder, 400, /^origin is a folder on this machine, not a GitHub repository/);
  const gitlab = featureCommit({ url: "https://gitlab.com/acme/widget.git" });
  await refused(gitlab, 400, /^origin is on gitlab\.com, which gh isn't signed in to.*gh auth login --hostname gitlab\.com/);
  setGhMode("signed-out");
  await refused(featureCommit(), 409, /^gh isn't signed in to github\.com; run `gh auth login`/);
  setGhMode("");
  const none = featureCommit();
  none.git("remote", "remove", "origin");
  const pr = await post({ projectRoot: none.dir, action: "create-pr", title: "No remote" });
  assert.equal(pr.status, 400, JSON.stringify(pr.json));
  assert.match(pr.json.error, /^this project has no origin remote/);
}

// ── 10. A branch named like an option is never pushed (#5795) ──────────────
// `-fo` made the push `git push -u -f -o …`: forced, with no refspec.
{
  setGhMode("");
  const remote = featureCommit();
  remote.git("update-ref", "refs/heads/-fo", "HEAD");
  remote.git("symbolic-ref", "HEAD", "refs/heads/-fo");
  writeFileSync(ghLog, "");
  const pr = await post({ projectRoot: remote.dir, action: "create-pr", title: "Dash" });
  assert.equal(pr.status, 400, JSON.stringify(pr.json));
  assert.equal(pr.json.error, `git doesn't take "-fo" as a branch name; rename the branch in a terminal, then open the PR`);
  assert.deepEqual(remoteBranches(remote.bare), ["refs/heads/main"]);
  assert.equal(readFileSync(ghLog, "utf8"), "", "nor was gh asked anything");
}

// ── 11. Create PR's answers say what happened (#5795) ──────────────────────
{
  // gh exited 0 without a link: the form closed with nothing said.
  setGhMode("no-url");
  const quiet = featureCommit();
  const silent = await post({ projectRoot: quiet.dir, action: "create-pr", title: "Quiet" });
  assert.equal(silent.status, 502, JSON.stringify(silent.json));
  assert.match(silent.json.error, /^gh pr create finished without giving a pull request link/);

  // A GitHub Enterprise link came back as raw output.
  setGhMode("ghe");
  const ghe = featureCommit({ url: "https://github.acme.example/acme/widget.git" });
  const enterprise = await post({ projectRoot: ghe.dir, action: "create-pr", title: "Enterprise" });
  assert.equal(enterprise.status, 200, JSON.stringify(enterprise.json));
  assert.equal(enterprise.json.url, "https://github.acme.example/acme/widget/pull/7");

  // An existing PR is a success that says so.
  setGhMode("exists");
  const again = await post({ projectRoot: featureCommit().dir, action: "create-pr", title: "Again" });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.deepEqual([again.json.url, again.json.existed], ["https://github.com/acme/widget/pull/41", true]);

  // A failure that says nothing gives its exit, not the command line.
  setGhMode("mute");
  const mute = await post({ projectRoot: featureCommit().dir, action: "create-pr", title: "Mute", prBody: "BODY-SENTINEL never echoed" });
  assert.equal(mute.status, 502, JSON.stringify(mute.json));
  assert.equal(mute.json.error, "gh pr create failed: exited with status 1");
  setGhMode("");
}

// ── 12. The pushed branch tracks origin (#5795) ────────────────────────────
// `push -u <sha>:refs/heads/<branch>` set no upstream.
{
  setGhMode("");
  const { dir, git, remoteTip } = withRemote();
  writeFileSync(path.join(dir, "f.txt"), "tracked\n");
  const { commit, pr } = await commitAndOpenPr(dir, "Tracked change");
  assert.equal(pr.status, 200, JSON.stringify(pr.json));
  assert.equal(git("rev-parse", "--abbrev-ref", `${commit.json.branch}@{upstream}`).trim(), `origin/${commit.json.branch}`);
  assert.equal(remoteTip(commit.json.branch), commit.json.headOid);
}

// ── 13. Time limits read as time limits, and stop their hooks (#5795) ─────
// They read "Command failed: <the whole command>", the PR body included; a
// push that landed behind a slow server hook read as failed; and a hanging
// pre-push hook kept running after the answer.
{
  process.env.COVEN_CAVE_GIT_LONG_TIMEOUT_MS = "2000";
  try {
    setGhMode("slow");
    const slowGh = featureCommit();
    const pr = await post({ projectRoot: slowGh.dir, action: "create-pr", title: "Slow", prBody: "BODY-SENTINEL never echoed" });
    assert.equal(pr.status, 504, JSON.stringify(pr.json));
    assert.match(pr.json.error, /^gh pr create didn't finish within 2 seconds; the pull request may have been opened anyway/);
    assert.doesNotMatch(pr.json.error, /BODY-SENTINEL|Command failed/);
    setGhMode("");

    // The server's hook runs after the branch moved: the push landed.
    const landed = featureCommit();
    writeFileSync(path.join(landed.bare, "hooks", "post-receive"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    const opened = await post({ projectRoot: landed.dir, action: "create-pr", title: "Landed" });
    assert.equal(opened.status, 200, JSON.stringify(opened.json));
    assert.equal(landed.remoteTip("feature/x"), landed.git("rev-parse", "HEAD").trim());

    // A pre-push hook past the limit: nothing landed, and the hook is stopped.
    const stuck = featureCommit();
    const marker = path.join(scratch, "pre-push-ran-on");
    hook(stuck.dir, "pre-push", `sleep 4\ntouch "${marker}"`);
    const refused = await post({ projectRoot: stuck.dir, action: "create-pr", title: "Stuck" });
    assert.equal(refused.status, 504, JSON.stringify(refused.json));
    assert.equal(
      refused.json.error,
      "git push didn't finish within 2 seconds, and origin doesn't have the commit; a pre-push hook or the network may be slow",
    );
    assert.deepEqual(remoteBranches(stuck.bare), ["refs/heads/main"]);
    await sleep(3_500);
    assert.ok(!existsSync(marker), "the hook was stopped with the push");
  } finally {
    process.env.COVEN_CAVE_GIT_LONG_TIMEOUT_MS = "8000";
  }
}

// ── 14. Reverting a file that's no longer changed is stale (#5795) ─────────
// Another tab committed it, and the revert answered "path not allowed".
{
  const { dir, git } = repo();
  writeFileSync(path.join(dir, "f.txt"), "edited in this tab\n");
  const [row] = (await get({ projectRoot: dir })).json.files;
  git("commit", "-q", "-am", "committed from another tab");
  const revert = await post({ projectRoot: dir, path: "f.txt", expectedChangeVersion: row.changeVersion });
  assert.equal(revert.status, 409, JSON.stringify(revert.json));
  assert.deepEqual(revert.json, { ok: false, stale: true, error: "this file no longer has changes" });
  assert.equal(read(dir, "f.txt"), "edited in this tab\n");
  const outside = await post({ projectRoot: dir, path: "../outside.txt" });
  assert.equal(outside.status, 403, "a path outside the repository is still refused as one");
}

// ── 15. Polls and diffs leave the index alone (#5795) ──────────────────────
// With stat-dirty files, each poll rewrote the index, taking the lock an
// agent's `git add` needs.
{
  const { dir } = repo();
  mkdirSync(path.join(dir, "src"));
  for (let i = 0; i < 20; i++) writeFileSync(path.join(dir, "src", `m${i}.ts`), `${i}\n`);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "modules"], { cwd: dir });
  writeFileSync(path.join(dir, "f.txt"), "edited\n");
  const later = new Date(Date.now() + 3_600_000);
  for (let i = 0; i < 20; i++) fs.utimesSync(path.join(dir, "src", `m${i}.ts`), later, later);
  const index = () => {
    const stat = fs.statSync(path.join(dir, ".git", "index"));
    return `${stat.ino}:${stat.mtimeMs}`;
  };
  const before = index();
  const list = await get({ projectRoot: dir });
  assert.deepEqual(list.json.files.map((file) => [file.path, file.insertions]), [["f.txt", 1]]);
  assert.match((await get({ projectRoot: dir, path: "f.txt" })).json.diff, /^\+edited$/m);
  assert.equal(index(), before, "the index was neither rewritten nor locked");
}

// ── 16. Checkpoint deletes and restores take turns (#5795) ─────────────────
// A delete ran outside the repository lock, and a queued restore whose
// checkpoint went meanwhile failed with a raw ENOENT path.
{
  const { dir } = repo();
  writeFileSync(path.join(dir, "f.txt"), "checkpointed\n");
  const name = path.basename((await post({ projectRoot: dir, action: "checkpoint" })).json.checkpointPath);
  writeFileSync(path.join(dir, "f.txt"), "edited since\n");
  const held = async (during) => {
    let release;
    const holding = withRepositoryMutation(dir, () => new Promise((resolve) => (release = resolve)));
    const answers = await during();
    release();
    await holding;
    return Promise.all(answers);
  };

  // A restore queued first, then a delete: the restore runs, then the delete.
  const [restore, removal] = await held(async () => {
    const restoring = post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: name });
    await sleep(500);
    const deleting = post({ projectRoot: dir, action: "delete-checkpoint", checkpoint: name });
    await sleep(500);
    return [restoring, deleting];
  });
  assert.equal(restore.status, 200, JSON.stringify(restore.json));
  assert.equal(removal.status, 200, JSON.stringify(removal.json));

  // A checkpoint gone by the time its queued restore runs is not found.
  writeFileSync(path.join(dir, "f.txt"), "again\n");
  const second = (await post({ projectRoot: dir, action: "checkpoint" })).json.checkpointPath;
  const [gone] = await held(async () => {
    const restoring = post({ projectRoot: dir, action: "restore-checkpoint", checkpoint: path.basename(second) });
    await sleep(500);
    rmSync(second);
    return [restoring];
  });
  assert.equal(gone.status, 404, JSON.stringify(gone.json));
  assert.deepEqual(gone.json, { ok: false, error: "checkpoint not found" });

  // Taking a checkpoint waits its turn too: its pruning removes old ones.
  let settled = false;
  const [taken] = await held(async () => {
    const taking = post({ projectRoot: dir, action: "checkpoint" }).finally(() => (settled = true));
    await sleep(500);
    assert.equal(settled, false, "the checkpoint waits for the lock");
    return [taking];
  });
  assert.equal(taken.status, 200, JSON.stringify(taken.json));
}

// ── 17. A folder outside the workspace costs no session list per poll ─────
// Each poll downloaded the daemon's whole session list (#5795).
{
  const { createServer } = await import("node:http");
  const outsideRoot = path.join(scratch, "outside");
  mkdirSync(outsideRoot);
  const outsideRepo = (name) => {
    const dir = path.join(outsideRoot, name);
    mkdirSync(dir);
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
    writeFileSync(path.join(dir, "f.txt"), "edited\n");
    return dir;
  };
  const first = outsideRepo("first");
  const second = outsideRepo("second");
  let sessions = [{ project_root: first }, ...Array.from({ length: 500 }, (_, i) => ({ project_root: path.join(outsideRoot, `old-${i}`) }))];
  let version = 1;
  const served = [];
  const daemon = createServer((req, res) => {
    const etag = `"v${version}"`;
    if (req.headers["if-none-match"] === etag) {
      served.push(304);
      res.writeHead(304, { etag });
      return res.end();
    }
    served.push(200);
    res.writeHead(200, { "content-type": "application/json", etag });
    res.end(JSON.stringify(sessions));
  });
  await new Promise((resolve) => daemon.listen(process.env.COVEN_SOCKET, resolve));
  try {
    for (let i = 0; i < 4; i++) {
      const poll = await get({ projectRoot: first });
      assert.equal(poll.status, 200, JSON.stringify(poll.json));
      await sleep(600);
    }
    assert.deepEqual(served, [200], "one read of the list for four polls");
    // A session started since: its folder is asked about afresh.
    sessions = [...sessions, { project_root: second }];
    version++;
    assert.equal((await get({ projectRoot: second })).status, 200, "a new session's folder opens at once");
    assert.deepEqual(served, [200, 200]);
    // A folder no session holds is still refused, after one fresh read.
    const stranger = outsideRepo("stranger");
    assert.equal((await get({ projectRoot: stranger })).status, 403);
    assert.deepEqual(served, [200, 200, 304], "an unchanged list isn't sent again");
  } finally {
    await new Promise((resolve) => daemon.close(resolve));
  }
}

// ── 18. A very large change list is cut, with its totals (#5807) ──────────
// An untracked folder of 30,000 files made a 3.4 MB answer on every poll. The
// list stops at the most one commit may name, and says what it left out.
{
  const { dir } = repo();
  writeFileSync(path.join(dir, "f.txt"), "base\nmore\n");
  mkdirSync(path.join(dir, "bulk"));
  for (let i = 0; i < 5001; i++) writeFileSync(path.join(dir, "bulk", `u${String(i).padStart(5, "0")}.txt`), "x\n");
  const cut = (await get({ projectRoot: dir })).json;
  assert.equal(cut.ok, true, JSON.stringify(cut).slice(0, 200));
  assert.equal(cut.truncated, true);
  assert.equal(cut.totalFiles, 5002, "every changed file is counted");
  assert.equal(cut.files.length, 5000, "only as many as a commit may name are listed");
  assert.deepEqual(cut.totals, { insertions: 1, deletions: 0 }, "the line totals cover the files left out too");

  const { dir: small } = repo();
  writeFileSync(path.join(small, "f.txt"), "edited\n");
  const whole = (await get({ projectRoot: small })).json;
  assert.equal(whole.truncated, false);
  assert.equal(whole.totalFiles, 1);
  assert.equal(whole.files.length, 1);
  assert.deepEqual(whole.totals, { insertions: 1, deletions: 1 });
}

// ── 19. The list names the head commit (#5807) ─────────────────────────────
// A commit the client stopped waiting for can be pinned to its exact commit
// when it turns up landed, because the list now says what HEAD is.
{
  const { dir, git } = repo();
  const head = (await get({ projectRoot: dir })).json;
  assert.equal(head.head, git("rev-parse", "HEAD").trim());
  assert.equal(head.headSubject, "base");

  const unborn = path.join(workspace, `repo-${count++}`);
  mkdirSync(unborn);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: unborn });
  writeFileSync(path.join(unborn, "first.txt"), "first\n");
  const none = (await get({ projectRoot: unborn })).json;
  assert.equal(none.ok, true, JSON.stringify(none));
  assert.equal(none.head, null, "no commit yet, so no head");
  assert.equal(none.headSubject, null);
}

console.log("changes route boundaries: ok");

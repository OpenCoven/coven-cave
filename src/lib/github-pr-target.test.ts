// @ts-nocheck
/**
 * Where a desk pull request belongs (#5795): in origin's parent when origin
 * is a fork, headed `<origin owner>:<branch>`, and always with `--repo`, so
 * `gh` never picks a remote itself. In a plain clone of a fork the PR opened
 * inside the fork; with an `upstream` remote it failed after the push.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createdPullRequestUrl,
  ghHostState,
  githubSlug,
  isGitHubRemoteUrl,
  prCreateArgs,
  prLookupArgs,
  remoteUrlHost,
  resolvePrTarget,
  targetFromRepo,
} from "./github-pr-target.ts";

assert.equal(githubSlug("https://github.com/forkuser/widget.git"), "forkuser/widget");
assert.equal(githubSlug("git@github.com:forkuser/widget.git"), "forkuser/widget");
assert.equal(githubSlug("https://github.com/acme/alpha"), "acme/alpha");
assert.equal(githubSlug("https://gitlab.com/acme/alpha.git"), null);
assert.equal(githubSlug("/tmp/remote.git"), null);

const fork = targetFromRepo("forkuser/widget", {
  fork: true,
  full_name: "forkuser/widget",
  default_branch: "main",
  parent: { full_name: "acme-canonical/widget", default_branch: "trunk" },
});
assert.deepEqual(fork, { base: "acme-canonical/widget", headOwner: "forkuser", baseDefault: "trunk", fork: true });
const own = targetFromRepo("acme/alpha", { fork: false, full_name: "acme/alpha", default_branch: "main" });
assert.deepEqual(own, { base: "acme/alpha", headOwner: "acme", baseDefault: "main", fork: false });

const pr = { base: "main", branch: "cave/fix-it", title: "Fix it", body: "Body" };
assert.deepEqual(
  prCreateArgs(fork, pr),
  ["pr", "create", "--repo", "acme-canonical/widget", "--base", "trunk", "--head", "forkuser:cave/fix-it", "--title", "Fix it", "--body", "Body"],
  "a fork's PR opens in its parent, from the fork's branch",
);
assert.deepEqual(
  prCreateArgs(own, pr),
  ["pr", "create", "--repo", "acme/alpha", "--base", "main", "--head", "cave/fix-it", "--title", "Fix it", "--body", "Body"],
  "otherwise in origin, still named",
);
assert.deepEqual(prCreateArgs(null, pr).slice(0, 4), ["pr", "create", "--base", "main"], "no GitHub origin: as before");
assert.deepEqual(
  prLookupArgs(fork, "cave/fix-it"),
  ["api", "-X", "GET", "repos/acme-canonical/widget/pulls", "-f", "head=forkuser:cave/fix-it", "-f", "state=all", "-f", "per_page=1"],
  "the lookup searches where the PR was opened",
);

// From a checkout's origin, with GitHub's answer injected (no network).
const scratch = mkdtempSync(path.join(tmpdir(), "github-pr-target-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
const repo = (name, url) => {
  const dir = path.join(scratch, name);
  execFileSync("git", ["init", "-q", dir]);
  if (url) execFileSync("git", ["-C", dir, "remote", "add", "origin", url]);
  return dir;
};
const calls = [];
const gh = (answer) => async (cwd, args) => {
  calls.push(args.join(" "));
  if (answer instanceof Error) throw answer;
  return JSON.stringify(answer);
};
const forkAnswer = { fork: true, full_name: "forkuser/widget", parent: { full_name: "acme-canonical/widget", default_branch: "main" } };
assert.deepEqual(
  await resolvePrTarget(repo("fork", "https://github.com/forkuser/widget.git"), gh(forkAnswer)),
  { base: "acme-canonical/widget", headOwner: "forkuser", baseDefault: "main", fork: true },
);
assert.deepEqual(calls, ["api repos/forkuser/widget"]);
await resolvePrTarget(repo("fork-again", "https://github.com/forkuser/widget.git"), gh(forkAnswer));
assert.equal(calls.length, 1, "cached per repository");
assert.deepEqual(
  await resolvePrTarget(repo("offline", "git@github.com:acme/offline.git"), gh(new Error("gh: not logged in"))),
  { base: "acme/offline", headOwner: "acme", baseDefault: null, fork: false },
  "GitHub unreachable: origin, named",
);
assert.equal(await resolvePrTarget(repo("gitlab", "https://gitlab.com/acme/alpha.git"), gh(forkAnswer)), null);
assert.equal(await resolvePrTarget(repo("no-remote"), gh(forkAnswer)), null);

// ── Whether origin is a GitHub repository at all (#5795) ───────────────────
// Create PR pushed first, then found out: a GitLab or folder origin kept the
// branch, and gh's "gh auth login" advice misled.
assert.equal(remoteUrlHost("https://token@github.com/acme/widget.git"), "github.com", "without the user");
assert.equal(remoteUrlHost("ssh://git@GitHub.Example.com:2222/acme/widget.git"), "github.example.com", "without the port");
assert.equal(remoteUrlHost("git@gitlab.com:acme/widget.git"), "gitlab.com");
assert.equal(remoteUrlHost("/srv/git/widget.git"), null, "a folder");
assert.equal(remoteUrlHost("../widget.git"), null);
assert.equal(remoteUrlHost("file:///srv/git/widget.git"), null);
assert.equal(remoteUrlHost("C:\\repos\\widget.git"), null, "a Windows drive isn't a host");

const hostRunner = (signedIn) => {
  const asked = [];
  const run = async (cwd, args) => {
    asked.push(args.join(" "));
    if (signedIn === "missing") throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
    if (!signedIn.includes(args[3])) throw Object.assign(new Error("no oauth token"), { code: 1 });
    return "gho_secret\n";
  };
  return { run, asked };
};
{
  const { run, asked } = hostRunner(["github.com", "github.acme.example"]);
  assert.equal(await ghHostState(scratch, "github.com", run), "signed-in");
  assert.deepEqual(asked, ["auth token --hostname github.com"], "asked locally, by host");
  assert.equal(await ghHostState(scratch, "gitlab.com", run), "signed-out");
  assert.equal(await ghHostState(scratch, "github.com", hostRunner("missing").run), "no-gh");

  assert.equal(await isGitHubRemoteUrl(scratch, "git@github.com:acme/widget.git", run), true);
  assert.equal(await isGitHubRemoteUrl(scratch, "/srv/git/widget.git", run), false, "a bare remote in a folder");
  assert.equal(await isGitHubRemoteUrl(scratch, "https://github.acme.example/acme/widget.git", run), true, "Enterprise, signed in");
  asked.length = 0;
  assert.equal(await isGitHubRemoteUrl(scratch, "https://gitlab.example.org/acme/widget.git", run), false, "GitLab");
  assert.equal(await isGitHubRemoteUrl(scratch, "https://gitlab.example.org/acme/other.git", run), false);
  assert.deepEqual(asked, ["auth token --hostname gitlab.example.org"], "a host's answer is kept");
}

// gh's own output: github.com or an Enterprise host, else nothing.
assert.equal(createdPullRequestUrl("https://github.com/acme/widget/pull/42\n"), "https://github.com/acme/widget/pull/42");
assert.equal(
  createdPullRequestUrl("Warning: 1 uncommitted change\nhttps://github.acme.example/acme/widget/pull/7\n"),
  "https://github.acme.example/acme/widget/pull/7",
);
assert.equal(createdPullRequestUrl("Creating pull request for cave/x into main\n"), null, "no link");

console.log("github-pr-target: ok");

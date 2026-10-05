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
import { githubSlug, prCreateArgs, prLookupArgs, resolvePrTarget, targetFromRepo } from "./github-pr-target.ts";

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

console.log("github-pr-target: ok");

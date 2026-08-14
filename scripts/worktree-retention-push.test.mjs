import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

import {
  hadRemoteTracking,
  headSha,
  parseWorktrees,
  remoteBranchNames,
  remoteTagCommits,
  retain,
  retentionTag,
  unpushedCount,
  unpushedCountIgnoring,
} from "./worktree-retention-push.mjs";

// Fixtures must not inherit machine-level git config. A global
// `core.hooksPath` points every repo on this machine at one hook directory,
// so a fixture clone or commit would run this project's hooks — correctness
// noise, and tens of seconds per git call.
const ISOLATED = {
  ...process.env,
  GIT_CONFIG_GLOBAL: NULL_DEVICE,
  GIT_CONFIG_SYSTEM: NULL_DEVICE,
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: ISOLATED,
  });
}

// Reading a bare repo by cwd is refused when safe.bareRepository is
// "explicit" (set on some dev machines), so address it as a git dir.
function bare(args, gitDir) {
  return git(["--git-dir", gitDir, ...args], path.dirname(gitDir));
}

function configure(repo) {
  git(["config", "user.email", "test@example.com"], repo);
  git(["config", "user.name", "Test"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
}

// A real bare remote, not a stub: the whole point of this hook is that a
// commit actually leaves the machine, and a mocked push proves nothing.
function scaffold() {
  const root = mkdtempSync(path.join(tmpdir(), "retention-push-"));
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  git(["init", "--bare", "-b", "main", remote], root);
  git(["clone", remote, work], root);
  configure(work);
  writeFileSync(path.join(work, "seed.txt"), "seed\n");
  git(["add", "-A"], work);
  git(["commit", "-m", "seed"], work);
  git(["push", "origin", "main"], work);
  return { root, remote, work };
}

function commit(work, name) {
  writeFileSync(path.join(work, `${name}.txt`), `${name}\n`);
  git(["add", "-A"], work);
  git(["commit", "-m", name], work);
}

test("parseWorktrees reads paths and skips nothing it was given", () => {
  const records = parseWorktrees("worktree /a\nHEAD abc\n\nworktree /b\nbare\n");
  assert.deepEqual(
    records.map((r) => [r.path, r.bare]),
    [
      ["/a", false],
      ["/b", true],
    ],
  );
});

test("retentionTag flattens slashes so sibling branches cannot collide", () => {
  const a = retentionTag("fix/cave-1", "abcdef1234567");
  const b = retentionTag("fix/cave-1/sub", "abcdef1234567");
  assert.equal(a, "retention/fix-cave-1-abcdef123");
  assert.notEqual(a, b);
  // git cannot hold a tag and a directory of the same name; a flattened name
  // is never a prefix-directory of its sibling.
  assert.ok(!b.startsWith(`${a}/`));
});

test("retentionTag names the exact commit, so a second push never force-updates", () => {
  assert.notEqual(retentionTag("b", "1111111111"), retentionTag("b", "2222222222"));
});

test("unpushedCount counts only commits absent from every remote", () => {
  const { root, work } = scaffold();
  try {
    assert.equal(unpushedCount(work), 0);
    commit(work, "one");
    commit(work, "two");
    assert.equal(unpushedCount(work), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The regression that made the deleted-branch archive path unreachable in the
// exact case it was written for (cave-fud4p, round two). `--remotes` trusts
// every refs/remotes/* to still exist on the remote, and a remote-tracking ref
// outlives the remote deleting its branch, so a squash-merged head reads as
// fully retained and the hook skips it before ever consulting deletedUpstream.
//
// The fixture reproduces the real sequence rather than asserting on a mock: a
// pushed branch, a squash merge landing a DIFFERENT commit on main, then the
// server-side branch deletion `delete_branch_on_merge` performs. Deleting the
// ref inside the bare remote is what makes it server-side — `git push
// --delete` would also drop the local tracking ref, which is precisely the
// signal that must survive.
test("a squash-merged, remote-deleted head is at risk even though --remotes says otherwise", () => {
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/topic"], work);
    commit(work, "one");
    git(["push", "-q", "-u", "origin", "feat/topic"], work);
    const head = git(["rev-parse", "HEAD"], work).trim();

    // Squash merge: a different commit for the same tree lands on main, so the
    // branch tip is an ancestor of nothing the remote keeps.
    const mainWork = path.join(root, "mainwork");
    git(["clone", "-q", remote, mainWork], root);
    configure(mainWork);
    git(["merge", "-q", "--squash", "origin/feat/topic"], mainWork);
    git(["commit", "-q", "-m", "squashed topic (#1)"], mainWork);
    git(["push", "-q", "origin", "main"], mainWork);

    // delete_branch_on_merge, server-side.
    bare(["update-ref", "-d", "refs/heads/feat/topic"], remote);
    git(["fetch", "-q", "origin", "main"], work); // a normal fetch: prunes nothing

    // The state the hook has to read correctly.
    assert.equal(hadRemoteTracking(work, "feat/topic"), true, "the tracking ref survives the deletion");
    assert.ok(!remoteBranchNames(work).has("feat/topic"), "the remote no longer advertises the branch");
    assert.equal(
      bare(["rev-list", "--count", "--all"], remote).trim() !== "0" &&
        bare(["branch", "--contains", head], remote).trim(),
      "",
      "and no remote branch contains the head — the commit is on no remote ref",
    );

    assert.equal(
      unpushedCount(work),
      0,
      "the stale tracking ref makes --remotes report the head as fully retained (the bug)",
    );
    assert.ok(
      unpushedCountIgnoring(work, "refs/remotes/origin/feat/topic") > 0,
      "ignoring that one ref reveals the head is retained by nothing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// End-to-end through the hook's own entry point, because the helpers above
// cannot show what the hook DECIDED. The masking bug lived in main()'s skip
// test, so a fix proven only at helper level would leave the actual behaviour
// untested — the same shape of gap that let this ship the first time.
test("the hook archives a squash-merged, remote-deleted worktree instead of ignoring it", () => {
  const { root, remote, work } = scaffold();
  try {
    // `work` plays the primary checkout; the unit at risk is a worktree of it.
    const unit = path.join(work, ".worktrees", "topic");
    git(["worktree", "add", "-q", "-b", "feat/topic", unit], work);
    configure(unit);
    commit(unit, "one");
    git(["push", "-q", "-u", "origin", "feat/topic"], unit);
    const head = git(["rev-parse", "HEAD"], unit).trim();

    const mainWork = path.join(root, "mainwork");
    git(["clone", "-q", remote, mainWork], root);
    configure(mainWork);
    git(["merge", "-q", "--squash", "origin/feat/topic"], mainWork);
    git(["commit", "-q", "-m", "squashed topic (#1)"], mainWork);
    git(["push", "-q", "origin", "main"], mainWork);
    bare(["update-ref", "-d", "refs/heads/feat/topic"], remote);

    execFileSync(process.execPath, [path.join(import.meta.dirname, "worktree-retention-push.mjs")], {
      cwd: work,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...ISOLATED, CLAUDE_PROJECT_DIR: work },
    });

    // Retained as a TAG at the exact head — not resurrected as a branch.
    const tag = retentionTag("feat/topic", head);
    assert.equal(bare(["rev-parse", `refs/tags/${tag}`], remote).trim(), head, "the head is archived on the remote");
    assert.equal(
      bare(["for-each-ref", "--format=%(refname)", "refs/heads/feat/topic"], remote).trim(),
      "",
      "and the deliberately deleted branch stays deleted",
    );

    const log = readFileSync(path.join(work, ".claude", "worktree-retention-push.log"), "utf8")
      .split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const entry = log.find((row) => row.branch === "feat/topic");
    assert.equal(entry.verdict, "pushed-tag");
    assert.equal(entry.reason, "branch-deleted-upstream", "and the record says WHY it was archived");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unpushedCountIgnoring still counts every OTHER remote ref", () => {
  const { root, work } = scaffold();
  try {
    // HEAD is on main, which the remote has; ignoring an unrelated branch's ref
    // must not turn that into "at risk".
    assert.equal(unpushedCountIgnoring(work, "refs/remotes/origin/feat/unrelated"), 0);
    commit(work, "one");
    assert.equal(unpushedCountIgnoring(work, "refs/remotes/origin/feat/unrelated"), 1);
    // Ignoring a ref that does not exist is a no-op, not an error.
    assert.equal(unpushedCountIgnoring(work, "refs/remotes/origin/nope"), unpushedCount(work));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retain pushes the branch, and the commit really lands on the remote", () => {
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/topic"], work);
    commit(work, "one");
    const sha = git(["rev-parse", "HEAD"], work).trim();

    const result = retain(work, root, "feat/topic");

    assert.equal(result.verdict, "pushed-branch");
    assert.equal(bare(["rev-parse", "refs/heads/feat/topic"], remote).trim(), sha);
    git(["fetch", "-q", "origin"], work);
    assert.equal(unpushedCount(work), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retain falls back to a tag when the branch push is refused", () => {
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/topic"], work);
    commit(work, "one");
    git(["push", "-q", "origin", "feat/topic"], work);

    // Diverge the remote so a plain (non-forced) branch push must be refused,
    // which is the real shape of the fallback: two sessions on one branch.
    const clone = path.join(root, "other");
    git(["clone", "-q", remote, clone], root);
    configure(clone);
    git(["checkout", "-q", "feat/topic"], clone);
    commit(clone, "theirs");
    git(["push", "-q", "origin", "feat/topic"], clone);

    commit(work, "mine");
    const sha = git(["rev-parse", "HEAD"], work).trim();

    const result = retain(work, root, "feat/topic");

    assert.equal(result.verdict, "pushed-tag");
    assert.equal(bare(["rev-parse", `refs/tags/${result.tag}^{commit}`], remote).trim(), sha);
    // The other session's branch tip is untouched — retention never rewrites.
    assert.notEqual(bare(["rev-parse", "refs/heads/feat/topic"], remote).trim(), sha);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retain retains a detached HEAD, which has no branch to push", () => {
  const { root, remote, work } = scaffold();
  try {
    commit(work, "one");
    const sha = git(["rev-parse", "HEAD"], work).trim();
    git(["checkout", "-q", "--detach", sha], work);

    const result = retain(work, root, null);

    assert.equal(result.verdict, "pushed-tag");
    assert.equal(bare(["rev-parse", `refs/tags/${result.tag}^{commit}`], remote).trim(), sha);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remoteTagCommits sees a pushed tag, which --remotes never can", () => {
  // The exact shape of the cave-nw3hq incident: a merged branch is archived as
  // a pushed tag and deleted from the remote. `git rev-list --not --remotes`
  // still calls its commits unpushed, because remote-tracking refs exist for
  // branches and never for tags — so the hook re-created twelve branches it had
  // just been asked to retire.
  const { root, work } = scaffold();
  try {
    git(["checkout", "-b", "fix/archived"], work);
    commit(work, "one");
    git(["push", "origin", "fix/archived"], work);
    const head = headSha(work);

    // Archive exactly as the retirement route does, then drop the branch.
    git(["tag", "-a", "archive/fix-archived-2026-08-10", "-m", "archive", head], work);
    git(["push", "origin", "archive/fix-archived-2026-08-10"], work);
    git(["push", "origin", "--delete", "fix/archived"], work);
    git(["fetch", "--prune", "origin"], work);

    assert.ok(
      unpushedCount(work) > 0,
      "precondition: with the branch gone, --remotes alone calls this unpushed",
    );

    const tags = remoteTagCommits(work);
    assert.ok(tags instanceof Set, "the remote answered");
    assert.ok(
      tags.has(head),
      "the archived head is advertised as a tag, so it is retained after all",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remoteTagCommits collects the peeled commit of an annotated tag", () => {
  // An annotated tag advertises the TAG OBJECT at refs/tags/x and the commit at
  // refs/tags/x^{}. Reading only the first would compare a tag-object id against
  // a commit id and never match — the check would silently never fire.
  const { root, work } = scaffold();
  try {
    commit(work, "two");
    git(["push", "origin", "main"], work);
    const head = headSha(work);
    git(["tag", "-a", "annotated-example", "-m", "annotated", head], work);
    git(["push", "origin", "annotated-example"], work);

    const tags = remoteTagCommits(work);
    assert.ok(tags.has(head), "the peeled commit is present, not just the tag object");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remoteTagCommits returns null when the remote cannot be reached", () => {
  // No proof means push, which is the safe direction: a redundant ref costs
  // nothing, a skipped push leaves commits on one machine.
  const { root, work } = scaffold();
  try {
    git(["remote", "set-url", "origin", path.join(root, "does-not-exist.git")], work);
    assert.equal(remoteTagCommits(work), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remoteBranchNames reads the heads the remote advertises", () => {
  const { root, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/live"], work);
    commit(work, "one");
    git(["push", "-q", "origin", "feat/live"], work);

    const names = remoteBranchNames(work);
    assert.ok(names instanceof Set);
    assert.ok(names.has("feat/live"), "a pushed branch is advertised");
    assert.ok(names.has("main"));
    assert.ok(!names.has("feat/never-pushed"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remoteBranchNames returns null when the remote cannot be reached", () => {
  // Null is "no proof of deletion", which keeps the branch-first path — the
  // same safe direction remoteTagCommits takes.
  const { root, work } = scaffold();
  try {
    git(["remote", "set-url", "origin", path.join(root, "does-not-exist.git")], work);
    assert.equal(remoteBranchNames(work), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hadRemoteTracking separates a deleted branch from one never pushed", () => {
  // This is the whole distinction the deleted-upstream rule rests on: both are
  // absent from `ls-remote --heads`, and only one must not be re-created.
  //
  // The branch is dropped ON THE REMOTE rather than with `git push --delete`,
  // because that is what GitHub's delete_branch_on_merge does — and the two are
  // not equivalent locally: `push --delete` also removes this clone's
  // refs/remotes/origin/<branch>, while a server-side deletion leaves it until
  // something prunes. Deleting through the clone here would test a shape that
  // never occurs and would report the rule broken when it is not.
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/was-pushed"], work);
    commit(work, "one");
    git(["push", "-q", "origin", "feat/was-pushed"], work);
    bare(["update-ref", "-d", "refs/heads/feat/was-pushed"], remote);

    assert.equal(
      hadRemoteTracking(work, "feat/was-pushed"),
      true,
      "the remote-tracking ref survives the remote deleting the branch",
    );

    git(["checkout", "-q", "-b", "feat/fresh"], work);
    commit(work, "two");
    assert.equal(
      hadRemoteTracking(work, "feat/fresh"),
      false,
      "a branch that never left the machine has no remote-tracking ref",
    );
    assert.equal(hadRemoteTracking(work, null), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retain with preferTag archives the head WITHOUT resurrecting the deleted branch", () => {
  // The cave-fud4p case end to end: squash-merge + delete_branch_on_merge. The
  // branch is gone from the remote and the squash put a DIFFERENT commit on
  // main, so this head is on no remote ref at all. Pushing the branch would
  // succeed and undo the deletion, so retention has to be the tag.
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "fix/merged-topic"], work);
    commit(work, "one");
    git(["push", "-q", "origin", "fix/merged-topic"], work);
    const sha = git(["rev-parse", "HEAD"], work).trim();

    // Squash the work onto main as a different commit, exactly as GitHub does.
    git(["checkout", "-q", "main"], work);
    git(["merge", "-q", "--squash", "fix/merged-topic"], work);
    git(["commit", "-q", "-m", "squashed topic (#1)"], work);
    git(["push", "-q", "origin", "main"], work);
    // ...then auto-delete the head branch, server-side as GitHub does.
    bare(["update-ref", "-d", "refs/heads/fix/merged-topic"], remote);
    git(["checkout", "-q", "fix/merged-topic"], work);

    assert.ok(
      !remoteBranchNames(work).has("fix/merged-topic"),
      "precondition: the remote no longer has the branch",
    );
    assert.notEqual(
      bare(["rev-parse", "refs/heads/main"], remote).trim(),
      sha,
      "precondition: the squash landed a different commit, so this head is unretained",
    );

    const result = retain(work, root, "fix/merged-topic", { preferTag: true });

    assert.equal(result.verdict, "pushed-tag");
    assert.equal(result.reason, "branch-deleted-upstream");
    assert.equal(bare(["rev-parse", `refs/tags/${result.tag}^{commit}`], remote).trim(), sha);
    assert.throws(
      () => bare(["rev-parse", "--verify", "refs/heads/fix/merged-topic"], remote),
      "the deleted branch must NOT come back",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retain still pushes the branch when preferTag is not set", () => {
  // Guards the default: only a proven upstream deletion diverts to a tag, so
  // ordinary in-progress work is still retained as a readable branch.
  const { root, remote, work } = scaffold();
  try {
    git(["checkout", "-q", "-b", "feat/in-progress"], work);
    commit(work, "one");
    const sha = git(["rev-parse", "HEAD"], work).trim();

    const result = retain(work, root, "feat/in-progress");

    assert.equal(result.verdict, "pushed-branch");
    assert.equal(bare(["rev-parse", "refs/heads/feat/in-progress"], remote).trim(), sha);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

import { parseWorktrees, retain, retentionTag, unpushedCount } from "./worktree-retention-push.mjs";

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

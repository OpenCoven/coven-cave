// @ts-nocheck
// #5608: the chat list reads branch, origin URL and base ref from a
// repository's files instead of spawning git. Each answer must match what git
// itself reports, and anything the files cannot settle must come back
// `undefined` so the caller asks git.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readDefaultBaseRef, readHeadBranch, readOriginUrl } from "./git-ref-files.ts";

const scratch = mkdtempSync(path.join(tmpdir(), "git-ref-files-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

function fixture(name, files) {
  const dir = path.join(scratch, name);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  mkdirSync(path.join(dir, "refs"), { recursive: true });
  return dir;
}

// ── HEAD ────────────────────────────────────────────────────────────────────
{
  const dir = fixture("head", { HEAD: "ref: refs/heads/feat/nested-name\n" });
  assert.equal(readHeadBranch(dir), "feat/nested-name");
  writeFileSync(path.join(dir, "HEAD"), `${"a".repeat(40)}\n`);
  assert.equal(readHeadBranch(dir), null, "detached HEAD is a definite no-branch");
  writeFileSync(path.join(dir, "HEAD"), "ref: refs/remotes/origin/main\n");
  assert.equal(readHeadBranch(dir), undefined, "a non-branch symref is left to git");
  assert.equal(readHeadBranch(path.join(scratch, "missing")), undefined);
  assert.equal(readHeadBranch(null), undefined);
}

// ── origin URL ──────────────────────────────────────────────────────────────
{
  const dir = fixture("config", {
    config: [
      "[core]",
      "\trepositoryformatversion = 0",
      '[remote "upstream"]',
      "\turl = https://github.com/other/repo.git",
      '[Remote "origin"]',
      "\tURL = git@github.com:acme/repo.git # trailing comment",
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[branch "main"]',
      "\tremote = origin",
    ].join("\n"),
  });
  assert.equal(readOriginUrl(dir, dir), "git@github.com:acme/repo.git");

  const none = fixture("config-none", { config: "[core]\n\tbare = false\n" });
  assert.equal(readOriginUrl(none, none), null, "no origin is a definite none");

  const multi = fixture("config-multi", {
    config: '[remote "origin"]\n\turl = https://a.example/one\n\turl = https://a.example/two\n',
  });
  assert.equal(readOriginUrl(multi, multi), "https://a.example/two", "the last value wins, as with --get");

  const include = fixture("config-include", { config: "[include]\n\tpath = ~/shared.gitconfig\n" });
  assert.equal(readOriginUrl(include, include), undefined, "includes are left to git");

  const escaped = fixture("config-escaped", { config: '[remote "origin"]\n\turl = "C:\\\\repo"\n' });
  assert.equal(readOriginUrl(escaped, escaped), undefined, "escapes are left to git");

  const worktree = fixture("config-worktree", { "config.worktree": "[core]\n" });
  assert.equal(readOriginUrl(worktree, dir), undefined, "per-worktree config is left to git");
}

// ── base ref ────────────────────────────────────────────────────────────────
{
  const symbolic = fixture("base-symbolic", { "refs/remotes/origin/HEAD": "ref: refs/remotes/origin/trunk\n" });
  assert.equal(readDefaultBaseRef(symbolic), "origin/trunk");

  const packed = fixture("base-packed", {
    "packed-refs": `# pack-refs with: peeled fully-peeled sorted\n${"b".repeat(40)} refs/remotes/origin/master\n`,
  });
  assert.equal(readDefaultBaseRef(packed), "origin/master");

  const local = fixture("base-local", { "refs/heads/main": `${"c".repeat(40)}\n` });
  assert.equal(readDefaultBaseRef(local), "main");

  const nothing = fixture("base-nothing", {});
  assert.equal(readDefaultBaseRef(nothing), undefined, "no usual ref: git decides");

  const reftable = fixture("base-reftable", { "reftable/tables.list": "" });
  assert.equal(readDefaultBaseRef(reftable), undefined, "reftable repositories are left to git");
}

// ── parity with real git, when it is installed ─────────────────────────────
let hasGit = true;
try {
  execFileSync("git", ["--version"], { stdio: "ignore" });
} catch {
  hasGit = false;
}
if (hasGit) {
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const tryRun = (cwd, ...args) => {
    try {
      return run(cwd, ...args) || null;
    } catch {
      return null;
    }
  };
  const repo = path.join(scratch, "real-repo");
  mkdirSync(repo);
  run(repo, "init", "-q", "-b", "main");
  run(repo, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "one");
  run(repo, "remote", "add", "origin", "git@github.com:acme/real.git");
  run(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  run(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  run(repo, "pack-refs", "--all");
  const worktree = path.join(scratch, "real-worktree");
  run(repo, "worktree", "add", "-q", "-b", "feat/wt", worktree);

  for (const root of [repo, worktree]) {
    const gitDir = path.resolve(root, run(root, "rev-parse", "--git-dir"));
    const commonDir = path.resolve(root, run(root, "rev-parse", "--git-common-dir"));
    assert.equal(readHeadBranch(gitDir), tryRun(root, "branch", "--show-current"), `branch at ${root}`);
    assert.equal(readOriginUrl(gitDir, commonDir), tryRun(root, "config", "--get", "remote.origin.url"), `origin at ${root}`);
    assert.equal(
      readDefaultBaseRef(commonDir),
      tryRun(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"),
      `base ref at ${root}`,
    );
  }

  run(worktree, "checkout", "-q", "--detach");
  const detachedGitDir = path.resolve(worktree, run(worktree, "rev-parse", "--git-dir"));
  assert.equal(readHeadBranch(detachedGitDir), null);
  assert.equal(tryRun(worktree, "branch", "--show-current"), null);
}

console.log("git-ref-files.test.ts: all assertions passed");

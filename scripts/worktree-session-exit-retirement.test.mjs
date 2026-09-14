import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "worktree-session-exit-retirement.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull },
  }).trim();
}

function scaffold() {
  const dir = mkdtempSync(join(tmpdir(), "wt-exit-retire-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "T");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

function run(dir, args = [], env = process.env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
}

function assertRetired(result) {
  assert.ifError(result.error);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /retired[\s\S]*no status probe or Git operation was attempted/);
  assert.match(result.stderr, /Branch Curator[\s\S]*authorization[\s\S]*deletion proof/);
}

for (const locked of [false, true]) {
  test(`refuses automatic removal of a clean merged worktree, locked=${locked}`, () => {
    const dir = scaffold();
    try {
      const worktree = join(dir, "wt-safe");
      git(dir, "worktree", "add", "-q", "-b", "feat/safe", worktree, "main");
      if (locked) {
        git(dir, "worktree", "lock", "--reason", "another active session", worktree);
      }
      const beforeRegistration = git(dir, "worktree", "list", "--porcelain");
      const beforeHead = git(dir, "rev-parse", "feat/safe");

      assertRetired(run(dir));
      assert.equal(existsSync(worktree), true);
      assert.equal(git(dir, "rev-parse", "feat/safe"), beforeHead);
      assert.equal(git(dir, "worktree", "list", "--porcelain"), beforeRegistration);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("retains dirty, unmerged, and primary worktrees", () => {
  const dir = scaffold();
  try {
    const dirty = join(dir, "wt-dirty");
    const live = join(dir, "wt-live");
    git(dir, "worktree", "add", "-q", "-b", "feat/dirty", dirty, "main");
    writeFileSync(join(dirty, "draft.txt"), "keep\n");
    git(dir, "worktree", "add", "-q", "-b", "feat/live", live, "main");
    git(live, "commit", "-qm", "ahead", "--allow-empty");
    const beforeRegistration = git(dir, "worktree", "list", "--porcelain");
    const beforeRefs = git(dir, "show-ref", "--heads");

    assertRetired(run(dir));
    assert.equal(existsSync(dir), true);
    assert.equal(existsSync(dirty), true);
    assert.equal(existsSync(live), true);
    assert.equal(readFileSync(join(dirty, "draft.txt"), "utf8"), "keep\n");
    assert.equal(git(dir, "branch", "--show-current"), "main");
    assert.equal(git(dir, "show-ref", "--heads"), beforeRefs);
    assert.equal(git(dir, "worktree", "list", "--porcelain"), beforeRegistration);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stale invocations refuse before any status, tracker, or Git subprocess", () => {
  const dir = mkdtempSync(join(tmpdir(), "wt-exit-refusal-"));
  try {
    const bin = join(dir, "bin");
    const marker = join(dir, "subprocess-called");
    mkdirSync(bin);
    for (const name of ["node", "git", "bd"]) {
      writeFileSync(join(bin, name),
        `#!/bin/sh\nprintf called > ${JSON.stringify(marker)}\nexit 99\n`,
        { mode: 0o755 });
    }
    const env = { ...process.env, PATH: [bin, process.env.PATH ?? ""].join(delimiter) };
    for (const args of [[], ["--apply"], ["--json"]]) {
      assertRetired(run(dir, args, env));
      assert.equal(existsSync(marker), false, "even a read-only probe must not run");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("automatic hooks and routine package commands cannot invoke retired cleanup", () => {
  const settings = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.doesNotMatch(
    JSON.stringify(settings.hooks),
    /worktree-session-exit-retirement|wt:retire-on-exit/,
  );
  assert.equal(packageJson.scripts["wt:retire-on-exit"], undefined);
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /worktree-session-exit-retirement\.mjs/);
});

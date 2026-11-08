#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DISPOSABLE_FILES,
  DISPOSABLE_ROOTS,
  SOFT_TARGETS,
  assessPark,
  assessThin,
  disposablePathSafety,
  isDisposableRelative,
  mutationExitCode,
  parkedPathConfigKey,
  worktreeSlug,
} from "./worktree-hygiene.mjs";
import { launchAgentPlist } from "./worktree-hygiene-schedule.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "worktree-hygiene.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  }).trim();
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env: process.env });
}

function repo() {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-hygiene-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Cave Hygiene Contract");
  git(dir, "config", "user.email", "cave-hygiene@example.invalid");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(dir, "README.md"), "seed\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-qm", "seed");
  return dir;
}

function fakeRow(overrides = {}) {
  return {
    path: "/tmp/wt",
    branch: "feat/cave-test-safe",
    head: "a".repeat(40),
    verdict: "ACTIVE",
    locked: false,
    ...overrides,
  };
}

function details(overrides = {}) {
  return {
    tracked: { ok: true, paths: [], error: null },
    ignored: { ok: true, paths: [".next/cache/data"], error: null },
    operation: null,
    ...overrides,
  };
}

// Tool output every working worktree gains (#5726) is disposable; a source
// file that merely shares the extension or sits in a subdirectory is not.
for (const generated of ["next-env.d.ts", "tsconfig.tsbuildinfo", "server.mjs"]) {
  assert.ok(DISPOSABLE_FILES.includes(generated), `${generated} is declared disposable`);
  assert.equal(isDisposableRelative(generated), true, `${generated} is disposable at the worktree root`);
  assert.equal(isDisposableRelative(`./${generated}`), true, `./${generated} normalizes to the root file`);
}
assert.equal(isDisposableRelative("src/next-env.d.ts"), false, "only the root next-env.d.ts is generated output");
assert.equal(isDisposableRelative("packages/app/tsconfig.tsbuildinfo"), false, "only the root build cache is declared");
assert.equal(isDisposableRelative("src/types.d.ts"), false, "ordinary declaration files are never disposable");
assert.equal(isDisposableRelative("src/server.mjs"), false, "a nested server module is source, not the root build output");

// Generated iOS output (#5816) is disposable at its exact paths. The build
// folder can hold evidence screenshots, and the sources XcodeGen reads are work.
const iosApp = "apps/ios/CovenCave";
for (const generated of [
  `${iosApp}/CovenCave.xcodeproj`,
  `${iosApp}/CovenCave.xcodeproj/project.pbxproj`,
  `${iosApp}/CovenCave/Resources/markdown.html`,
  `${iosApp}/CovenCave/Resources/markdown.css`,
  `${iosApp}/CovenCave/Resources/markdown-mermaid.js`,
  `${iosApp}/CovenCave/Resources/markdown-highlight.js`,
]) {
  assert.equal(isDisposableRelative(generated), true, `${generated} is generated iOS output`);
}
for (const kept of [
  `${iosApp}/build`,
  `${iosApp}/build/project-filter-shots/1-all.png`,
  `${iosApp}/project.yml`,
  `${iosApp}/CovenCave/Resources`,
  `${iosApp}/CovenCave/Resources/notes.md`,
  `${iosApp}/CovenCave/CovenCaveApp.swift`,
  "apps/ios/markdown/markdown.css",
  `${iosApp}/Other.xcodeproj`,
]) {
  assert.equal(isDisposableRelative(kept), false, `${kept} is not disposable`);
}

assert.equal(SOFT_TARGETS.attachedWorktrees, 10);
assert.equal(SOFT_TARGETS.detachedWorktrees, 2);
assert.equal(SOFT_TARGETS.localBranches, 15);

const plist = launchAgentPlist({
  node: "/opt/node/bin/node",
  hygieneScript: "/repo/scripts/worktree-hygiene.mjs",
  repo: "/repo",
  logPath: "/tmp/hygiene.log",
});
assert.match(plist, /<string>scheduled<\/string>/);
assert.match(plist, /<string>--fetch<\/string>/);
assert.match(plist, /<string>--json<\/string>/);
assert.doesNotMatch(plist, /--apply/, "scheduled automation must remain report-only");
assert.doesNotMatch(plist, /WT_GUARD_BYPASS/, "scheduled automation must never bypass the worktree guard");

for (const value of [
  ".next/cache/foo",
  "node_modules/react/index.js",
  "coverage/report.json",
  "target/debug/app",
  "src-tauri/target/release/app",
  "test-results/x/result.json",
  "public/pdf.worker.min.mjs",
  ".claude/worktree-autolock.log",
]) {
  assert.equal(isDisposableRelative(value), true, `${value} should be disposable`);
}

for (const value of [
  "src/app/page.tsx",
  "docs/design.md",
  "public/brand/logo.svg",
  ".env",
  "apps/ios/Secrets.plist",
]) {
  assert.equal(isDisposableRelative(value), false, `${value} must never be disposable`);
}

assert.equal(worktreeSlug("feat/cave-123-something"), "cave-123-something");
assert.equal(worktreeSlug("fix/cave/unsafe"), "cave-unsafe");
assert.doesNotMatch(
  parkedPathConfigKey("feat/cave-hlv.5-pr-bridge"),
  /cave-hlv/,
  "branch punctuation must not alter git-config key structure",
);

assert.equal(mutationExitCode({ ok: true }), 0);
assert.equal(mutationExitCode({ ok: false }), 2, "partial or failed mutations must exit nonzero");

// Recursive cleanup must never traverse an intermediate symlink out of a
// worktree. A terminal disposable symlink is safe because rmSync unlinks the
// link itself; an ancestor symlink can redirect recursive traversal.
{
  const dir = mkdtempSync(path.join(tmpdir(), "cave-hygiene-symlink-"));
  const wt = path.join(dir, "wt");
  const outside = path.join(dir, "outside");
  try {
    mkdirSync(wt);
    mkdirSync(outside);
    symlinkSync(outside, path.join(wt, ".next"), "dir");
    const unsafe = disposablePathSafety(wt, ".next/cache/blob");
    assert.equal(unsafe.ok, false);
    assert.match(unsafe.reason, /symlink ancestor/);

    rmSync(path.join(wt, ".next"));
    symlinkSync(outside, path.join(wt, "public-pdf-link"), "dir");
    const terminal = disposablePathSafety(wt, "public-pdf-link");
    assert.equal(terminal.ok, true, "terminal symlinks may be unlinked without traversal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

assert.deepEqual(assessThin(fakeRow(), details()), { eligible: true, reasons: [] });
assert.equal(
  assessThin(fakeRow({ verdict: "WEDGED" }), details({ operation: "merge" })).eligible,
  false,
  "unfinished operations must refuse thinning",
);
assert.equal(
  assessThin(fakeRow(), details({ tracked: { ok: true, paths: ["src/app/page.tsx"], error: null } })).eligible,
  false,
  "tracked changes must refuse thinning",
);
assert.equal(
  assessThin(fakeRow(), details({ ignored: { ok: false, paths: [], error: "probe failed" } })).eligible,
  false,
  "ignored-state probe failures must refuse thinning",
);

const retained = { ok: true, retained: true, via: "refs/heads/feat/cave-test-safe" };
assert.equal(assessPark(fakeRow(), details(), retained).eligible, true);
assert.equal(assessPark(fakeRow({ branch: "main" }), details(), retained).eligible, false, "protected branches must never park");
assert.equal(assessPark(fakeRow({ locked: true }), details(), retained).eligible, false, "locked worktrees must not park implicitly");
assert.equal(
  assessPark(fakeRow(), details(), { ok: true, retained: false, reason: "unretained" }).eligible,
  false,
  "unretained heads must refuse parking",
);
assert.equal(
  assessPark(
    fakeRow(),
    details({ ignored: { ok: true, paths: ["public/brand/logo.svg"], error: null } }),
    retained,
  ).eligible,
  false,
  "non-disposable ignored state would be destroyed by parking and must refuse",
);

const workflow = readFileSync(path.join(root, ".github", "workflows", "worktree-hygiene-contract.yml"), "utf8");
assert.doesNotMatch(workflow, /pnpm\/action-setup/, "dependency-free contract workflow must not initialize an unused pnpm store");
assert.doesNotMatch(workflow, /^\s*cache:\s*pnpm\s*$/m, "dependency-free contract workflow must not cache a store it never creates");

// Integration: default thin is dry-run and does not remove generated state.
// --apply removes only ignored, allowlisted output while preserving the branch.
{
  const dir = repo();
  try {
    const wt = path.join(dir, "wt");
    git(dir, "worktree", "add", "-q", "-b", "feat/cave-test-thin", wt, "main");
    writeFileSync(path.join(wt, ".gitignore"), ".next/\n");
    git(wt, "add", ".gitignore");
    git(wt, "commit", "-qm", "ignore build state");
    git(dir, "merge", "--ff-only", "feat/cave-test-thin");
    writeFileSync(path.join(wt, ".next-placeholder"), "kept");
    let result = run(dir, "thin", "--branch", "feat/cave-test-thin");
    assert.equal(result.status, 0);
    let report = JSON.parse(result.stdout);
    assert.equal(report.refused.length, 1, "untracked work must refuse thinning");
    rmSync(path.join(wt, ".next-placeholder"));

    mkdirSync(path.join(wt, ".next", "cache"), { recursive: true });
    writeFileSync(path.join(wt, ".next", "cache", "blob"), "x".repeat(1024));
    result = run(dir, "thin", "--branch", "feat/cave-test-thin");
    assert.equal(result.status, 0);
    report = JSON.parse(result.stdout);
    assert.equal(report.candidates.length, 1);
    assert.equal(readFileSync(path.join(wt, ".next", "cache", "blob"), "utf8").length, 1024);

    result = run(dir, "thin", "--branch", "feat/cave-test-thin", "--apply");
    assert.equal(result.status, 0);
    assert.equal(existsSync(path.join(wt, ".next", "cache", "blob")), false);
    assert.equal(run(dir, "daily", "--json").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// #6425: unlink each ignored terminal link even after an earlier sorted entry
// removes its target. Existing dangling links and chains must also disappear;
// neither an external target nor tracked source with the same basename is work
// that this cleanup owns.
{
  const dir = repo();
  try {
    const wt = path.join(dir, "wt");
    const branch = "fix/issue-6425-thin-fixture";
    git(dir, "worktree", "add", "-q", "-b", branch, wt, "main");
    writeFileSync(path.join(wt, ".gitignore"), "/server.mjs\nsrc-tauri/resources/\n.env\n");
    mkdirSync(path.join(wt, "src"));
    writeFileSync(path.join(wt, "src", "server.mjs"), "tracked source\n");
    git(wt, "add", ".gitignore", "src/server.mjs");
    git(wt, "commit", "-qm", "seed generated-output fixture");
    const resources = path.join(wt, "src-tauri", "resources");
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, "a-real.dylib"), "generated library\n");
    symlinkSync("a-real.dylib", path.join(resources, "b-link.dylib"));
    symlinkSync("b-link.dylib", path.join(resources, "c-chain.dylib"));
    symlinkSync("missing.dylib", path.join(resources, "d-dangling.dylib"));
    const outside = path.join(dir, "outside.txt");
    writeFileSync(outside, "outside target\n");
    symlinkSync(outside, path.join(resources, "e-outside.dylib"));
    writeFileSync(path.join(wt, "server.mjs"), "generated bundle\n");
    writeFileSync(path.join(wt, ".env"), "non-disposable fixture\n");

    let result = run(dir, "thin", "--branch", branch);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(path.join(wt, "server.mjs"), "utf8"), "generated bundle\n");
    assert.equal(lstatSync(path.join(resources, "d-dangling.dylib")).isSymbolicLink(), true);

    result = run(dir, "thin", "--branch", branch, "--apply");
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).refused, []);
    for (const name of ["a-real.dylib", "b-link.dylib", "c-chain.dylib", "d-dangling.dylib", "e-outside.dylib"]) {
      assert.throws(() => lstatSync(path.join(resources, name)), { code: "ENOENT" }, `${name} must be unlinked, not merely dangling`);
    }
    assert.equal(existsSync(path.join(wt, "server.mjs")), false, "remove the ignored root bundle");
    assert.equal(readFileSync(path.join(wt, "src", "server.mjs"), "utf8"), "tracked source\n");
    assert.equal(readFileSync(path.join(wt, ".env"), "utf8"), "non-disposable fixture\n");
    assert.equal(readFileSync(outside, "utf8"), "outside target\n");
    assert.equal(git(wt, "status", "--porcelain"), "", "tracked source stays clean");
    assert.equal(run(dir, "thin", "--branch", branch, "--apply").status, 0, "a rerun handles already-removed entries");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// CLI hardening: mutations require an explicit target and --max is bounded.
{
  const dir = repo();
  try {
    assert.notEqual(run(dir, "thin").status, 0);
    assert.notEqual(run(dir, "park", "--all-eligible", "--max", "0").status, 0);
    assert.notEqual(run(dir, "unpark", "--branch", "main").status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Unpark must restore the exact parked path; deriving a new slug can put a
// custom-path worktree back in the wrong place.
{
  const dir = repo();
  try {
    const remote = path.join(dir, "origin.git");
    mkdirSync(remote);
    git(remote, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", remote);
    git(dir, "switch", "-q", "-c", "feat/cave-test-custom-path");
    git(dir, "push", "-q", "-u", "origin", "feat/cave-test-custom-path");
    git(dir, "switch", "-q", "main");
    const customPath = path.join(dir, "custom", "nested", "worktree");
    git(dir, "config", "--local", parkedPathConfigKey("feat/cave-test-custom-path"), customPath);

    const result = run(dir, "unpark", "--branch", "feat/cave-test-custom-path");
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).path, customPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Replacing the tracker must refuse legacy mutations before touching Git,
// not discover an unavailable safety proof after removing a worktree.
{
  const dir = repo();
  try {
    const remote = path.join(dir, "origin.git");
    mkdirSync(remote);
    git(remote, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", remote);
    const branch = "feat/cave-test.round-trip";
    const customPath = path.join(dir, "custom", "round-trip");
    git(dir, "worktree", "add", "-q", "-b", branch, customPath, "main");
    git(dir, "push", "-q", "-u", "origin", branch);
    const fakeBin = path.join(dir, "round-trip-bin");
    mkdirSync(fakeBin);
    const marker = path.join(dir, "git-was-invoked");
    const fakeGit = path.join(fakeBin, "git");
    writeFileSync(
      fakeGit,
      `#!/bin/sh\nprintf called > ${JSON.stringify(marker)}\nexit 99\n`,
    );
    chmodSync(fakeGit, 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    const beforeRegistration = git(dir, "worktree", "list", "--porcelain");
    const beforeConfig = git(dir, "config", "--local", "--list");
    for (const args of [
      ["park", "--branch", branch, "--apply"],
      ["unpark", "--branch", branch, "--apply"],
      ["park", "--all-eligible", "--max", "2", "--apply"],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /--apply unavailable: there is no lifecycle proof to verify it/);
      assert.equal(result.stdout, "");
    }
    assert.equal(existsSync(marker), false, "refuse before even the first Git query");
    assert.equal(existsSync(customPath), true);
    assert.equal(git(dir, "worktree", "list", "--porcelain"), beforeRegistration);
    assert.equal(git(dir, "config", "--local", "--list"), beforeConfig);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Weekly reports remain useful without a lifecycle tracker.
{
  const dir = repo();
  try {
    const result = spawnSync(process.execPath, [script, "weekly", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.authoritativeLifecycle, null);
    assert.equal(report.retirementAuthority, "unavailable");
    assert.ok(report.remoteHygiene, "preserve independent remote-hygiene reporting");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("worktree hygiene contract: ok");

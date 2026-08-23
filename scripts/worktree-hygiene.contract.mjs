#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  return spawnSync("node", [script, ...args], { cwd, encoding: "utf8", env: process.env });
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

// Keep the hygiene allowlist mechanically aligned with the canonical lifecycle
// policy. A new category may be added there without automatically becoming
// deletable here, but anything hygiene claims disposable must remain canonical.
const lifecycle = readFileSync(path.join(root, "src", "lib", "worktree-lifecycle.ts"), "utf8");
for (const entry of [...DISPOSABLE_ROOTS, ...DISPOSABLE_FILES]) {
  assert.ok(
    lifecycle.includes(`"${entry}"`),
    `hygiene disposable path ${entry} must also exist in src/lib/worktree-lifecycle.ts`,
  );
}

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

console.log("worktree hygiene contract: ok");

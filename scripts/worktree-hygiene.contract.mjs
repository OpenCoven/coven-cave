#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  lifecycleUnitPostcondition,
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

const lifecycleItem = {
  branch: "feat/cave-test-safe",
  head: "a".repeat(40),
  kind: "worktree",
  path: "/tmp/custom-cave-worktree",
  lane: "active",
  reasons: [],
};
assert.equal(
  lifecycleUnitPostcondition(
    { items: [lifecycleItem] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
  ).ok,
  true,
  "unpark must accept the exact authoritative worktree identity",
);
assert.equal(
  lifecycleUnitPostcondition(
    { items: [{ ...lifecycleItem, path: "/tmp/different-worktree" }] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
  ).ok,
  false,
  "unpark must reject a lifecycle path mismatch",
);
assert.equal(
  lifecycleUnitPostcondition(
    { items: [{ ...lifecycleItem, lane: "uncertain" }] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
  ).ok,
  false,
  "unpark must reject an uncertain lifecycle unit",
);
for (const malformed of [
  { ...lifecycleItem, path: undefined },
  { ...lifecycleItem, reasons: { unexpected: true }, lane: "recovery" },
]) {
  assert.doesNotThrow(() => lifecycleUnitPostcondition(
    { items: [malformed] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
  ));
  assert.equal(
    lifecycleUnitPostcondition(
      { items: [malformed] },
      { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
    ).ok,
    false,
    "malformed lifecycle data must fail closed without throwing",
  );
}
assert.equal(
  lifecycleUnitPostcondition(
    { items: [{ ...lifecycleItem, lane: "future-lane" }] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
  ).ok,
  false,
  "unknown lifecycle lanes must fail closed",
);
assert.doesNotThrow(() => lifecycleUnitPostcondition(
  { items: [null, "malformed"] },
  { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "worktree", path: lifecycleItem.path },
));
assert.equal(
  lifecycleUnitPostcondition(
    { items: [{ ...lifecycleItem, kind: "branch-only", path: null, lane: "cooldown" }] },
    { branch: lifecycleItem.branch, head: lifecycleItem.head, kind: "branch-only", path: null },
  ).ok,
  true,
  "park must accept an exact healthy branch-only lifecycle unit",
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

// Applied park/unpark persists, restores, and then clears a custom path.
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
    const registeredCustomPath = realpathSync(customPath);

    const fakeBin = path.join(dir, "round-trip-bin");
    mkdirSync(fakeBin);
    const fakeNode = path.join(fakeBin, "node");
    const head = git(dir, "rev-parse", branch);
    writeFileSync(
      fakeNode,
      `#!/bin/sh\ncase "$*" in *worktree-lifecycle-patrol.ts*) if git -C ${JSON.stringify(dir)} worktree list --porcelain | grep -Fq ${JSON.stringify(`branch refs/heads/${branch}`)}; then printf '%s\\n' ${JSON.stringify(JSON.stringify({ items: [{ branch, head, kind: "worktree", path: registeredCustomPath, lane: "active", reasons: [] }] }))}; else printf '%s\\n' ${JSON.stringify(JSON.stringify({ items: [{ branch, head, kind: "branch-only", path: null, lane: "cooldown", reasons: [] }] }))}; fi ;; *) exec ${JSON.stringify(process.execPath)} "$@" ;; esac\n`,
    );
    chmodSync(fakeNode, 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    let result = spawnSync(process.execPath, [script, "park", "--branch", branch, "--apply"], { cwd: dir, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(customPath), false);
    assert.equal(git(dir, "config", "--local", parkedPathConfigKey(branch)), registeredCustomPath);

    result = spawnSync(process.execPath, [script, "unpark", "--branch", branch, "--apply"], { cwd: dir, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(customPath), true);
    assert.equal(
      spawnSync("git", ["config", "--local", "--get", parkedPathConfigKey(branch)], { cwd: dir }).status,
      1,
      "successful unpark must clear the recorded path",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A failed destructive attempt consumes the budget, stops the batch, and
// exits nonzero even when rollback restores the first worktree.
{
  const dir = repo();
  try {
    const remote = path.join(dir, "origin.git");
    mkdirSync(remote);
    git(remote, "init", "-q", "--bare");
    git(dir, "remote", "add", "origin", remote);
    for (const branch of ["feat/cave-test-first", "feat/cave-test-second"]) {
      const wt = path.join(dir, branch.endsWith("first") ? "first-custom" : "second-custom");
      git(dir, "worktree", "add", "-q", "-b", branch, wt, "main");
      git(dir, "push", "-q", "-u", "origin", branch);
    }

    const fakeBin = path.join(dir, "fake-bin");
    mkdirSync(fakeBin);
    const fakeNode = path.join(fakeBin, "node");
    writeFileSync(
      fakeNode,
      `#!/bin/sh\ncase "$*" in *worktree-lifecycle-patrol.ts*) printf '{"items":[]}\\n' ;; *) exec ${JSON.stringify(process.execPath)} "$@" ;; esac\n`,
    );
    chmodSync(fakeNode, 0o755);
    const result = spawnSync(
      process.execPath,
      [script, "park", "--all-eligible", "--max", "2", "--apply"],
      { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
    );
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.rolledBack.length, 1);
    assert.equal(
      git(dir, "worktree", "list", "--porcelain").includes("branch refs/heads/feat/cave-test-second"),
      true,
      "the second eligible worktree must not be mutated after the first attempt fails",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("worktree hygiene contract: ok");

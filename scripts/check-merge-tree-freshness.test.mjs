// Content-based staleness guard for PR CI checkouts (cave-d9xfq).
//
// Exercises scripts/check-merge-tree-freshness.mjs against a fixture "GitHub"
// (a bare origin repo with refs/pull/<n>/merge and refs/pull/<n>/head) and
// CI-style SHALLOW checkouts of the merge commit — the exact shape
// actions/checkout produces on a pull_request event. The three measured
// failure classes from the bead are reproduced end to end:
//   • fresh checkout of the current merge ref            -> pass
//   • checkout PREDATES the current merge ref (reopen)   -> fail (false RED
//     class, #4922/#4940)
//   • checkout predates the code under test entirely     -> fail (false GREEN
//     class, #4934)
//
// The guard is a CLI (it calls process.exit), so it is exercised by spawning
// it, never by importing it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-merge-tree-freshness.mjs", import.meta.url));
const PR_NUMBER = "7";

function git(args, cwd) {
  const res = spawnSync("git", args, { encoding: "utf8", cwd });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function write(seed, relPath, contents) {
  const target = path.join(seed, relPath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

// Build a fixture "GitHub" plus CI-style shallow checkouts.
//   stale=false: refs/pull/7/{head,merge} point at h1/m1 and the main checkout
//                sits on m1 — the healthy state.
//   stale=true:  refs/pull/7/{head,merge} are re-created at h2/m2 (a close/
//                reopen with a new head) while the main checkout still sits on
//                m1 — the exact stale state this guard exists to catch.
// Either way checkoutBase is a shallow checkout of the pre-PR base commit.
function makeFixture({ stale = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "merge-freshness-"));
  const origin = path.join(root, "origin.git");
  const seed = path.join(root, "seed");

  git(["init", "--bare", "-q", origin]);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], origin);
  git(["clone", "-q", origin, seed]);
  git(["config", "user.email", "t@t"], seed);
  git(["config", "user.name", "T"], seed);
  git(["config", "commit.gpgsign", "false"], seed);

  // Base commit on main, WITH files: a realistic baseline. The false-green
  // probe needs a base tree that has files yet lacks the PR's entirely.
  write(seed, "base.txt", "base\n");
  write(seed, "tests/a.test.mjs", "import { test } from 'node:test';\n");
  write(seed, "tests/b.test.mjs", "import { test } from 'node:test';\n");
  git(["add", "-A"], seed);
  git(["commit", "-q", "-m", "base"], seed);
  const base = git(["rev-parse", "HEAD"], seed);
  git(["push", "-q", "-u", "origin", "main"], seed);

  // Topic branch: the PR adds feature.txt + tests/c.test.mjs.
  git(["checkout", "-q", "-b", "topic"], seed);
  write(seed, "feature.txt", "feature\n");
  write(seed, "tests/c.test.mjs", "import { test } from 'node:test';\n");
  git(["add", "-A"], seed);
  git(["commit", "-q", "-m", "feature"], seed);
  const h1 = git(["rev-parse", "HEAD"], seed);

  // First merge ref: the value at the original pull_request event.
  git(["checkout", "-q", "main"], seed);
  git(["merge", "-q", "--no-ff", "topic", "-m", "Merge pull request #7 from topic"], seed);
  const m1 = git(["rev-parse", "HEAD"], seed);
  git(["push", "-q", "origin", "main"], seed);
  git(["update-ref", `refs/pull/${PR_NUMBER}/head`, h1], origin);
  git(["update-ref", `refs/pull/${PR_NUMBER}/merge`, m1], origin);

  // CI-style checkout: shallow, detached at the merge commit.
  const checkout = path.join(root, "checkout");
  git(["clone", "-q", "--no-checkout", "--depth=1", origin, checkout]);
  git(["fetch", "-q", "--depth=1", "origin", `refs/pull/${PR_NUMBER}/merge`], checkout);
  git(["checkout", "-q", "FETCH_HEAD"], checkout);

  // A checkout that PREDATES the PR entirely (false-green shape): shallow,
  // detached at the base commit.
  const checkoutBase = path.join(root, "checkout-base");
  git(["clone", "-q", "--no-checkout", "--depth=1", origin, checkoutBase]);
  git(["fetch", "-q", "--depth=1", "origin", `${base}:refs/ci/base`], checkoutBase);
  git(["checkout", "-q", "refs/ci/base"], checkoutBase);

  const result = { root, origin, seed, checkout, checkoutBase, base, h1, m1, h2: null, m2: null };

  if (stale) {
    // Reopen with a NEW head: topic advances (adds tests/d.test.mjs) and the
    // merge ref is re-created at m2 while the main checkout still sits on m1.
    git(["checkout", "-q", "topic"], seed);
    write(seed, "tests/d.test.mjs", "import { test } from 'node:test';\n");
    git(["add", "-A"], seed);
    git(["commit", "-q", "-m", "second feature"], seed);
    result.h2 = git(["rev-parse", "HEAD"], seed);
    git(["checkout", "-q", "main"], seed);
    git(["merge", "-q", "--no-ff", "topic", "-m", "Merge pull request #7 again"], seed);
    result.m2 = git(["rev-parse", "HEAD"], seed);
    git(["push", "-q", "origin", "main"], seed);
    git(["update-ref", `refs/pull/${PR_NUMBER}/head`, result.h2], origin);
    git(["update-ref", `refs/pull/${PR_NUMBER}/merge`, result.m2], origin);
  }

  return result;
}

function runGuard(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function withFixture(options, fn) {
  const fx = makeFixture(options);
  try {
    return fn(fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
}

test("a fresh checkout matching the current merge ref passes", () => {
  withFixture({}, ({ checkout, h1 }) => {
    const res = runGuard(["--pr", PR_NUMBER, "--head", h1, "--repo", checkout]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /OK: the checked-out tree matches the current refs\/pull\/7\/merge content/);
    assert.match(res.stdout, /refs\/pull\/7\/head is the event head/);
    // The corroborating file counts agree on the fresh tree (the bead's
    // cheaper detector): m1's tree is base.txt + feature.txt + three tests.
    assert.match(res.stdout, /Files: checked-out 5 \(3 test\), current merge tree 5 \(3 test\)/);
  });
});

test("a checkout that predates the current merge ref fails (false-RED class)", () => {
  withFixture({ stale: true }, ({ checkout, m1, h2 }) => {
    // The checkout still sits on m1 while refs/pull/7/merge is now m2.
    assert.equal(git(["rev-parse", "HEAD"], checkout), m1);
    const res = runGuard(["--pr", PR_NUMBER, "--head", h2, "--repo", checkout]);
    assert.equal(res.status, 1, "the guard must fail the stale run");
    assert.match(res.stderr, /STALE MERGE-TREE CHECKOUT \(cave-d9xfq\)/);
    assert.match(res.stderr, /does not match the current refs\/pull\/7\/merge tree/);
    assert.match(res.stderr, /missing 1 file\(s\)/);
    assert.match(res.stderr, /tests\/d\.test\.mjs/);
    assert.match(res.stderr, /1 of them test files/);
  });
});

test("a stale event head is reported as a mid-run head move, not silently trusted", () => {
  withFixture({ stale: true }, ({ checkout, h1 }) => {
    const res = runGuard(["--pr", PR_NUMBER, "--head", h1, "--repo", checkout]);
    assert.equal(res.status, 1);
    assert.match(res.stdout, /refs\/pull\/7\/head moved during the run: event head/);
  });
});

test("a tree predating the code under test fails the content probe (false-GREEN class)", () => {
  withFixture({ stale: true }, ({ checkoutBase, h2 }) => {
    // checkoutBase is the base commit: it has files but lacks the PR's entirely.
    const res = runGuard(["--pr", PR_NUMBER, "--head", h2, "--repo", checkoutBase]);
    assert.equal(res.status, 1, "a tree missing the code under test must fail");
    assert.match(res.stderr, /STALE MERGE-TREE CHECKOUT \(cave-d9xfq\)/);
    assert.match(res.stderr, /missing 3 file\(s\) present in the current refs\/pull\/7\/merge tree \(2 of them test files\)/);
    assert.match(res.stderr, /tests\/c\.test\.mjs/);
  });
});

test("a PR whose merge ref does not exist fails closed", () => {
  withFixture({}, ({ checkout, h1 }) => {
    const res = runGuard(["--pr", "999", "--head", h1, "--repo", checkout]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /cannot fetch the CURRENT refs\/pull\/999\/merge/);
  });
});

test("a non-git directory fails closed", () => {
  withFixture({}, ({ root, h1 }) => {
    const res = runGuard(["--pr", PR_NUMBER, "--head", h1, "--repo", path.join(root, "does-not-exist")]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /not a git work tree/);
  });
});

test("usage errors exit 2 with the usage text", () => {
  const noPr = runGuard(["--head", "a".repeat(40)]);
  assert.equal(noPr.status, 2);
  assert.match(noPr.stderr, /missing or invalid --pr/);

  const badHead = runGuard(["--pr", PR_NUMBER, "--head", "not-a-sha"]);
  assert.equal(badHead.status, 2);
  assert.match(badHead.stderr, /missing or invalid --head/);
});

test("--help exits 0 with usage", () => {
  const res = runGuard(["--help"]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /--pr <pull-request-number>/);
});


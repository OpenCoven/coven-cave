import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  acquireMaintenanceGate,
  releaseMaintenanceGate,
} from "./maintenance-gate.mjs";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const moduleUrl = pathToFileURL(
  path.join(scriptDir, "worktree-lifecycle-retirement.ts"),
).href;
const sourceRoot = path.resolve(scriptDir, "..");
const realGit = process.env.PATH.split(path.delimiter)
  .map((entry) => path.join(entry, "git"))
  .find((candidate) => existsSync(candidate));

assert.ok(realGit, "the test requires git on PATH");

const {
  createGitRetirementOperations,
  parseMaxRetire,
  retireLifecycleUnits,
} = await import(moduleUrl);

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function hex(char) {
  return char.repeat(40);
}

function makeItem(overrides = {}) {
  const branch = overrides.branch ?? "fix/example";
  const ref = overrides.ref ?? `refs/heads/${branch.replace(/^refs\/heads\//, "")}`;
  return {
    kind: overrides.kind ?? "worktree",
    path: overrides.path === undefined ? "/owned/worktree" : overrides.path,
    ref,
    branch: overrides.branch ?? branch,
    head: overrides.head ?? hex("1"),
    isPrimary: false,
    protectedBranch: false,
    changes: [],
    ignoredPaths: [],
    nonDisposableIgnoredPaths: [],
    indexFlags: [],
    processOwners: [],
    claimOwners: [],
    taskIds: [],
    openPrs: [],
    mergedPr: null,
    activeWorkflowUrls: [],
    headOnDefaultBranch: true,
    remoteRefsContainingHead: [],
    updatedAtMs: overrides.updatedAtMs ?? 1_000,
    probeErrors: [],
    metadata: null,
    metadataErrors: [],
    remoteRef: null,
    sessionIds: [],
    lane: overrides.lane ?? "retire-after-gate",
    reasons: overrides.reasons ?? [],
    ...overrides,
  };
}

function makeOperations(overrides = {}) {
  const calls = [];
  return {
    calls,
    operations: {
      verifyGate(handle) {
        calls.push(["verifyGate", handle.generation, handle.token]);
        return overrides.verifyGate?.(handle) ?? { ok: true };
      },
      heartbeatGate(handle) {
        calls.push(["heartbeatGate", handle.generation, handle.token]);
        return overrides.heartbeatGate?.(handle) ?? { ok: true };
      },
      reprobe(item) {
        calls.push(["reprobe", item.ref]);
        return overrides.reprobe?.(item) ?? { ok: true, item };
      },
      removeDisposableIgnored(item) {
        calls.push(["removeDisposableIgnored", item.ref]);
        return overrides.removeDisposableIgnored?.(item) ?? { ok: true };
      },
      removeWorktree(item) {
        calls.push(["removeWorktree", item.ref]);
        return overrides.removeWorktree?.(item) ?? { ok: true };
      },
      deleteLocalRef(item) {
        calls.push(["deleteLocalRef", item.ref]);
        return overrides.deleteLocalRef?.(item) ?? { ok: true };
      },
      restoreLocalRef(item) {
        calls.push(["restoreLocalRef", item.ref]);
        return overrides.restoreLocalRef?.(item) ?? { ok: true };
      },
      verifyAbsent(item) {
        calls.push(["verifyAbsent", item.ref]);
        return overrides.verifyAbsent?.(item) ?? { ok: true };
      },
      readRemoteRef(ref) {
        calls.push(["readRemoteRef", ref]);
        return overrides.readRemoteRef?.(ref) ?? { ok: true, remoteRef: null };
      },
      // Defaults to RETAINED so the many cases that leave readRemoteRef at its
      // null default keep exercising what they were written to exercise. The
      // unretained and unreadable paths are covered explicitly below.
      readRemoteTagRetention(head) {
        calls.push(["readRemoteTagRetention", head]);
        return (
          overrides.readRemoteTagRetention?.(head) ?? {
            ok: true,
            retainedBy: "refs/tags/archive/fixture",
          }
        );
      },
    },
  };
}

function cleanupFixture(fixtureRoot) {
  assert.ok(
    path.basename(fixtureRoot).startsWith("cave-worktree-retirement-"),
    "cleanup is restricted to the exact retirement fixture root",
  );
  rmSync(fixtureRoot, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function git(args, cwd, options = {}) {
  const result = run(realGit, args, cwd, options);
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr || result.error?.message}`,
    );
  }
  return result.stdout;
}

function executable(file, contents) {
  writeFileSync(file, contents);
  chmodSync(file, 0o755);
}

function withPathPrefix(bin, fn) {
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${originalPath}`;
  try {
    return fn();
  } finally {
    process.env.PATH = originalPath;
  }
}

function createGitFixture() {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "cave-worktree-retirement-"));
  const repoEntry = path.join(fixtureRoot, "repo");
  const origin = path.join(fixtureRoot, "origin.git");
  const bin = path.join(fixtureRoot, "bin");
  mkdirSync(repoEntry, { recursive: true });
  mkdirSync(origin, { recursive: true });
  mkdirSync(bin, { recursive: true });
  const repo = realpathSync(repoEntry);

  git(["init", "-q", "-b", "main"], repo);
  // `-b main` on the bare origin too, not just the work repo above. Without it
  // the origin's HEAD follows whatever init.defaultBranch the host has, and this
  // fixture only ever pushes `main`. On a runner that still defaults to `master`,
  // origin/HEAD names a branch that does not exist, so
  // `git ls-remote --symref origin HEAD` does not return the symref+oid pair the
  // default-branch probe requires — it reports "malformed origin HEAD symref
  // data" and every candidate falls into the `uncertain` lane. That is precisely
  // how this file passed on macOS and failed on Linux CI. A fixture has to pin
  // its own default branch rather than inherit the host's.
  git(["init", "-q", "-b", "main", "--bare"], origin);
  git(["config", "user.name", "Cave Test"], repo);
  git(["config", "user.email", "cave@example.invalid"], repo);
  git(["config", "commit.gpgsign", "false"], repo);
  writeFileSync(path.join(repo, ".gitignore"), ".next/\ntarget/\n");
  writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(["add", ".gitignore", "README.md"], repo);
  git(["commit", "-q", "-m", "initial"], repo, {
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
    },
  });
  git(["remote", "add", "origin", origin], repo);
  git(["push", "-q", "-u", "origin", "main"], repo);

  executable(
    path.join(bin, "gh"),
    `#!/bin/sh
case "$*" in
  *"associatedPullRequests"*)
    printf '%s\\n' '[{"data":{"repository":{"nameWithOwner":"OpenCoven/coven-cave","object":{"associatedPullRequests":{"totalCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}]'
    ;;
  *"search(query:"*|*"searchQuery="*)
    printf '%s\\n' '[{"data":{"search":{"issueCount":0,"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}]'
    ;;
  *"repos/OpenCoven/coven-cave/actions/runs"*)
    printf '%s\\n' '[{"total_count":0,"workflow_runs":[]}]'
    ;;
  *)
    printf '%s\\n' '[]'
    ;;
esac
`,
  );

  executable(
    path.join(bin, "coven"),
    `#!/bin/sh
case "$1" in
  sessions) printf '%s\\n' '{"sessions":[]}' ;;
  claim) printf '%s\\n' '{"claims":[]}' ;;
  *)
    printf 'unexpected coven command: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`,
  );

  executable(
    path.join(bin, "bd"),
    `#!/bin/sh
printf '%s\\n' '[]'
`,
  );

  executable(
    path.join(bin, "lsof"),
    `#!/bin/sh
printf 'p1\\ncinit\\nfcwd\\nn/\\n'
`,
  );

  executable(
    path.join(bin, "git"),
    `#!/bin/sh
REAL_GIT=${JSON.stringify(realGit)}

case " $* " in
  *" remote get-url --all origin "*|*" remote get-url --push --all origin "*)
    printf '%s\\n' 'https://github.com/OpenCoven/coven-cave.git'
    exit 0
    ;;
esac

exec "$REAL_GIT" "$@"
`,
  );

  return { fixtureRoot, repo, origin, bin };
}

function findItem(items, ref) {
  const item = items.find((candidate) => candidate.ref === ref);
  assert.ok(item, `expected lifecycle item for ${ref}`);
  return item;
}

test("parseMaxRetire defaults and enforces exact bounds", () => {
  assert.equal(parseMaxRetire(undefined), 3);
  assert.equal(parseMaxRetire("1"), 1);
  assert.equal(parseMaxRetire("9"), 9);
  assert.equal(parseMaxRetire("10"), 10);

  for (const candidate of [
    0,
    1,
    10,
    11,
    -1,
    1.5,
    "",
    "0",
    "01",
    "03",
    "11",
    " 3",
    "3 ",
    "3.0",
    null,
  ]) {
    assert.throws(
      () => parseMaxRetire(candidate),
      /--max-retire must be an integer from 1 through 10/,
    );
  }
});

test("retireLifecycleUnits uses default batch size of three and leaves cleanupReady remainder", () => {
  const items = [
    makeItem({ branch: "fix/d", ref: "refs/heads/fix/d", updatedAtMs: 40 }),
    makeItem({ branch: "fix/a", ref: "refs/heads/fix/a", updatedAtMs: 10 }),
    makeItem({ branch: "fix/c", ref: "refs/heads/fix/c", updatedAtMs: 30 }),
    makeItem({ branch: "fix/e", ref: "refs/heads/fix/e", updatedAtMs: 50 }),
    makeItem({ branch: "fix/b", ref: "refs/heads/fix/b", updatedAtMs: 20 }),
  ];
  const { calls, operations } = makeOperations();

  const report = retireLifecycleUnits({
    items,
    gateHandle: { generation: 7, token: "gate" },
    operations,
  });

  assert.deepEqual(
    report.attempts.map((attempt) => attempt.ref),
    ["refs/heads/fix/a", "refs/heads/fix/b", "refs/heads/fix/c"],
  );
  assert.deepEqual(
    report.cleanupReady.map((item) => item.ref),
    ["refs/heads/fix/d", "refs/heads/fix/e"],
  );
  assert.equal(
    calls.filter(([name]) => name === "heartbeatGate").length,
    12,
    "three worktree candidates should heartbeat before every destructive phase and after retirement",
  );
});

test("retireLifecycleUnits sorts deterministically by updatedAtMs then full ref", () => {
  const items = [
    makeItem({ branch: "fix/z", ref: "refs/heads/fix/z", updatedAtMs: 5, path: null, kind: "branch-only" }),
    makeItem({ branch: "fix/a", ref: "refs/heads/fix/a", updatedAtMs: 5, path: null, kind: "branch-only" }),
    makeItem({ branch: "fix/m", ref: "refs/heads/fix/m", updatedAtMs: 3, path: null, kind: "branch-only" }),
  ];
  const { operations } = makeOperations();

  const report = retireLifecycleUnits({
    items,
    gateHandle: { generation: 1, token: "gate" },
    operations,
    maxRetire: "10",
  });

  assert.deepEqual(
    report.attempts.map((attempt) => attempt.ref),
    ["refs/heads/fix/m", "refs/heads/fix/a", "refs/heads/fix/z"],
  );
});

test("success path follows the required call order and emits a remote deletion proposal", () => {
  const item = makeItem({
    ignoredPaths: [".next/cache"],
    remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
    mergedPr: { number: 42, url: "https://example.invalid/pr/42", headOid: hex("1") },
  });
  const { calls, operations } = makeOperations({
    readRemoteRef(ref) {
      return { ok: true, remoteRef: { ref, oid: hex("1") } };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 3, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "heartbeatGate",
      "verifyGate",
      "reprobe",
      "readRemoteRef",
      "heartbeatGate",
      "verifyGate",
      "removeDisposableIgnored",
      "reprobe",
      "heartbeatGate",
      "verifyGate",
      "removeWorktree",
      "heartbeatGate",
      "verifyGate",
      "deleteLocalRef",
      "verifyAbsent",
      "readRemoteRef",
      "heartbeatGate",
      "verifyGate",
    ],
  );
  assert.equal(report.retired.length, 1);
  assert.deepEqual(report.remoteDeletionProposals, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      localRetirementOid: hex("1"),
      mergedPr: 42,
      reason: "remote-deletion-requires-separate-authorization",
    },
  ]);
  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "verified",
      localRefPostcondition: "verified",
      outcome: "retired",
      reason: null,
    },
  ]);
});

test("branch-only retirement skips worktree removal", () => {
  const item = makeItem({
    kind: "branch-only",
    path: null,
    branch: "fix/branch-only",
    ref: "refs/heads/fix/branch-only",
  });
  const { calls, operations } = makeOperations();

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 9, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(calls.some(([name]) => name === "removeWorktree"), false);
  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/branch-only",
      oid: hex("1"),
      action: "remove-local-ref",
      worktreePostcondition: "not-applicable",
      localRefPostcondition: "verified",
      outcome: "retired",
      reason: null,
    },
  ]);
});

test("initial gate heartbeat failure blocks the current and remaining selected candidates", () => {
  const items = [
    makeItem({ branch: "fix/a", ref: "refs/heads/fix/a", path: null, kind: "branch-only" }),
    makeItem({ branch: "fix/b", ref: "refs/heads/fix/b", path: null, kind: "branch-only" }),
  ];
  const { operations } = makeOperations({
    heartbeatGate() {
      return { ok: false, reason: "expired" };
    },
  });

  const report = retireLifecycleUnits({
    items,
    gateHandle: { generation: 2, token: "gate" },
    operations,
    maxRetire: "10",
  });

  assert.equal(report.retired.length, 0);
  assert.equal(report.attempts.length, 1);
  assert.deepEqual(
    report.blocked.map((block) => ({
      ref: block.ref,
      partial: block.partial,
      reason: block.reason,
    })),
    [
      {
        ref: "refs/heads/fix/a",
        partial: false,
        reason: "maintenance gate heartbeat failed before retirement: expired",
      },
      {
        ref: "refs/heads/fix/b",
        partial: false,
        reason: "maintenance gate unavailable after earlier retirement failure: maintenance gate heartbeat failed before retirement: expired",
      },
    ],
  );
});

test("initial gate ownership drift blocks without mutating", () => {
  const item = makeItem({ path: null, kind: "branch-only" });
  const { calls, operations } = makeOperations({
    verifyGate() {
      return { ok: false, reason: "not-owner" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 4, token: "gate" },
    operations,
  });

  assert.deepEqual(calls.map(([name]) => name), ["heartbeatGate", "verifyGate"]);
  assert.equal(report.blocked[0]?.partial, false);
  assert.match(report.blocked[0]?.reason ?? "", /maintenance gate ownership check failed/);
});

test("generation drift after heartbeat blocks before reprobe and later mutation", () => {
  const item = makeItem({ path: null, kind: "branch-only" });
  const gateHandle = { generation: 21, token: "gate" };
  let liveGeneration = gateHandle.generation;
  const { calls, operations } = makeOperations({
    heartbeatGate(handle) {
      assert.strictEqual(handle, gateHandle);
      liveGeneration += 1;
      return { ok: true };
    },
    verifyGate(handle) {
      assert.strictEqual(handle, gateHandle);
      if (handle.generation !== liveGeneration) {
        return {
          ok: false,
          reason: `generation drift detected: expected ${liveGeneration}, got ${handle.generation}`,
        };
      }
      return { ok: true };
    },
    reprobe() {
      assert.fail("generation drift must block before reprobe");
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle,
    operations,
  });

  assert.deepEqual(calls.map(([name]) => name), ["heartbeatGate", "verifyGate"]);
  assert.deepEqual(report.blocked, [
    {
      branch: "fix/example",
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      reason:
        "maintenance gate ownership check failed before retirement: generation drift detected: expected 22, got 21",
      partial: false,
    },
  ]);
});

test("reprobe failures block the candidate before mutation", () => {
  const scenarios = [
    "candidate disappeared during final retirement probe",
    "retirement candidate ref became ambiguous during final retirement probe",
    "retirement candidate path changed during final retirement probe",
    "retirement candidate ref changed during final retirement probe",
    "retirement candidate OID changed during final retirement probe",
    "retirement candidate lane changed during final retirement probe",
  ];

  for (const reason of scenarios) {
    const item = makeItem();
    const { calls, operations } = makeOperations({
      reprobe() {
        return { ok: false, reason };
      },
    });

    const report = retireLifecycleUnits({
      items: [item],
      gateHandle: { generation: 5, token: "gate" },
      operations,
      maxRetire: "1",
    });

    assert.deepEqual(calls.map(([name]) => name), [
      "heartbeatGate",
      "verifyGate",
      "reprobe",
    ]);
    assert.equal(report.blocked[0]?.partial, false);
    assert.equal(report.attempts[0]?.outcome, "blocked");
    assert.equal(report.blocked[0]?.reason, reason);
  }
});

test("dirty tracked changes and non-disposable ignored paths are refused", () => {
  for (const item of [
    makeItem({ changes: [" M README.md"] }),
    makeItem({ nonDisposableIgnoredPaths: ["logs/runtime.log"] }),
  ]) {
    const { calls, operations } = makeOperations();
    const report = retireLifecycleUnits({
      items: [item],
      gateHandle: { generation: 6, token: "gate" },
      operations,
      maxRetire: "1",
    });

    assert.equal(report.blocked[0]?.partial, false);
    assert.match(
      report.blocked[0]?.reason ?? "",
      /retirement candidate is no longer clean enough to retire/,
    );
    assert.deepEqual(calls.map(([name]) => name), ["heartbeatGate", "verifyGate", "reprobe"]);
  }
});

test("an OID mismatch before worktree removal is blocked without mutating", () => {
  const item = makeItem();
  const { calls, operations } = makeOperations({
    reprobe() {
      return { ok: true, item: { ...item, head: hex("2") } };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 10, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(calls.map(([name]) => name), ["heartbeatGate", "verifyGate", "reprobe"]);
  assert.equal(report.blocked[0]?.reason, "retirement candidate OID changed during final retirement probe");
});

test("removeWorktree failure blocks before local-ref deletion", () => {
  const item = makeItem();
  const { calls, operations } = makeOperations({
    removeWorktree() {
      return { ok: false, reason: "worktree remove rejected dirty path" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 11, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "heartbeatGate",
    "verifyGate",
    "reprobe",
    // No remote branch on this fixture, so retention is proven before any
    // destructive step (cave-s03wp.1).
    "readRemoteTagRetention",
    "heartbeatGate",
    "verifyGate",
    "removeWorktree",
  ]);
  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "failed",
      localRefPostcondition: "not-attempted",
      outcome: "blocked",
      reason: "worktree remove rejected dirty path",
    },
  ]);
});

test("mid-transaction gate loss after worktree removal reports a partial truthfully", () => {
  const item = makeItem();
  let heartbeatCount = 0;
  const { operations } = makeOperations({
    heartbeatGate() {
      heartbeatCount += 1;
      return heartbeatCount === 3 ? { ok: false, reason: "expired" } : { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 12, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "failed",
      localRefPostcondition: "not-attempted",
      outcome: "partial",
      reason: "maintenance gate heartbeat failed before local ref retirement: expired",
    },
  ]);
  assert.deepEqual(report.blocked, [
    {
      branch: "fix/example",
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      reason: "maintenance gate heartbeat failed before local ref retirement: expired",
      partial: true,
    },
  ]);
});

test("expected OID mismatch before ref deletion becomes a partial after worktree removal", () => {
  const item = makeItem();
  const { operations } = makeOperations({
    deleteLocalRef() {
      return { ok: false, reason: "local ref moved before compare-delete" };
    },
    verifyAbsent() {
      return { ok: false, reason: "local ref still exists after failed delete" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 13, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "failed",
      localRefPostcondition: "failed",
      outcome: "partial",
      reason: "local ref moved before compare-delete",
    },
  ]);
});

// --- retention proof when the remote branch is gone (cave-s03wp.1) ----------
// Merging deletes the remote branch, so remoteRef === null is the COMMON case,
// not an edge one. Landing proof covers the squashed content on the default
// branch, never the branch's own pre-squash commits.

test("blocks retirement when the remote branch is gone and no remote tag retains the head", () => {
  const item = makeItem();
  const { operations, calls } = makeOperations({
    readRemoteTagRetention() {
      return { ok: true, retainedBy: null };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 0);
  assert.equal(report.attempts[0].outcome, "blocked");
  assert.match(report.attempts[0].reason, /no remote tag resolves to/);
  assert.match(report.attempts[0].reason, /archive the head to a pushed tag/);
  // Nothing destructive may run before the proof.
  assert.ok(
    !calls.some(([name]) => name === "removeWorktree" || name === "deleteLocalRef"),
    "a unit with no retention must not reach any destructive operation",
  );
});

test("retires when a remote tag resolves to the exact head", () => {
  const item = makeItem();
  const { operations, calls } = makeOperations({
    readRemoteTagRetention() {
      return { ok: true, retainedBy: "refs/tags/archive/fix-example-2026-08-08" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 1);
  assert.equal(report.attempts[0].outcome, "retired");
  assert.deepEqual(
    calls.filter(([name]) => name === "readRemoteTagRetention"),
    [["readRemoteTagRetention", hex("1")]],
    "retention is proven against the unit's exact head",
  );
});

test("fails closed when the retention probe cannot read the remote", () => {
  const item = makeItem();
  const { operations, calls } = makeOperations({
    readRemoteTagRetention() {
      return { ok: false, reason: "ls-remote --tags failed while proving retention" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 0);
  assert.equal(report.attempts[0].outcome, "blocked");
  assert.match(report.attempts[0].reason, /ls-remote --tags failed/);
  assert.ok(
    !calls.some(([name]) => name === "removeWorktree"),
    "an unreadable remote is not evidence of retention",
  );
});

test("a reprobe that resolves the remote branch is preferred over a stale inventory null", () => {
  // remoteRef is not part of retirementIdentityError, so a transient
  // remote-read failure at inventory time reports null for a branch that
  // still exists. Requiring a tag in that case refuses a plainly retained
  // unit. Reported on PR #4438.
  const item = makeItem({ remoteRef: null });
  const { operations, calls } = makeOperations({
    reprobe(candidate) {
      return {
        ok: true,
        item: {
          ...candidate,
          remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
        },
      };
    },
    readRemoteRef() {
      return { ok: true, remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") } };
    },
    readRemoteTagRetention() {
      throw new Error("tag retention must not be consulted when the reprobe found the branch");
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 1);
  assert.ok(!calls.some(([name]) => name === "readRemoteTagRetention"));
  // The resolved ref is what gets proposed for remote deletion.
  assert.deepEqual(report.remoteDeletionProposals[0]?.ref, "refs/heads/fix/example");
});

test("a branch that disappeared between inventory and reprobe fails live revalidation", () => {
  // The inverse of the case above: falling back to the inventory value keeps
  // this a live-revalidation failure rather than silently taking the tag path.
  const item = makeItem({
    remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
  });
  const { operations, calls } = makeOperations({
    reprobe(candidate) {
      return { ok: true, item: { ...candidate, remoteRef: null } };
    },
    readRemoteRef() {
      return { ok: true, remoteRef: null };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 0);
  assert.match(report.attempts[0].reason, /remote ref disappeared/);
  assert.ok(
    !calls.some(([name]) => name === "readRemoteTagRetention"),
    "a vanished branch is drift to report, not a unit to re-qualify via tags",
  );
});

test("a live remote branch retires without consulting tag retention", () => {
  const item = makeItem({
    remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
  });
  const { operations, calls } = makeOperations({
    readRemoteRef() {
      return { ok: true, remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") } };
    },
    readRemoteTagRetention() {
      throw new Error("tag retention must not be consulted when the branch is retained");
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(report.retired.length, 1);
  assert.ok(!calls.some(([name]) => name === "readRemoteTagRetention"));
});

test("deleteLocalRef failure after worktree removal stays partial and does not pretend the ref remained", () => {
  const item = makeItem();
  const { operations } = makeOperations({
    deleteLocalRef() {
      return { ok: false, reason: "git update-ref reported an error after deleting the ref" };
    },
    verifyAbsent() {
      return { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 14, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "verified",
      localRefPostcondition: "verified",
      outcome: "partial",
      reason: "git update-ref reported an error after deleting the ref",
    },
  ]);
});

test("postcondition failure restores the local ref when the gate is still owned", () => {
  const item = makeItem({
    remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
  });
  let remoteReadCount = 0;
  const { calls, operations } = makeOperations({
    readRemoteRef() {
      remoteReadCount += 1;
      return remoteReadCount === 1
        ? { ok: true, remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") } }
        : { ok: true, remoteRef: null };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 15, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(calls.some(([name]) => name === "restoreLocalRef"), true);
  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "verified",
      localRefPostcondition: "failed",
      outcome: "partial",
      reason: "remote ref disappeared before local retirement completed",
    },
  ]);
});

test("restoration failure remains partial", () => {
  const item = makeItem({
    remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
  });
  let remoteReadCount = 0;
  const { operations } = makeOperations({
    readRemoteRef() {
      remoteReadCount += 1;
      return remoteReadCount === 1
        ? { ok: true, remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") } }
        : { ok: true, remoteRef: null };
    },
    restoreLocalRef() {
      return { ok: false, reason: "restore compare-create failed" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 16, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "verified",
      localRefPostcondition: "failed",
      outcome: "partial",
      reason: "remote ref disappeared before local retirement completed; local ref restoration failed: restore compare-create failed",
    },
  ]);
});

test("lost gate after local ref deletion refuses restoration", () => {
  const item = makeItem();
  let verifyCount = 0;
  const { calls, operations } = makeOperations({
    verifyGate() {
      verifyCount += 1;
      if (verifyCount <= 3) return { ok: true };
      return { ok: false, reason: "not-owner" };
    },
    verifyAbsent() {
      return { ok: false, reason: "worktree or local ref still present after retirement" };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 17, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(calls.some(([name]) => name === "restoreLocalRef"), false);
  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "failed",
      localRefPostcondition: "failed",
      outcome: "partial",
      reason:
        "worktree or local ref still present after retirement; maintenance gate lost before restoration: not-owner",
    },
  ]);
});

test("remote ref missing, moved, or unreadable precheck blocks before local mutation", () => {
  for (const remoteResult of [
    { ok: true, remoteRef: null, reason: "remote ref disappeared before local retirement started" },
    {
      ok: true,
      remoteRef: { ref: "refs/heads/fix/example", oid: hex("2") },
      reason: "remote ref moved before local retirement started",
    },
    { ok: false, reason: "remote ref probe failed before local retirement started: ls-remote failed" },
  ]) {
    const item = makeItem({
      remoteRef: { ref: "refs/heads/fix/example", oid: hex("1") },
    });
    const { calls, operations } = makeOperations({
      readRemoteRef() {
        return remoteResult.ok === false
          ? { ok: false, reason: "ls-remote failed" }
          : { ok: true, remoteRef: remoteResult.remoteRef };
      },
    });

    const report = retireLifecycleUnits({
      items: [item],
      gateHandle: { generation: 18, token: "gate" },
      operations,
      maxRetire: "1",
    });

    assert.deepEqual(calls.map(([name]) => name), [
      "heartbeatGate",
      "verifyGate",
      "reprobe",
      "readRemoteRef",
    ]);
    assert.equal(calls.some(([name]) => name === "restoreLocalRef"), false);
    assert.equal(calls.some(([name]) => name === "removeDisposableIgnored"), false);
    assert.equal(calls.some(([name]) => name === "removeWorktree"), false);
    assert.equal(calls.some(([name]) => name === "deleteLocalRef"), false);
    assert.equal(report.retired.length, 0);
    assert.equal(report.remoteDeletionProposals.length, 0);
    assert.equal(report.blocked[0]?.partial, false);
    assert.equal(report.blocked[0]?.reason, remoteResult.reason);
  }
});

test("gate loss before cleanup blocks without mutating", () => {
  const item = makeItem({ ignoredPaths: [".next/cache"] });
  let verifyCount = 0;
  const { calls, operations } = makeOperations({
    verifyGate() {
      verifyCount += 1;
      return verifyCount === 2 ? { ok: false, reason: "not-owner" } : { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 22, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "heartbeatGate",
    "verifyGate",
    "reprobe",
    "readRemoteTagRetention",
    "heartbeatGate",
    "verifyGate",
  ]);
  assert.equal(report.blocked[0]?.partial, false);
  assert.equal(
    report.blocked[0]?.reason,
    "maintenance gate ownership check failed before ignored cleanup: not-owner",
  );
});

test("gate loss after cleanup but before worktree removal is reported as partial", () => {
  const item = makeItem({ ignoredPaths: [".next/cache"] });
  let verifyCount = 0;
  const { calls, operations } = makeOperations({
    verifyGate() {
      verifyCount += 1;
      return verifyCount === 3 ? { ok: false, reason: "expired" } : { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 23, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(calls.map(([name]) => name), [
    "heartbeatGate",
    "verifyGate",
    "reprobe",
    "readRemoteTagRetention",
    "heartbeatGate",
    "verifyGate",
    "removeDisposableIgnored",
    "reprobe",
    "heartbeatGate",
    "verifyGate",
  ]);
  assert.equal(calls.some(([name]) => name === "removeWorktree"), false);
  assert.equal(report.blocked[0]?.partial, true);
  assert.equal(
    report.blocked[0]?.reason,
    "maintenance gate ownership check failed before worktree removal: expired",
  );
});

test("injected reprobe exceptions are blocked instead of escaping", () => {
  const item = makeItem();
  const { calls, operations } = makeOperations({
    reprobe() {
      throw new Error("inventory exploded");
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 24, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(calls.map(([name]) => name), ["heartbeatGate", "verifyGate", "reprobe"]);
  assert.equal(report.blocked[0]?.partial, false);
  assert.equal(report.blocked[0]?.reason, "reprobe threw: inventory exploded");
});

test("injected post-removal exceptions become partial results instead of crashing", () => {
  const item = makeItem();
  const { operations } = makeOperations({
    verifyAbsent() {
      throw new Error("absence probe exploded");
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 25, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-worktree-and-local-ref",
      worktreePostcondition: "failed",
      localRefPostcondition: "failed",
      outcome: "partial",
      reason: "verifyAbsent threw: absence probe exploded",
    },
  ]);
});

test("final heartbeat failure downgrades an otherwise retired unit to partial", () => {
  const item = makeItem({ path: null, kind: "branch-only" });
  let heartbeatCount = 0;
  const { operations } = makeOperations({
    heartbeatGate() {
      heartbeatCount += 1;
      return heartbeatCount === 3 ? { ok: false, reason: "expired" } : { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [item],
    gateHandle: { generation: 19, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.deepEqual(report.attempts, [
    {
      ref: "refs/heads/fix/example",
      oid: hex("1"),
      action: "remove-local-ref",
      worktreePostcondition: "not-applicable",
      localRefPostcondition: "verified",
      outcome: "partial",
      reason: "maintenance gate heartbeat failed after local retirement: expired",
    },
  ]);
  assert.equal(report.blocked[0]?.partial, true);
});

test("createGitRetirementOperations never exposes a remote deletion mutator", () => {
  const operations = createGitRetirementOperations({
    root: sourceRoot,
    repo: "OpenCoven/coven-cave",
    gateHandle: { generation: 1, token: "tok", ownerId: "owner", root: "/gate" },
  });
  assert.equal("deleteRemoteRef" in operations, false);
});

test("cleanup uses fresh reprobe ignored paths and reports the post-cleanup candidate", () => {
  const selectedItem = makeItem({
    branch: "fix/fresh-ignored",
    ref: "refs/heads/fix/fresh-ignored",
    ignoredPaths: [],
  });
  const firstReprobe = {
    ...selectedItem,
    ignoredPaths: [".next/cache"],
  };
  const postCleanupCandidate = {
    ...firstReprobe,
    ignoredPaths: [],
    updatedAtMs: 2_000,
  };
  let reprobeCount = 0;
  let cleaned = false;
  const { operations } = makeOperations({
    reprobe() {
      reprobeCount += 1;
      return { ok: true, item: reprobeCount === 1 ? firstReprobe : postCleanupCandidate };
    },
    removeDisposableIgnored(item) {
      cleaned = true;
      assert.deepEqual(item.ignoredPaths, [".next/cache"]);
      return { ok: true };
    },
  });

  const report = retireLifecycleUnits({
    items: [selectedItem],
    gateHandle: { generation: 20, token: "gate" },
    operations,
    maxRetire: "1",
  });

  assert.equal(cleaned, true);
  assert.deepEqual(report.retired, [postCleanupCandidate]);
});

test("adapter reprobe rejects a candidate that is no longer cleanup-ready", () => {
  const fixture = createGitFixture();
  try {
    const branch = "fix/reprobe-dirty";
    const worktreePath = path.join(fixture.repo, ".worktrees", "reprobe-dirty");
    const agedEnv = {
      ...process.env,
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
    };
    git(["branch", branch, "HEAD"], fixture.repo, { env: agedEnv });
    git(["push", "-q", "-u", "origin", branch], fixture.repo);
    // Land the branch for real: advance main past it and push, so the branch
    // is strictly behind the default tip. cave-ox3ky's ae16550d6 fails closed
    // when the candidate oid EQUALS the captured default — with no ref move
    // there is no evidence of WHEN it landed, so the age window is unprovable.
    // A fixture that leaves the branch at the default tip is asserting on a
    // case the engine now (correctly) refuses to judge.
    git(["commit", "-q", "--allow-empty", "-m", "land fix/reprobe-dirty"], fixture.repo, { env: agedEnv });
    git(["push", "-q", "origin", "main"], fixture.repo);
    git(["worktree", "add", worktreePath, branch], fixture.repo, { env: agedEnv });
    executable(
      path.join(fixture.bin, "bd"),
      `#!/usr/bin/env node
const output = [{
  id: "cave-reprobe-dirty-1",
  status: "closed",
  title: "Managed reprobe dirty fixture",
  description: "",
  notes: "",
  external_ref: null,
  metadata: {
    coven: {
      worktree: {
        branch: ${JSON.stringify(branch)},
        path: ${JSON.stringify(worktreePath)},
        owner: "retirement-test",
        purpose: "managed fixture",
        disposition: "pr",
        createdAt: "2026-07-20T12:00:00Z"
      }
    }
  }
}];
process.stdout.write(JSON.stringify(output) + "\\n");
`,
    );

    const nowMs = Date.parse("2026-08-01T12:00:00Z");
    const inventory = withPathPrefix(fixture.bin, () =>
      collectWorktreeLifecycleInventory({
        repo: "OpenCoven/coven-cave",
        root: fixture.repo,
        nowMs,
      }),
    );
    const item = findItem(inventory.items, `refs/heads/${branch}`);
    // Carry the classifier's own reasons into the failure. This assertion fails
    // on Linux CI with lane "uncertain" while passing on macOS, and the bare
    // equality told us nothing about which probe went unavailable — the lane is
    // uncertain for several distinct causes (probe errors, missing metadata,
    // unavailable branch/worktree recency). Without this, diagnosing it costs a
    // CI round trip per guess.
    assert.equal(
      item.lane,
      "retire-after-gate",
      `lane was ${item.lane}; reasons: ${JSON.stringify(item.reasons)}`,
    );

    writeFileSync(path.join(worktreePath, "README.md"), "dirty\n");

    const operations = createGitRetirementOperations({
      root: fixture.repo,
      repo: "OpenCoven/coven-cave",
      gateHandle: { generation: 1, token: "tok", ownerId: "owner", root: "/gate" },
      nowMs,
    });

    const reprobed = withPathPrefix(fixture.bin, () => operations.reprobe(item));
    assert.equal(reprobed.ok, false);
    assert.match(
      reprobed.reason,
      /retirement candidate (?:lane changed during final retirement probe|is no longer clean enough to retire)/,
    );
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
});

test("adapter reprobe catches inventory exceptions and returns a blocked result", () => {
  const fixture = createGitFixture();
  try {
    const operations = createGitRetirementOperations({
      root: fixture.repo,
      repo: "OpenCoven/coven-cave",
      gateHandle: { generation: 1, token: "tok", ownerId: "owner", root: "/gate" },
      nowMs: 1_754_000_000_000,
    });

    rmSync(fixture.repo, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });

    const reprobed = operations.reprobe(
      makeItem({
        path: null,
        kind: "branch-only",
        branch: "main",
        ref: "refs/heads/main",
      }),
    );

    assert.equal(reprobed.ok, false);
    assert.match(reprobed.reason, /^final retirement probe failed:/);
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
});

test("real git adapter reads tag retention from the remote, peeling annotated tags", () => {
  const fixture = createGitFixture();
  try {
    const operations = createGitRetirementOperations({
      root: fixture.repo,
      repo: "OpenCoven/coven-cave",
      gateHandle: { generation: 1, token: "gate", ownerId: "retirement-test" },
    });

    const head = git(["rev-parse", "HEAD"], fixture.repo).trim();

    // Nothing is tagged yet.
    assert.deepEqual(operations.readRemoteTagRetention(head), {
      ok: true,
      retainedBy: null,
    });

    // An ANNOTATED tag: its own line carries the tag object's oid and only the
    // peeled `^{}` line carries the commit, which is the case a naive
    // line-by-line match gets wrong in both directions.
    git(["tag", "-a", "archive/fix-example-2026-08-08", head, "-m", "archive"], fixture.repo);
    git(["push", "-q", "origin", "archive/fix-example-2026-08-08"], fixture.repo);

    assert.deepEqual(operations.readRemoteTagRetention(head), {
      ok: true,
      retainedBy: "refs/tags/archive/fix-example-2026-08-08",
    });

    // The tag OBJECT's oid is not a commit and must not read as retention.
    const tagObjectOid = git(
      ["rev-parse", "archive/fix-example-2026-08-08"],
      fixture.repo,
    ).trim();
    assert.notEqual(tagObjectOid, head, "fixture must produce a real annotated tag object");
    assert.deepEqual(operations.readRemoteTagRetention(tagObjectOid), {
      ok: true,
      retainedBy: null,
    });

    // A LIGHTWEIGHT tag has no peeled line and points straight at the commit.
    git(["commit", "-q", "--allow-empty", "-m", "second"], fixture.repo);
    const second = git(["rev-parse", "HEAD"], fixture.repo).trim();
    git(["tag", "archive/light-2026-08-08", second], fixture.repo);
    git(["push", "-q", "origin", "archive/light-2026-08-08"], fixture.repo);

    assert.deepEqual(operations.readRemoteTagRetention(second), {
      ok: true,
      retainedBy: "refs/tags/archive/light-2026-08-08",
    });

    // A LOCAL-only tag is not retention.
    git(["commit", "-q", "--allow-empty", "-m", "third"], fixture.repo);
    const third = git(["rev-parse", "HEAD"], fixture.repo).trim();
    git(["tag", "archive/local-only", third], fixture.repo);

    assert.deepEqual(operations.readRemoteTagRetention(third), {
      ok: true,
      retainedBy: null,
    });

    const malformed = operations.readRemoteTagRetention("not-an-oid");
    assert.equal(malformed.ok, false);
    assert.match(malformed.reason, /malformed oid/);
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
});

test("createGitRetirementOperations rejects path traversal, absolute paths, and symlink cleanup", () => {
  const fixture = createGitFixture();
  try {
    const gate = withPathPrefix(fixture.bin, () =>
      acquireMaintenanceGate({
        ownerId: "retirement-test",
        purpose: "path safety",
        repoDir: fixture.repo,
      }),
    );
    assert.equal(gate.ok, true);
    const operations = createGitRetirementOperations({
      root: fixture.repo,
      repo: "OpenCoven/coven-cave",
      gateHandle: gate.handle,
      nowMs: 1_754_000_000_000,
    });

    const worktree = path.join(fixture.repo, ".worktrees", "path-safety");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(path.join(worktree, "target"), { recursive: true });
    mkdirSync(path.join(fixture.fixtureRoot, "outside"), { recursive: true });
    writeFileSync(path.join(fixture.fixtureRoot, "outside", "owned.txt"), "owned\n");
    symlinkSync(
      path.join(fixture.fixtureRoot, "outside"),
      path.join(worktree, "target", "linked"),
    );

    const baseItem = makeItem({
      path: worktree,
      ignoredPaths: [],
      remoteRef: null,
      branch: "fix/path-safety",
      ref: "refs/heads/fix/path-safety",
    });

    assert.deepEqual(operations.removeDisposableIgnored({
      ...baseItem,
      ignoredPaths: ["target/../../escape"],
    }), {
      ok: false,
      reason: "refused disposable ignored cleanup outside the candidate worktree: target/../../escape",
    });

    assert.deepEqual(operations.removeDisposableIgnored({
      ...baseItem,
      ignoredPaths: [path.join(fixture.fixtureRoot, "outside", "owned.txt")],
    }), {
      ok: false,
      reason:
        `refused disposable ignored cleanup outside the candidate worktree: ${path.join(fixture.fixtureRoot, "outside", "owned.txt")}`,
    });

    assert.deepEqual(operations.removeDisposableIgnored({
      ...baseItem,
      ignoredPaths: ["target/linked"],
    }), {
      ok: false,
      reason: "refused disposable ignored cleanup through a symbolic link: target/linked",
    });

    assert.equal(
      existsSync(path.join(fixture.fixtureRoot, "outside", "owned.txt")),
      true,
      "cleanup rejection must not delete the symlink target",
    );

    const released = withPathPrefix(fixture.bin, () => releaseMaintenanceGate(gate.handle));
    assert.equal(released.ok, true);
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
});

test("real git adapter retires a landed managed worktree under a held maintenance gate", () => {
  const fixture = createGitFixture();
  try {
    const branch = "fix/retire-me";
    const worktreePath = path.join(fixture.repo, ".worktrees", "retire-me");
    const agedEnv = {
      ...process.env,
      GIT_COMMITTER_DATE: "2026-07-20T12:00:00Z",
      GIT_AUTHOR_DATE: "2026-07-20T12:00:00Z",
    };
    git(["branch", branch, "HEAD"], fixture.repo, { env: agedEnv });
    git(["push", "-q", "-u", "origin", branch], fixture.repo);
    // Land the branch for real: advance main past it and push, so the branch
    // is strictly behind the default tip. cave-ox3ky's ae16550d6 fails closed
    // when the candidate oid EQUALS the captured default — with no ref move
    // there is no evidence of WHEN it landed, so the age window is unprovable.
    // A fixture that leaves the branch at the default tip is asserting on a
    // case the engine now (correctly) refuses to judge.
    git(["commit", "-q", "--allow-empty", "-m", "land fix/retire-me"], fixture.repo, { env: agedEnv });
    git(["push", "-q", "origin", "main"], fixture.repo);
    git(["worktree", "add", worktreePath, branch], fixture.repo, { env: agedEnv });
    mkdirSync(path.join(worktreePath, ".next"), { recursive: true });
    writeFileSync(path.join(worktreePath, ".next", "cache.txt"), "cache\n");
    executable(
      path.join(fixture.bin, "bd"),
      `#!/usr/bin/env node
const output = [{
  id: "cave-retire-1",
  status: "closed",
  title: "Managed retirement fixture",
  description: "",
  notes: "",
  external_ref: null,
  metadata: {
    coven: {
      worktree: {
        branch: ${JSON.stringify(branch)},
        path: ${JSON.stringify(worktreePath)},
        owner: "retirement-test",
        purpose: "managed fixture",
        disposition: "pr",
        createdAt: "2026-07-20T12:00:00Z"
      }
    }
  }
}];
process.stdout.write(JSON.stringify(output) + "\\n");
`,
    );

    const nowMs = Date.parse("2026-08-01T12:00:00Z");
    const gate = withPathPrefix(fixture.bin, () =>
      acquireMaintenanceGate({
        ownerId: "retirement-test",
        purpose: "real adapter retirement",
        repoDir: fixture.repo,
      }),
    );
    assert.equal(gate.ok, true);

    const inventory = withPathPrefix(fixture.bin, () =>
      collectWorktreeLifecycleInventory({
        repo: "OpenCoven/coven-cave",
        root: fixture.repo,
        nowMs,
      }),
    );
    const item = findItem(inventory.items, `refs/heads/${branch}`);
    // Carry the classifier's own reasons into the failure. This assertion fails
    // on Linux CI with lane "uncertain" while passing on macOS, and the bare
    // equality told us nothing about which probe went unavailable — the lane is
    // uncertain for several distinct causes (probe errors, missing metadata,
    // unavailable branch/worktree recency). Without this, diagnosing it costs a
    // CI round trip per guess.
    assert.equal(
      item.lane,
      "retire-after-gate",
      `lane was ${item.lane}; reasons: ${JSON.stringify(item.reasons)}`,
    );
    assert.deepEqual(item.ignoredPaths, [".next/"]);

    const operations = createGitRetirementOperations({
      root: fixture.repo,
      repo: "OpenCoven/coven-cave",
      gateHandle: gate.handle,
      nowMs,
    });

    const report = withPathPrefix(fixture.bin, () =>
      retireLifecycleUnits({
        items: inventory.items,
        gateHandle: gate.handle,
        operations,
        maxRetire: "1",
      }),
    );

    assert.equal(report.retired.length, 1);
    assert.deepEqual(report.blocked, []);
    assert.deepEqual(report.cleanupReady, []);
    assert.deepEqual(report.remoteDeletionProposals, [
      {
        ref: `refs/heads/${branch}`,
        oid: item.head,
        localRetirementOid: item.head,
        mergedPr: null,
        reason: "remote-deletion-requires-separate-authorization",
      },
    ]);
    assert.equal(existsSync(path.join(worktreePath, ".next", "cache.txt")), false);
    assert.equal(existsSync(worktreePath), false);
    assert.equal(run(realGit, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], fixture.repo).status, 1);
    const remoteProbe = run(
      realGit,
      ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`],
      fixture.repo,
    );
    assert.equal(remoteProbe.status, 0, "remote branch should remain untouched");

    const released = withPathPrefix(fixture.bin, () => releaseMaintenanceGate(gate.handle));
    assert.equal(released.ok, true);
  } finally {
    cleanupFixture(fixture.fixtureRoot);
  }
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack ?? error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("worktree-lifecycle-retirement.test.mjs: ok");
}

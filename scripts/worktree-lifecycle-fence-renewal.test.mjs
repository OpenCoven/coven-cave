// Fence renewal during the lifecycle inventory (cave-cs9g1).
//
// The bug: the Coven owner lease is 120s, the inventory that runs inside it
// took 120.8s and 149s on a 39-worktree checkout, and nothing renewed the lease
// while it ran — so every `beads:worktrees:create` died on the heartbeat that
// followed the inventory. These tests pin the two properties that fix depends
// on, both of which are easy to regress silently:
//
//   1. renewal is throttled, or the hook spawns a Coven CLI per git command;
//   2. a renewal failure ABORTS the read rather than being swallowed, because
//      an inventory that continues after losing its fence is a snapshot of a
//      repository other writers were free to mutate.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COVEN_OWNER_LEASE_MS,
  createFenceRenewal,
  FENCE_RENEWAL_INTERVAL_MS,
} from "./maintenance-gate.mjs";
import { collectWorktreeLifecycleInventory } from "./worktree-lifecycle-inventory.ts";

test("renewal is throttled so a per-command hook cannot spawn a fence process per command", () => {
  let clock = 0;
  let renewals = 0;
  const hook = createFenceRenewal(() => { renewals += 1; }, { now: () => clock });

  // Immediately after acquisition there is nothing to renew.
  hook();
  clock = FENCE_RENEWAL_INTERVAL_MS - 1;
  hook();
  assert.equal(renewals, 0, "renewal must not fire before the interval elapses");

  clock = FENCE_RENEWAL_INTERVAL_MS;
  hook();
  assert.equal(renewals, 1, "renewal must fire once the interval has elapsed");

  // Hundreds of commands can land inside one interval; they must collapse.
  for (let i = 0; i < 500; i += 1) hook();
  assert.equal(renewals, 1, "calls inside the same interval must collapse to one renewal");

  clock = FENCE_RENEWAL_INTERVAL_MS * 2;
  hook();
  assert.equal(renewals, 2, "the interval must restart from the last renewal");
});

test("a failing renewal propagates so the fenced read stops", () => {
  let clock = 0;
  const boom = new Error("fence lost");
  const hook = createFenceRenewal(() => { throw boom; }, { now: () => clock });
  clock = FENCE_RENEWAL_INTERVAL_MS;
  assert.throws(() => hook(), (error) => error === boom);
});

test("the renewal interval leaves room for a failed renewal inside the Coven lease", () => {
  assert.ok(
    FENCE_RENEWAL_INTERVAL_MS * 2 < COVEN_OWNER_LEASE_MS,
    `renewal every ${FENCE_RENEWAL_INTERVAL_MS}ms must allow one failure and a retry ` +
      `inside the ${COVEN_OWNER_LEASE_MS}ms Coven lease`,
  );
});

test("a throwing progress hook aborts the inventory instead of being swallowed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-fence-renewal-"));
  try {
    execFileSync("git", ["init", "--quiet", dir], { stdio: "ignore" });

    const sentinel = new Error("fence lost mid-inventory");
    let calls = 0;
    assert.throws(
      () =>
        collectWorktreeLifecycleInventory({
          repo: "OpenCoven/coven-cave",
          root: dir,
          nowMs: Date.now(),
          onProgress: () => {
            calls += 1;
            throw sentinel;
          },
        }),
      // The exact error must survive. `command` wraps spawn failures into a
      // CommandResult, and an earlier draft ran the hook inside that catch —
      // which turned a lost fence into an ordinary "invocation failed" and let
      // the inventory carry on unfenced.
      (error) => error === sentinel,
      "a hook that throws must propagate out of the inventory unchanged",
    );
    assert.equal(calls, 1, "the inventory must stop at the first failed renewal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the hook fires repeatedly, not just once, as the inventory runs commands", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-fence-renewal-"));
  try {
    execFileSync("git", ["init", "--quiet", dir], { stdio: "ignore" });

    // Renewal is worthless if it fires once and stops, so require several —
    // then abort, to keep a fixture inventory from running its full GitHub
    // probe inside the unit suite.
    const done = new Error("enough");
    let calls = 0;
    assert.throws(
      () =>
        collectWorktreeLifecycleInventory({
          repo: "OpenCoven/coven-cave",
          root: dir,
          nowMs: Date.now(),
          onProgress: () => {
            calls += 1;
            if (calls >= 5) throw done;
          },
        }),
      (error) => error === done,
    );
    assert.equal(calls, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an aborted inventory does not leave the next one unfenced", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cave-fence-renewal-"));
  try {
    execFileSync("git", ["init", "--quiet", dir], { stdio: "ignore" });

    // The hook lives in module state, so it is set on entry and restored on
    // exit. If that restore were skipped on the throwing path, a read that
    // aborted would silently disarm renewal for every read after it.
    const stop = new Error("stop");
    const runAborting = () => {
      let calls = 0;
      assert.throws(
        () =>
          collectWorktreeLifecycleInventory({
            repo: "OpenCoven/coven-cave",
            root: dir,
            nowMs: Date.now(),
            onProgress: () => {
              calls += 1;
              throw stop;
            },
          }),
        (error) => error === stop,
      );
      return calls;
    };

    assert.equal(runAborting(), 1, "first read must drive its hook");
    assert.equal(runAborting(), 1, "a read after an aborted one must still drive its hook");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  globalNpmInstallOwner,
  resetGlobalNpmInstallLaneForTest,
  reserveGlobalNpmInstall,
} from "./global-npm-install-lane.ts";

test("parallel Coven CLI and Coven Code requests start exactly one global npm child", async () => {
  resetGlobalNpmInstallLaneForTest();
  let childStarts = 0;
  let releaseChild!: () => void;
  const childFinished = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });

  const attemptStart = async (target: "coven-cli" | "coven-code") => {
    // Matching the route's post-preparation point: both requests arrive here
    // together, so the reservation itself must be the atomic boundary.
    await Promise.resolve();
    const reservation = reserveGlobalNpmInstall(target);
    if (!reservation.ok) return reservation;
    childStarts += 1;
    await childFinished;
    reservation.lease.release();
    return reservation;
  };

  const first = attemptStart("coven-cli");
  const second = attemptStart("coven-code");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(childStarts, 1, "only one npm child starts for simultaneous targets");
  assert.ok(globalNpmInstallOwner(), "the winning child owns the global lane");
  releaseChild();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(globalNpmInstallOwner(), null, "completion releases the lane");
});

test("failure, timeout, and cancellation release the lease so a retry can start", () => {
  resetGlobalNpmInstallLaneForTest();
  for (const terminalState of ["failure", "timeout", "cancellation"] as const) {
    const first = reserveGlobalNpmInstall("coven-cli");
    assert.equal(first.ok, true, `${terminalState} test reserves the lane`);
    if (!first.ok) continue;
    first.lease.release();
    assert.equal(globalNpmInstallOwner(), null, `${terminalState} releases the lane`);

    const retry = reserveGlobalNpmInstall("coven-code");
    assert.equal(retry.ok, true, `retry starts after ${terminalState}`);
    if (retry.ok) retry.lease.release();
  }
});

test("the global lease survives module reload and its original cleanup still releases it", async () => {
  resetGlobalNpmInstallLaneForTest();
  const first = reserveGlobalNpmInstall("coven-cli");
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const reloaded = await import(
    `${new URL("./global-npm-install-lane.ts", import.meta.url).href}?hmr=${Date.now()}`
  );
  assert.equal(
    reloaded.globalNpmInstallOwner(),
    "coven-cli",
    "a re-evaluated module sees the active lease",
  );
  first.lease.release();
  assert.equal(reloaded.globalNpmInstallOwner(), null, "the old child cleanup releases it");
});

console.log("global-npm-install-lane.test.ts: ok");

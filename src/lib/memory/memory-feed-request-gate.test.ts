// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

const requestGateModule = await import("./memory-feed-request-gate.ts").catch(
  () => ({}),
);
const createMemoryFeedRequestGate =
  requestGateModule.createMemoryFeedRequestGate;

test("memory feed ownership coordinates independent backgrounds, forced refreshes, and unmount", () => {
  assert.equal(
    typeof createMemoryFeedRequestGate,
    "function",
    "the memory feed request gate is exported",
  );

  const gate = createMemoryFeedRequestGate();
  gate.mount();

  const fileBackground = gate.beginBackground("files");
  const canonicalBackground = gate.beginBackground("canonical");
  const newerCanonicalBackground = gate.beginBackground("canonical");
  assert.equal(
    gate.isCurrent(fileBackground),
    true,
    "canonical polling does not suppress an independent file poll",
  );
  assert.equal(
    gate.isCurrent(canonicalBackground),
    false,
    "a newer request supersedes an older request in the same domain",
  );
  assert.equal(gate.isCurrent(newerCanonicalBackground), true);

  const olderCanonical = gate.beginBackground("canonical");
  const forced = gate.beginForce();
  assert.equal(
    gate.isCurrent(olderCanonical),
    false,
    "a background canonical result crossing a force epoch is stale",
  );
  const fileDuringForce = gate.beginBackground("files");
  const canonicalDuringForce = gate.beginBackground("canonical");
  assert.equal(
    gate.isCurrent(fileDuringForce),
    false,
    "a file poll started during an explicit refresh cannot publish",
  );
  assert.equal(
    gate.isCurrent(canonicalDuringForce),
    false,
    "a canonical poll started during an explicit refresh cannot publish",
  );
  assert.equal(
    gate.isCurrent(forced),
    true,
    "a forced request ignores later background request IDs",
  );

  const newerForced = gate.beginForce();
  assert.equal(
    gate.isCurrent(forced),
    false,
    "a newer forced epoch supersedes an older explicit refresh",
  );
  assert.equal(gate.isCurrent(newerForced), true);
  gate.finishForce(newerForced);
  gate.finishForce(forced);

  const postForceFile = gate.beginBackground("files");
  const postForceCanonical = gate.beginBackground("canonical");
  assert.equal(gate.isCurrent(postForceFile), true);
  assert.equal(gate.isCurrent(postForceCanonical), true);

  const pendingAtUnmount = gate.beginForce();
  gate.unmount();
  assert.equal(
    gate.isCurrent(pendingAtUnmount),
    false,
    "unmount invalidates every pending publication",
  );
  gate.finishForce(pendingAtUnmount);
});

test("settling the current force releases backgrounds while an older force remains pending", () => {
  const gate = createMemoryFeedRequestGate();
  gate.mount();

  const olderForced = gate.beginForce();
  const newerForced = gate.beginForce();
  gate.finishForce(newerForced);

  const backgroundAfterNewerSettled = gate.beginBackground("canonical");
  assert.equal(
    gate.isCurrent(backgroundAfterNewerSettled),
    true,
    "the latest force owns blocking, so a stale pending force cannot suppress later backgrounds",
  );

  gate.finishForce(olderForced);
  assert.equal(
    gate.isCurrent(backgroundAfterNewerSettled),
    true,
    "a late stale force cannot revoke a background that began after the current force settled",
  );

  const staleForced = gate.beginForce();
  const currentForced = gate.beginForce();
  gate.finishForce(staleForced);
  const backgroundWhileCurrent = gate.beginBackground("files");
  assert.equal(
    gate.isCurrent(backgroundWhileCurrent),
    false,
    "finishing a stale force cannot clear the current force owner",
  );
  assert.equal(gate.isCurrent(currentForced), true);

  gate.finishForce(currentForced);
  const backgroundAfterCurrent = gate.beginBackground("files");
  assert.equal(gate.isCurrent(backgroundAfterCurrent), true);
});

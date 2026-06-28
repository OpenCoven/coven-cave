import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_SNAPSHOT_TTL_MS,
  isLiveSnapshotActive,
  type SnapshotLiveness,
} from "./live-chat-snapshot.ts";

function snap(updatedAt: number, aborted = false): SnapshotLiveness {
  return { controller: { signal: { aborted } }, updatedAt };
}

test("a fresh, unaborted snapshot is active", () => {
  const now = 1_000_000;
  assert.equal(isLiveSnapshotActive(snap(now), now), true);
});

test("an aborted snapshot is never active, even when fresh", () => {
  const now = 1_000_000;
  assert.equal(isLiveSnapshotActive(snap(now, true), now), false);
});

test("a snapshot just under the TTL is still active", () => {
  const now = 5_000_000;
  const updatedAt = now - (LIVE_SNAPSHOT_TTL_MS - 1);
  assert.equal(isLiveSnapshotActive(snap(updatedAt), now), true);
});

test("a snapshot exactly at the TTL boundary is stale (strict <)", () => {
  const now = 5_000_000;
  const updatedAt = now - LIVE_SNAPSHOT_TTL_MS;
  assert.equal(isLiveSnapshotActive(snap(updatedAt), now), false);
});

test("a long-idle snapshot is stale — the zombie-busy case", () => {
  const now = 5_000_000;
  const updatedAt = now - LIVE_SNAPSHOT_TTL_MS * 10;
  assert.equal(isLiveSnapshotActive(snap(updatedAt), now), false);
});

test("an aborted snapshot past the TTL is also stale (both conditions fail)", () => {
  const now = 5_000_000;
  assert.equal(isLiveSnapshotActive(snap(now - LIVE_SNAPSHOT_TTL_MS * 2, true), now), false);
});

test("clock skew (updatedAt slightly in the future) is treated as active", () => {
  // A negative elapsed time is < TTL, so a snapshot stamped a moment ahead of
  // this view's clock still counts as live rather than being wrongly evicted.
  const now = 5_000_000;
  assert.equal(isLiveSnapshotActive(snap(now + 500), now), true);
});

test("TTL is generous enough to span a multi-second tool/think gap", () => {
  const now = 5_000_000;
  // 60s of silence (a long tool call) must not be mistaken for a dead stream.
  assert.equal(isLiveSnapshotActive(snap(now - 60_000), now), true);
});

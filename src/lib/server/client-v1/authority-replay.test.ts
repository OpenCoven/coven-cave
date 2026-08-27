import assert from "node:assert/strict";
import test from "node:test";

import { CLIENT_V1_HPKE_FRESHNESS } from "./authority-contract.ts";
import { createClientV1AuthorityReplayCache } from "./authority-replay.ts";

test("reserves each key and nonce once until its expiry", () => {
  const replay = createClientV1AuthorityReplayCache();
  let now = 1_000;

  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "nonce-1",
      issuedAt: now,
    }, now),
    { ok: true },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "nonce-1",
      issuedAt: now,
    }, now),
    { ok: false, reason: "replay" },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key-2",
      requestNonce: "nonce-1",
      issuedAt: now,
    }, now),
    { ok: true },
  );

  now += CLIENT_V1_HPKE_FRESHNESS.replayTtlMs;
  assert.equal(replay.size(now), 0);
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "nonce-1",
      issuedAt: now,
    }, now),
    { ok: true },
  );
});

test("freshness boundaries are inclusive and stale requests consume no capacity", () => {
  const replay = createClientV1AuthorityReplayCache();
  const now = 100_000;

  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "lower-bound",
      issuedAt: now - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs,
    }, now),
    { ok: true },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "upper-bound",
      issuedAt: now + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs,
    }, now),
    { ok: true },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "too-old",
      issuedAt: now - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs - 1,
    }, now),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "too-future",
      issuedAt: now + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs + 1,
    }, now),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "unsafe-time",
      issuedAt: Number.MAX_VALUE,
    }, now),
    { ok: false, reason: "stale" },
  );
  assert.equal(replay.size(now), 2);
});

test("a 4096-page burst is admitted and the next page receives exact retry timing", () => {
  const replay = createClientV1AuthorityReplayCache();
  let now = 10_000;

  for (let page = 0; page < 4_096; page += 1) {
    assert.deepEqual(
      replay.reserve({
        keyId: "key-1",
        requestNonce: `page-${page}`,
        issuedAt: now,
      }, now),
      { ok: true },
    );
  }
  assert.equal(replay.size(now), 4_096);
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "page-4096",
      issuedAt: now,
    }, now),
    {
      ok: false,
      reason: "capacity",
      retryAfterSeconds: 120,
    },
  );
  assert.equal(replay.size(now), 4_096);
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "page-0",
      issuedAt: now,
    }, now),
    { ok: false, reason: "replay" },
  );

  now += CLIENT_V1_HPKE_FRESHNESS.replayTtlMs;
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: "page-4096-fresh-envelope",
      issuedAt: now,
    }, now),
    { ok: true },
  );
  assert.equal(replay.size(now), 1);
});

test("capacity retry timing uses the earliest live expiry and rounds up", () => {
  const replay = createClientV1AuthorityReplayCache();
  const start = 50_000;

  for (let entry = 0; entry < CLIENT_V1_HPKE_FRESHNESS.replayCapacity; entry += 1) {
    const now = entry === 0 ? start : start + 1_500;
    assert.deepEqual(
      replay.reserve({
        keyId: "key",
        requestNonce: `nonce-${entry}`,
        issuedAt: now,
      }, now),
      { ok: true },
    );
  }

  assert.deepEqual(
    replay.reserve({
      keyId: "key",
      requestNonce: "capacity",
      issuedAt: start + 1_501,
    }, start + 1_501),
    {
      ok: false,
      reason: "capacity",
      retryAfterSeconds: 119,
    },
  );
});

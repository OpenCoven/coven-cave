import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  AUTHENTICATED_REQUEST_LIMIT,
  CLIENT_V1_RATE_LIMIT_CAPACITY,
  PAIRING_CREATE_LIMIT,
  RATE_LIMIT_WINDOW_MS,
  clientV1RateLimitSnapshotForTest,
  consumeClientV1RateLimit,
  resetClientV1RateLimitsForTest,
} from "./rate-limit.ts";

beforeEach(() => resetClientV1RateLimitsForTest());

test("pairing creation is limited to 10 requests per loopback peer per minute", () => {
  for (let count = 1; count <= PAIRING_CREATE_LIMIT; count += 1) {
    const result = consumeClientV1RateLimit("pairing-create", "127.0.0.1", 1_000);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, PAIRING_CREATE_LIMIT - count);
  }
  const denied = consumeClientV1RateLimit("pairing-create", "127.0.0.1", 1_001);
  assert.deepEqual(denied, {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 61_000,
    retryAfterMs: 59_999,
    retryAfterSeconds: 60,
  });
});

test("authenticated clients are limited to 120 requests per credential id per minute", () => {
  const credentialId = "9c48a3c6-1b0e-4a15-8416-1d65bf7fae66";
  for (let count = 0; count < AUTHENTICATED_REQUEST_LIMIT; count += 1) {
    assert.equal(
      consumeClientV1RateLimit("authenticated", credentialId, 5_000).allowed,
      true,
    );
  }
  assert.equal(
    consumeClientV1RateLimit("authenticated", credentialId, 5_001).allowed,
    false,
  );
  assert.equal(AUTHENTICATED_REQUEST_LIMIT, 120);
});

test("categories and loopback peers have independent fixed windows", () => {
  for (let count = 0; count < PAIRING_CREATE_LIMIT; count += 1) {
    consumeClientV1RateLimit("pairing-create", "127.0.0.1", 10_000);
  }
  assert.equal(consumeClientV1RateLimit("pairing-create", "127.0.0.1", 10_001).allowed, false);
  assert.equal(consumeClientV1RateLimit("pairing-create", "::1", 10_001).allowed, true);
  assert.equal(consumeClientV1RateLimit("authenticated", "127.0.0.1", 10_001).allowed, true);

  const reset = consumeClientV1RateLimit(
    "pairing-create",
    "127.0.0.1",
    10_000 + RATE_LIMIT_WINDOW_MS,
  );
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, PAIRING_CREATE_LIMIT - 1);
});

test("expired windows are pruned and live capacity remains strictly bounded", () => {
  for (let index = 0; index < CLIENT_V1_RATE_LIMIT_CAPACITY + 25; index += 1) {
    consumeClientV1RateLimit("authenticated", `peer-${index}`, 1_000);
  }
  assert.equal(clientV1RateLimitSnapshotForTest().length, CLIENT_V1_RATE_LIMIT_CAPACITY);

  consumeClientV1RateLimit("pairing-create", "fresh-peer", 1_000 + RATE_LIMIT_WINDOW_MS);
  assert.deepEqual(clientV1RateLimitSnapshotForTest(), [
    {
      category: "pairing-create",
      peer: "fresh-peer",
      count: 1,
      resetAt: 1_000 + RATE_LIMIT_WINDOW_MS * 2,
    },
  ]);
});

test("the reset seam deterministically clears all buckets", () => {
  consumeClientV1RateLimit("authenticated", "127.0.0.1", 1_000);
  assert.equal(clientV1RateLimitSnapshotForTest().length, 1);
  resetClientV1RateLimitsForTest();
  assert.deepEqual(clientV1RateLimitSnapshotForTest(), []);
});

assert.equal(PAIRING_CREATE_LIMIT, 10);
assert.equal(AUTHENTICATED_REQUEST_LIMIT, 120);
assert.equal(RATE_LIMIT_WINDOW_MS, 60_000);
console.log("rate-limit.test.ts: ok");

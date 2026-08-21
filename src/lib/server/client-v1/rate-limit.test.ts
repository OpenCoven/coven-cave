import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_AUTHENTICATED_LIMIT,
  CLIENT_V1_INVALID_BEARER_LIMIT,
  CLIENT_V1_PAIRING_CREATE_LIMIT,
  CLIENT_V1_RATE_LIMIT_WINDOW_MS,
  createClientV1RateLimiter,
} from "./rate-limit.ts";

test("pairing creation allows exactly 10 requests per minute and resets at the boundary", () => {
  let now = 10_000;
  const limiter = createClientV1RateLimiter({ now: () => now });

  for (let index = 0; index < CLIENT_V1_PAIRING_CREATE_LIMIT; index += 1) {
    const result = limiter.consumePairingCreate("loopback");
    assert.equal(result.allowed, true, `request ${index + 1}`);
    assert.equal(result.limit, 10);
    assert.equal(result.remaining, 9 - index);
    assert.equal(result.resetAt, 10_000 + CLIENT_V1_RATE_LIMIT_WINDOW_MS);
    assert.equal(result.retryAfterSeconds, 0);
  }

  const denied = limiter.consumePairingCreate("loopback");
  assert.deepEqual(denied, {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 70_000,
    retryAfterSeconds: 60,
  });

  now = 69_999;
  assert.equal(limiter.consumePairingCreate("loopback").retryAfterSeconds, 1);
  now = 70_000;
  assert.deepEqual(limiter.consumePairingCreate("loopback"), {
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: 130_000,
    retryAfterSeconds: 0,
  });
});

test("authenticated credentials allow exactly 120 requests per minute per credential id", () => {
  let now = 5_000;
  const limiter = createClientV1RateLimiter({ now: () => now });

  for (let index = 0; index < CLIENT_V1_AUTHENTICATED_LIMIT; index += 1) {
    assert.equal(limiter.consumeAuthenticated("credential-a").allowed, true);
  }
  assert.equal(limiter.consumeAuthenticated("credential-a").allowed, false);
  assert.equal(
    limiter.consumeAuthenticated("credential-b").allowed,
    true,
    "credential ids must have independent buckets",
  );

  now += CLIENT_V1_RATE_LIMIT_WINDOW_MS;
  const reset = limiter.consumeAuthenticated("credential-a");
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, CLIENT_V1_AUTHENTICATED_LIMIT - 1);
});

test("invalid bearer attempts use a separate bounded bucket and never spend valid credential budget", () => {
  const limiter = createClientV1RateLimiter({ now: () => 1_000 });

  for (let index = 0; index < CLIENT_V1_INVALID_BEARER_LIMIT; index += 1) {
    assert.equal(limiter.consumeInvalidBearer("loopback").allowed, true);
  }
  assert.equal(limiter.consumeInvalidBearer("loopback").allowed, false);

  for (let index = 0; index < CLIENT_V1_AUTHENTICATED_LIMIT; index += 1) {
    assert.equal(
      limiter.consumeAuthenticated("credential-a").allowed,
      true,
      `valid request ${index + 1}`,
    );
  }
  assert.equal(limiter.consumeAuthenticated("credential-a").allowed, false);
});

test("pairing, invalid bearer, and authenticated categories are isolated even for the same key", () => {
  const limiter = createClientV1RateLimiter({ now: () => 0 });
  const key = "same-identity";

  for (let index = 0; index < CLIENT_V1_PAIRING_CREATE_LIMIT; index += 1) {
    assert.equal(limiter.consumePairingCreate(key).allowed, true);
  }
  assert.equal(limiter.consumePairingCreate(key).allowed, false);
  assert.equal(limiter.consumeInvalidBearer(key).allowed, true);
  assert.equal(limiter.consumeAuthenticated(key).allowed, true);
});

test("expired buckets are pruned and each category evicts its oldest active key at the configured bound", () => {
  let now = 0;
  const limiter = createClientV1RateLimiter({
    maxEntriesPerCategory: 2,
    now: () => now,
  });

  for (let index = 0; index < CLIENT_V1_PAIRING_CREATE_LIMIT; index += 1) {
    limiter.consumePairingCreate("oldest");
  }
  assert.equal(limiter.consumePairingCreate("oldest").allowed, false);

  now = 1;
  limiter.consumePairingCreate("newer");
  now = 2;
  limiter.consumePairingCreate("newest");

  assert.equal(
    limiter.consumePairingCreate("oldest").allowed,
    true,
    "the oldest active bucket was evicted instead of allowing unbounded growth",
  );

  now = CLIENT_V1_RATE_LIMIT_WINDOW_MS + 2;
  assert.equal(limiter.consumePairingCreate("newer").remaining, 9);
  assert.equal(limiter.consumePairingCreate("newest").remaining, 9);
});

test("retry metadata remains stable across repeated rejected requests", () => {
  let now = 12_345;
  const limiter = createClientV1RateLimiter({ now: () => now });
  for (let index = 0; index < CLIENT_V1_PAIRING_CREATE_LIMIT; index += 1) {
    limiter.consumePairingCreate("source");
  }

  const first = limiter.consumePairingCreate("source");
  const second = limiter.consumePairingCreate("source");
  assert.deepEqual(second, first);

  now += 1_001;
  const later = limiter.consumePairingCreate("source");
  assert.equal(later.allowed, false);
  assert.equal(later.resetAt, first.resetAt);
  assert.equal(later.retryAfterSeconds, first.retryAfterSeconds - 1);
});

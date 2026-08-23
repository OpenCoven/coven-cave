import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_AUTHENTICATED_LIMIT,
  CLIENT_V1_INVALID_BEARER_LIMIT,
  CLIENT_V1_PAIRING_CREATE_LIMIT,
  CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
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

/**
 * Every category must bound only itself, proved by exhausting each one in turn
 * under a SHARED key and demanding the other three still answer.
 *
 * The earlier version of this test exhausted `pairing-create` alone and then
 * checked that `invalid-bearer` and `authenticated` still allowed the same key.
 * That cannot fail for a merge between the two categories it checks: pointing
 * `consumeInvalidBearer` at the `authenticated` bucket leaves both of those
 * final assertions passing, because neither of those categories was ever
 * spent — only `pairing-create` was. Its sibling above ("invalid bearer
 * attempts … never spend valid credential budget") misses the same merge for
 * the opposite reason: it varies the key and the category together
 * (`"loopback"` versus `"credential-a"`), so a category collision is hidden
 * behind a key collision that never happens.
 *
 * Both names promise category isolation; neither assertion could observe its
 * loss. Holding the key fixed and rotating which category is exhausted is what
 * makes the promise load-bearing — a merge of ANY two categories now shows up
 * as the merged-into category refusing a key it has never charged.
 */
test("every rate-limit category bounds only itself when the key is held fixed", () => {
  const key = "same-identity";
  const categories = [
    {
      name: "pairing-create",
      limit: CLIENT_V1_PAIRING_CREATE_LIMIT,
      consume: (limiter: ReturnType<typeof createClientV1RateLimiter>) =>
        limiter.consumePairingCreate(key),
    },
    {
      name: "invalid-bearer",
      limit: CLIENT_V1_INVALID_BEARER_LIMIT,
      consume: (limiter: ReturnType<typeof createClientV1RateLimiter>) =>
        limiter.consumeInvalidBearer(key),
    },
    {
      name: "authenticated",
      limit: CLIENT_V1_AUTHENTICATED_LIMIT,
      consume: (limiter: ReturnType<typeof createClientV1RateLimiter>) =>
        limiter.consumeAuthenticated(key),
    },
    {
      name: "pairing-exchange-failure",
      limit: CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
      consume: (limiter: ReturnType<typeof createClientV1RateLimiter>) =>
        limiter.consumePairingExchangeFailure(key),
    },
  ];

  for (const exhausted of categories) {
    // A fresh limiter per row, so each row measures one exhausted category
    // rather than the accumulation of the rows before it.
    const limiter = createClientV1RateLimiter({ now: () => 0 });

    for (let index = 0; index < exhausted.limit; index += 1) {
      assert.equal(
        exhausted.consume(limiter).allowed,
        true,
        `${exhausted.name} request ${index + 1} of ${exhausted.limit}`,
      );
    }
    assert.equal(
      exhausted.consume(limiter).allowed,
      false,
      `${exhausted.name} must refuse once its own limit is spent`,
    );

    for (const other of categories) {
      if (other.name === exhausted.name) continue;
      const result = other.consume(limiter);
      assert.equal(
        result.allowed,
        true,
        `${other.name} must not be spent by exhausting ${exhausted.name}`,
      );
      assert.equal(
        result.remaining,
        other.limit - 1,
        `${other.name} must be charged only its own single request after ${exhausted.name} was exhausted`,
      );
    }
  }
});

test("pairing exchange failures allow exactly 10 wrong secrets per pairing id per window", () => {
  let now = 4_000;
  const limiter = createClientV1RateLimiter({ now: () => now });

  for (let index = 0; index < CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT; index += 1) {
    const result = limiter.consumePairingExchangeFailure("pairing-a");
    assert.equal(result.allowed, true, `failure ${index + 1}`);
    assert.equal(result.limit, 10);
    assert.equal(result.remaining, 9 - index);
    assert.equal(result.resetAt, 4_000 + CLIENT_V1_RATE_LIMIT_WINDOW_MS);
    assert.equal(result.retryAfterSeconds, 0);
  }

  assert.deepEqual(limiter.consumePairingExchangeFailure("pairing-a"), {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 64_000,
    retryAfterSeconds: 60,
  });

  // The exchange route reads the budget *before* comparing secrets, so an
  // exhausted pairing has to read as denied through peek too — otherwise the
  // route would compare one more secret per request and the bound would be off
  // by however many requests arrive in the window.
  assert.deepEqual(limiter.peekPairingExchangeFailure("pairing-a"), {
    allowed: false,
    limit: 10,
    remaining: 0,
    resetAt: 64_000,
    retryAfterSeconds: 60,
  });

  now = 64_000;
  const reset = limiter.consumePairingExchangeFailure("pairing-a");
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT - 1);
});

test("peeking the exchange budget neither inserts an entry nor spends one", () => {
  const limiter = createClientV1RateLimiter({
    maxEntriesPerCategory: 2,
    now: () => 1_000,
  });

  assert.deepEqual(limiter.peekPairingExchangeFailure("never-seen"), {
    allowed: true,
    limit: CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
    remaining: CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
    resetAt: 1_000 + CLIENT_V1_RATE_LIMIT_WINDOW_MS,
    retryAfterSeconds: 0,
  });

  // A repeated peek at a live bucket must report the same budget: the route
  // peeks on every request, including the polls a legitimate holder makes with
  // the CORRECT secret, so a peek that charged would rate limit the honest
  // client out of its own pairing.
  limiter.consumePairingExchangeFailure("pairing-a");
  const live = limiter.peekPairingExchangeFailure("pairing-a");
  assert.equal(live.remaining, CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT - 1);
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(limiter.peekPairingExchangeFailure("pairing-a"), live);
  }
  assert.equal(
    limiter.consumePairingExchangeFailure("pairing-a").remaining,
    CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT - 2,
  );

  // Fill both buckets this map can hold, then probe far more unknown ids than
  // it can hold. If peek inserted, that churn would evict the entries bounding
  // a real brute-force run and hand the attacker a fresh 10 guesses — probing
  // ids it never intends to charge is free.
  for (let index = 0; index < CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT; index += 1) {
    limiter.consumePairingExchangeFailure("pairing-a");
    limiter.consumePairingExchangeFailure("pairing-b");
  }
  assert.equal(limiter.consumePairingExchangeFailure("pairing-a").allowed, false);
  assert.equal(limiter.consumePairingExchangeFailure("pairing-b").allowed, false);

  for (let index = 0; index < 50; index += 1) {
    assert.equal(limiter.peekPairingExchangeFailure(`probe-${index}`).allowed, true);
  }

  assert.equal(limiter.peekPairingExchangeFailure("pairing-a").allowed, false);
  assert.equal(limiter.peekPairingExchangeFailure("pairing-b").allowed, false);
  assert.equal(limiter.consumePairingExchangeFailure("pairing-a").allowed, false);
});

test("exchange failure buckets are independent per pairing id", () => {
  const limiter = createClientV1RateLimiter({ now: () => 0 });

  for (let index = 0; index < CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT; index += 1) {
    assert.equal(limiter.consumePairingExchangeFailure("pairing-a").allowed, true);
  }
  assert.equal(limiter.consumePairingExchangeFailure("pairing-a").allowed, false);

  assert.equal(
    limiter.peekPairingExchangeFailure("pairing-b").remaining,
    CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
    "one pairing's exhausted budget must not block another's exchange",
  );
  assert.equal(limiter.consumePairingExchangeFailure("pairing-b").allowed, true);
});

test("the exchange failure category is isolated from pairing creation for the same key", () => {
  const key = "same-identity";

  const exhaustedExchange = createClientV1RateLimiter({ now: () => 0 });
  for (let index = 0; index < CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT; index += 1) {
    assert.equal(exhaustedExchange.consumePairingExchangeFailure(key).allowed, true);
  }
  assert.equal(exhaustedExchange.consumePairingExchangeFailure(key).allowed, false);
  assert.equal(exhaustedExchange.consumePairingCreate(key).allowed, true);
  assert.equal(exhaustedExchange.consumeAuthenticated(key).allowed, true);
  assert.equal(exhaustedExchange.consumeInvalidBearer(key).allowed, true);

  const exhaustedCreate = createClientV1RateLimiter({ now: () => 0 });
  for (let index = 0; index < CLIENT_V1_PAIRING_CREATE_LIMIT; index += 1) {
    exhaustedCreate.consumePairingCreate(key);
  }
  assert.equal(exhaustedCreate.consumePairingCreate(key).allowed, false);
  assert.equal(
    exhaustedCreate.peekPairingExchangeFailure(key).remaining,
    CLIENT_V1_PAIRING_EXCHANGE_FAILURE_LIMIT,
  );
  assert.equal(exhaustedCreate.consumePairingExchangeFailure(key).allowed, true);
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

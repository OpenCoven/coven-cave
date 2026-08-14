import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  consumeClientV1AuthenticatedLimit,
  consumeClientV1PairingCreateLimit,
  consumeRateLimit,
  rateLimitKeyCountForTest,
  resetRateLimitsForTest,
} from "./rate-limit.ts";

afterEach(() => {
  resetRateLimitsForTest();
});

// ─── immediate exact-capacity boundary ─────────────────────────────────────
// A brand-new bucket starts FULL (capacity tokens) — it has never been
// throttled — so exactly `capacity` requests at the SAME instant succeed and
// the very next one is rejected, with no elapsed time required to observe
// the boundary. This is the token-bucket analogue of the old fixed window's
// "exactly N then reject" boundary, but proves it holds with zero elapsed
// time between requests (a real token bucket, unlike a fixed window, has no
// window-start moment to align to).

test("the authenticated category allows exactly 120 immediate requests then rejects the 121st", () => {
  const key = "cred-boundary";
  for (let i = 0; i < 120; i++) {
    const result = consumeClientV1AuthenticatedLimit(key, 0);
    assert.equal(result.allowed, true, `request ${i + 1} of 120 should be allowed`);
  }
  const rejected = consumeClientV1AuthenticatedLimit(key, 0);
  assert.equal(rejected.allowed, false, "the 121st immediate request must be rejected");
});

test("the pairing-create category allows exactly 10 immediate attempts then rejects the 11th", () => {
  const key = "peer-boundary";
  for (let i = 0; i < 10; i++) {
    const result = consumeClientV1PairingCreateLimit(key, 0);
    assert.equal(result.allowed, true, `attempt ${i + 1} of 10 should be allowed`);
  }
  const rejected = consumeClientV1PairingCreateLimit(key, 0);
  assert.equal(rejected.allowed, false, "the 11th immediate attempt must be rejected");
});

// ─── retry-after: positive, and shrinks as the bucket refills ─────────────

test("retryAfterSeconds is a positive ceiling to the time until one token is next available (pairing: 10/60s -> 6s per token)", () => {
  const key = "peer-retry";
  for (let i = 0; i < 10; i++) consumeClientV1PairingCreateLimit(key, 0);

  // Immediately empty: a full 60s/10 = 6s must elapse before the next token.
  const immediate = consumeClientV1PairingCreateLimit(key, 0);
  assert.equal(immediate.allowed, false);
  assert.equal(immediate.allowed === false && immediate.retryAfterSeconds, 6);

  // Half of that 6s deficit has already elapsed -> half the wait remains,
  // rounded up.
  const halfway = consumeClientV1PairingCreateLimit(key, 3_000);
  assert.equal(halfway.allowed, false);
  assert.equal(halfway.allowed === false && halfway.retryAfterSeconds, 3);

  // 1ms shy of the full deficit elapsing -> still just barely below one
  // token, so still rejected, but the wait has shrunk to 1 whole second
  // (never rounds down to 0).
  const almostThere = consumeClientV1PairingCreateLimit(key, 5_999);
  assert.equal(almostThere.allowed, false);
  assert.equal(almostThere.allowed === false && almostThere.retryAfterSeconds, 1);
});

test("retryAfterSeconds for the authenticated category (120/60s -> 0.5s per token) never rounds down to 0", () => {
  const key = "cred-retry";
  for (let i = 0; i < 120; i++) consumeClientV1AuthenticatedLimit(key, 0);
  // A 0.5s-per-token deficit ceils up to a full 1 second, never 0.
  const immediate = consumeClientV1AuthenticatedLimit(key, 0);
  assert.equal(immediate.allowed, false);
  assert.equal(immediate.allowed === false && immediate.retryAfterSeconds, 1);
});

// ─── real refill: partial elapsed time restores a proportionate number ────

test("30s of elapsed time restores exactly half of the pairing-create bucket's 10-token capacity (5 tokens)", () => {
  const key = "peer-partial-refill";
  for (let i = 0; i < 10; i++) {
    assert.equal(consumeClientV1PairingCreateLimit(key, 0).allowed, true);
  }
  assert.equal(consumeClientV1PairingCreateLimit(key, 0).allowed, false, "bucket starts fully empty");

  // 30s is exactly half of the 60s/10-token refill period -> 5 tokens back,
  // not the full 10 (that would be fixed-window behavior) and not 0.
  for (let i = 0; i < 5; i++) {
    assert.equal(
      consumeClientV1PairingCreateLimit(key, 30_000).allowed,
      true,
      `refilled attempt ${i + 1} of 5 should be allowed`,
    );
  }
  assert.equal(
    consumeClientV1PairingCreateLimit(key, 30_000).allowed,
    false,
    "only 5 tokens were owed back at the 30s mark, the 6th must still be rejected",
  );
});

test("30s of elapsed time restores exactly half of the authenticated bucket's 120-token capacity (60 tokens)", () => {
  const key = "cred-partial-refill";
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeClientV1AuthenticatedLimit(key, 0).allowed, true);
  }
  assert.equal(consumeClientV1AuthenticatedLimit(key, 0).allowed, false, "bucket starts fully empty");

  for (let i = 0; i < 60; i++) {
    assert.equal(
      consumeClientV1AuthenticatedLimit(key, 30_000).allowed,
      true,
      `refilled request ${i + 1} of 60 should be allowed`,
    );
  }
  assert.equal(
    consumeClientV1AuthenticatedLimit(key, 30_000).allowed,
    false,
    "only 60 tokens were owed back at the 30s mark, the 61st must still be rejected",
  );
});

// ─── full refill caps at capacity: idle time cannot accumulate credit ──────

test("a very long idle period never grants more than the bucket's own capacity worth of tokens", () => {
  const key = "peer-idle-cap";
  for (let i = 0; i < 10; i++) {
    assert.equal(consumeClientV1PairingCreateLimit(key, 0).allowed, true);
  }
  // Ten minutes idle is ten full refill periods' worth of "owed" tokens --
  // proof the bucket caps at 10, not 100.
  const farFuture = 10 * 60_000;
  for (let i = 0; i < 10; i++) {
    assert.equal(
      consumeClientV1PairingCreateLimit(key, farFuture).allowed,
      true,
      `post-idle attempt ${i + 1} of 10 should be allowed`,
    );
  }
  assert.equal(
    consumeClientV1PairingCreateLimit(key, farFuture).allowed,
    false,
    "capacity is still only 10, however long the idle period was",
  );
});

// ─── key isolation ─────────────────────────────────────────────────────────

test("two different keys in the same category track independent buckets", () => {
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeClientV1AuthenticatedLimit("cred-a", 0).allowed, true);
  }
  assert.equal(consumeClientV1AuthenticatedLimit("cred-a", 0).allowed, false, "cred-a is exhausted");
  assert.equal(
    consumeClientV1AuthenticatedLimit("cred-b", 0).allowed,
    true,
    "an unrelated key's own bucket is untouched",
  );
});

// ─── category isolation ────────────────────────────────────────────────────

test("the same key string in both categories tracks independent buckets", () => {
  const sharedKey = "shared-key";
  for (let i = 0; i < 10; i++) {
    assert.equal(consumeClientV1PairingCreateLimit(sharedKey, 0).allowed, true);
  }
  assert.equal(
    consumeClientV1PairingCreateLimit(sharedKey, 0).allowed,
    false,
    "pairing-create's own 10-token bucket is exhausted",
  );
  assert.equal(
    consumeClientV1AuthenticatedLimit(sharedKey, 0).allowed,
    true,
    "the authenticated category never saw any of those consumes",
  );
});

// ─── rejected requests never debit or corrupt a bucket ─────────────────────

test("repeated rejections beyond capacity never drive a bucket negative or poison later refills", () => {
  const key = "cred-no-corruption";
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeClientV1AuthenticatedLimit(key, 0).allowed, true);
  }
  // Hammer the empty bucket with far more rejected attempts than its
  // capacity — if a rejected call ever debited a token, the bucket would go
  // negative and require far more than 60s to refill to a full token.
  for (let i = 0; i < 500; i++) {
    assert.equal(consumeClientV1AuthenticatedLimit(key, 0).allowed, false);
  }
  // A full 60s later, exactly capacity (120) fresh tokens are available —
  // proof none of the 500 rejections left the bucket over-debited.
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeClientV1AuthenticatedLimit(key, 60_000).allowed, true, `refilled request ${i + 1}`);
  }
  assert.equal(consumeClientV1AuthenticatedLimit(key, 60_000).allowed, false);
});

// ─── pruning: only fully-refilled AND idle-for-a-full-interval buckets go ──

test("a bucket is pruned once it is both fully refilled and idle for a full refill interval", () => {
  const category = "client-v1-authenticated" as const;
  consumeRateLimit(category, "idle-full", 0); // 120 -> 119 tokens, a 1-token deficit.
  assert.equal(rateLimitKeyCountForTest(category), 1);

  // Touching a different key 60s later triggers a prune scan. By 60s, the
  // 1-token deficit has long since refilled (that only needs 500ms) AND the
  // bucket has been idle for a full 60s interval -- both conditions of the
  // prune criterion are met, so it is dropped.
  consumeRateLimit(category, "other-key", 60_000);
  assert.equal(
    rateLimitKeyCountForTest(category),
    1,
    "the idle, fully-refilled bucket was pruned; only 'other-key' remains",
  );
});

test("a fully-refilled bucket is NOT pruned before a full idle interval has elapsed", () => {
  const category = "client-v1-authenticated" as const;
  consumeRateLimit(category, "still-active", 0); // 120 -> 119, refills to full well before 60s.
  assert.equal(rateLimitKeyCountForTest(category), 1);

  // Only 59.999s have elapsed -- fully refilled, but not yet idle a FULL
  // interval, so it must survive the prune scan.
  consumeRateLimit(category, "other-key", 59_999);
  assert.equal(
    rateLimitKeyCountForTest(category),
    2,
    "the bucket is fully refilled but not yet idle a full interval, so it must not be pruned",
  );
});

test("the idle-interval threshold applies regardless of how large the token deficit was (a fully-drained bucket)", () => {
  const category = "client-v1-authenticated" as const;
  for (let i = 0; i < 120; i++) consumeRateLimit(category, "not-full-yet", 0); // fully drained: 0 tokens.
  assert.equal(rateLimitKeyCountForTest(category), 1);

  // 59s elapsed: even though this bucket started fully drained (a much
  // larger deficit than the 1-token case above), it is still short of the
  // full 60s idle threshold, so it must survive the prune scan exactly like
  // the smaller-deficit bucket did.
  consumeRateLimit(category, "other-key", 59_000);
  assert.equal(
    rateLimitKeyCountForTest(category),
    2,
    "idle time has not yet reached a full refill interval, so the bucket must not be pruned",
  );

  // At exactly 60s idle, both the idle-interval AND fully-refilled
  // conditions are satisfied together (by construction, a bucket idle for a
  // full interval has always regenerated back up to capacity) -- the bucket
  // is pruned.
  consumeRateLimit(category, "yet-another-key", 60_000);
  assert.equal(
    rateLimitKeyCountForTest(category),
    2,
    "'not-full-yet' was pruned at the full 60s idle mark; 'other-key' and 'yet-another-key' remain",
  );
});

// ─── bounded key count + deterministic LRU eviction ────────────────────────

test("a category is bounded to 1024 keys, evicting the least-recently-used bucket first", () => {
  const category = "client-v1-authenticated" as const;
  // Insert keys with staggered last-access times, 1ms apart, all still well
  // within one refill interval of each other so none is pruned as idle.
  for (let i = 0; i < 1024; i++) {
    consumeRateLimit(category, `key-${i}`, i);
  }
  assert.equal(rateLimitKeyCountForTest(category), 1024, "exactly at capacity, nothing evicted yet");

  // One more distinct key pushes the category over capacity: key-0 has the
  // smallest `lastAccessAt` (0) of any tracked key, so it is the
  // least-recently-used and must be the one evicted -- not an arbitrary one.
  consumeRateLimit(category, "key-1024", 1024);
  assert.equal(rateLimitKeyCountForTest(category), 1024, "capacity is never exceeded");

  // key-0's bucket was evicted, so consuming it again starts a brand new,
  // fully-refilled bucket rather than reusing whatever token count it had
  // before eviction.
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeRateLimit(category, "key-0", 2_000).allowed, true, `key-0 request ${i + 1} after re-creation`);
  }
  assert.equal(consumeRateLimit(category, "key-0", 2_000).allowed, false, "key-0's re-created bucket has its own fresh capacity");
});

test("least-recently-used eviction ties break by insertion order (the earliest-inserted key is evicted)", () => {
  const category = "client-v1-pairing-create" as const;
  // Every key below is consumed at the exact same `now`, so every bucket's
  // `lastAccessAt` ties at 0 -- the only thing that can break the tie is
  // insertion order.
  for (let i = 0; i < 1024; i++) {
    consumeRateLimit(category, `tied-${i}`, 0);
  }
  assert.equal(rateLimitKeyCountForTest(category), 1024);

  consumeRateLimit(category, "tied-1024", 0);
  assert.equal(rateLimitKeyCountForTest(category), 1024, "capacity is never exceeded");

  // "tied-0" was inserted first, so among the fully-tied timestamps it must
  // be the one evicted -- proven the same way as above, by observing its
  // bucket has been re-created fresh.
  for (let i = 0; i < 10; i++) {
    assert.equal(consumeRateLimit(category, "tied-0", 0).allowed, true, `tied-0 attempt ${i + 1} after re-creation`);
  }
  assert.equal(consumeRateLimit(category, "tied-0", 0).allowed, false);
});

test("consuming an existing key never evicts another key, even at capacity", () => {
  const category = "client-v1-authenticated" as const;
  for (let i = 0; i < 1024; i++) {
    consumeRateLimit(category, `stable-${i}`, i);
  }
  assert.equal(rateLimitKeyCountForTest(category), 1024);

  // Repeatedly re-consuming an EXISTING key at capacity must never evict any
  // other key -- eviction only ever happens when inserting a brand-new key.
  for (let i = 0; i < 50; i++) {
    consumeRateLimit(category, "stable-500", 2_000);
  }
  assert.equal(
    rateLimitKeyCountForTest(category),
    1024,
    "re-consuming an existing key at capacity must never change the tracked key count",
  );

  // A key that was never touched by the loop above, e.g. the very first one
  // inserted, is still present -- proof nothing else was evicted to make
  // room for "stable-500"'s own repeated consumes.
  assert.equal(
    consumeRateLimit(category, "stable-0", 2_000).allowed,
    true,
    "stable-0 still has budget left over from its single earlier consume",
  );
});

// ─── clock safety: non-finite timestamps throw before touching any map ─────

test("a NaN timestamp throws a RangeError and creates no key", () => {
  const category = "client-v1-authenticated" as const;
  assert.throws(() => consumeRateLimit(category, "nan-key", NaN), RangeError);
  assert.equal(rateLimitKeyCountForTest(category), 0, "the rejected call must never have created a bucket");
});

test("a +Infinity timestamp throws a RangeError and creates no key", () => {
  const category = "client-v1-authenticated" as const;
  assert.throws(() => consumeRateLimit(category, "inf-key", Infinity), RangeError);
  assert.equal(rateLimitKeyCountForTest(category), 0, "the rejected call must never have created a bucket");
});

test("a -Infinity timestamp throws a RangeError and creates no key", () => {
  const category = "client-v1-authenticated" as const;
  assert.throws(() => consumeRateLimit(category, "neg-inf-key", -Infinity), RangeError);
  assert.equal(rateLimitKeyCountForTest(category), 0, "the rejected call must never have created a bucket");
});

test("a non-finite timestamp throws before mutating an EXISTING bucket's state", () => {
  const category = "client-v1-authenticated" as const;
  const key = "existing-bucket-guard";
  consumeRateLimit(category, key, 0); // 120 -> 119 tokens; establishes real state.

  for (const badNow of [NaN, Infinity, -Infinity]) {
    assert.throws(() => consumeRateLimit(category, key, badNow), RangeError);
  }

  // The bucket must be exactly as the single real call above left it: still
  // 119 tokens available at time 0, unaffected by any of the three throws.
  for (let i = 0; i < 119; i++) {
    assert.equal(consumeRateLimit(category, key, 0).allowed, true, `pre-existing token ${i + 1} of 119`);
  }
  assert.equal(consumeRateLimit(category, key, 0).allowed, false, "exactly the pre-existing 119 tokens were available, no more and no less");
});

test("1100 distinct keys, each called only with an invalid timestamp, can never exceed or change the tracked key count", () => {
  const category = "client-v1-authenticated" as const;
  for (let i = 0; i < 1100; i++) {
    const badNow = i % 3 === 0 ? NaN : i % 3 === 1 ? Infinity : -Infinity;
    assert.throws(() => consumeRateLimit(category, `invalid-time-key-${i}`, badNow), RangeError);
  }
  assert.equal(
    rateLimitKeyCountForTest(category),
    0,
    "every one of the 1100 calls threw before touching the map; none may have created a key",
  );
});

// ─── clock safety: per-bucket time is monotonic across a backward jump ────

test("a backward wall-clock jump cannot move lastAccessAt backward or manufacture an artificial refill on return to the later time", () => {
  const category = "client-v1-authenticated" as const;
  const key = "clock-rollback";

  // Exhaust the bucket at wall time 100000.
  for (let i = 0; i < 120; i++) {
    assert.equal(consumeRateLimit(category, key, 100_000).allowed, true, `exhausting request ${i + 1} of 120`);
  }
  assert.equal(consumeRateLimit(category, key, 100_000).allowed, false, "bucket is fully exhausted at 100000");

  // The wall clock steps backward to 0 (e.g. an NTP correction) while this
  // bucket is still empty. Elapsed time from the bucket's own perspective
  // must be clamped to zero (never negative), and lastAccessAt must not be
  // dragged back down to 0.
  const duringRollback = consumeRateLimit(category, key, 0);
  assert.equal(duringRollback.allowed, false, "no time has genuinely elapsed from the bucket's perspective during the rollback");

  // The wall clock returns to exactly 100000 (its last real value). If the
  // rollback call above had incorrectly set lastAccessAt back to 0, this call
  // would see a fabricated 100000ms of "elapsed" time and refill the entire
  // bucket — it must not.
  const afterReturn = consumeRateLimit(category, key, 100_000);
  assert.equal(afterReturn.allowed, false, "returning to the same real wall time must not have manufactured any refill");

  // Real time genuinely advancing past 100000 still refills normally —
  // proof the clamp only suppresses backward jumps, not real elapsed time.
  const halfWindowLater = consumeRateLimit(category, key, 130_000);
  assert.equal(halfWindowLater.allowed, true, "30s of genuine elapsed time (half the refill window) must still refill 60 tokens");
});

test("a backward wall-clock jump during partial (not fully exhausted) use also cannot fabricate refill", () => {
  const key = "clock-rollback-partial";

  // Consume 4 of 10 tokens at wall time 100000 -> 6 tokens remain.
  for (let i = 0; i < 4; i++) {
    assert.equal(consumeClientV1PairingCreateLimit(key, 100_000).allowed, true);
  }

  // A rollback to time 0 must observe zero elapsed time (not negative), so
  // it neither grants extra tokens nor errors. It spends one of the 6
  // remaining tokens like any other call would -- 5 remain afterward.
  assert.equal(consumeClientV1PairingCreateLimit(key, 0).allowed, true, "one of the 6 remaining tokens is still available during the rollback");

  // Returning to the same real wall time (100000) must still reflect only the
  // real elapsed time (zero, since the rollback call happened at the "same"
  // logical instant from the bucket's clamped perspective) -- not
  // 100000ms worth of fabricated refill. Exactly the 5 tokens left over from
  // before the rollback are available, no more.
  let allowedCount = 0;
  while (consumeClientV1PairingCreateLimit(key, 100_000).allowed) allowedCount++;
  assert.equal(
    allowedCount,
    5,
    "exactly the 5 pre-rollback tokens remained; the rollback must not have fabricated any extra",
  );
});

test("prune scans remain safe when a later call arrives at a lower wall time than an existing bucket's clamped lastAccessAt", () => {
  const category = "client-v1-authenticated" as const;
  const key = "clock-rollback-prune-safety";

  // Establish a bucket at wall time 100000 with a 1-token deficit.
  consumeRateLimit(category, key, 100_000);
  assert.equal(rateLimitKeyCountForTest(category), 1);

  // A second, distinct key is created at an EARLIER wall time than the first
  // bucket's lastAccessAt (100000). The prune scan run on behalf of this call
  // must not treat the first bucket as idle for a full window just because
  // the incoming `now` is numerically smaller than its lastAccessAt --
  // elapsed must clamp to 0, not go negative, for that unrelated bucket.
  consumeRateLimit(category, "other-lower-time-key", 50_000);
  assert.equal(
    rateLimitKeyCountForTest(category),
    2,
    "the first bucket must survive: a lower incoming wall time must never register as this bucket being idle",
  );
});

// ─── clock safety: high-water mark is per-CATEGORY, not merely per-bucket ──
// A per-bucket clamp alone is insufficient: a brand-new key has no prior
// `lastAccessAt` of its own to clamp against. If the wall clock rolls
// backward AFTER some other key in the same category has already advanced
// time forward, a fresh key created and exhausted during that rollback must
// still be treated as created at the category's high-water time, not the
// rolled-back one -- otherwise it could fabricate an artificial refill once
// the wall clock returns to its previous, higher real value.

test("a new key created and exhausted during a wall-clock rollback after another key established the category high-water remains rejected on return to the earlier real wall time", () => {
  const category = "client-v1-authenticated" as const;

  // Key A establishes the category's high-water mark at 100000.
  assert.equal(consumeRateLimit(category, "hw-key-a", 100_000).allowed, true);

  // The wall clock rolls back to 0. A brand-new key B is created and fully
  // exhausted while every real `now` passed in is 0 -- but the category's
  // high-water (100000) means B is actually created/consumed at effective
  // time 100000, not the bogus 0.
  for (let i = 0; i < 120; i++) {
    assert.equal(
      consumeRateLimit(category, "hw-key-b", 0).allowed,
      true,
      `exhausting request ${i + 1} of 120 for key B during the rollback`,
    );
  }
  assert.equal(
    consumeRateLimit(category, "hw-key-b", 0).allowed,
    false,
    "key B is fully exhausted, at effective time 100000",
  );

  // The wall clock returns to 100000 -- its previous real high point. Key B
  // must receive NO artificial refill: from its own perspective, zero time
  // has genuinely elapsed since it was created at effective time 100000.
  const onReturn = consumeRateLimit(category, "hw-key-b", 100_000);
  assert.equal(onReturn.allowed, false, "no artificial refill on return to the previous high-water wall time");
});

test("real wall-clock movement beyond the category high-water still refills a key created entirely during a rollback", () => {
  const category = "client-v1-authenticated" as const;

  // Establish the category high-water at 100000 via an unrelated key.
  assert.equal(consumeRateLimit(category, "hw-advance-a", 100_000).allowed, true);

  // Key B is created and exhausted entirely during a rollback to real time 0.
  for (let i = 0; i < 120; i++) consumeRateLimit(category, "hw-advance-b", 0);
  assert.equal(consumeRateLimit(category, "hw-advance-b", 0).allowed, false);

  // Genuine forward progress past the high-water -- 130000, 30s past the
  // 100000 high-water -- must still refill 60 of the 120 tokens (proof the
  // category high-water only suppresses backward jumps, not real elapsed
  // time, even for a key that never itself saw a real, non-rolled-back
  // timestamp before now).
  assert.equal(
    consumeRateLimit(category, "hw-advance-b", 130_000).allowed,
    true,
    "30s of real elapsed time past the high-water must still refill",
  );
});

test("resetRateLimitsForTest clears the category high-water, not just the bucket maps", () => {
  const category = "client-v1-pairing-create" as const;

  // Push the category high-water to 100000.
  assert.equal(consumeRateLimit(category, "hw-reset-establish", 100_000).allowed, true);

  resetRateLimitsForTest();

  // If the high-water had NOT been cleared by reset, this brand-new key's
  // first call at real time 0 would be silently clamped up to the stale
  // 100000 high-water, recording lastAccessAt as 100000 instead of 0.
  const key = "hw-reset-fresh";
  for (let i = 0; i < 10; i++) consumeRateLimit(category, key, 0); // exhaust all 10 tokens at real time 0.
  assert.equal(consumeRateLimit(category, key, 0).allowed, false, "bucket is exhausted at real time 0");

  // A modest forward step to 30000 -- past 0, but nowhere near the stale
  // 100000 high-water -- must show 30000ms of genuine elapsed time and
  // refill exactly 5 of the 10 tokens (10/60000 * 30000 = 5). If the stale
  // high-water had survived the reset, 30000 would be clamped UP to 100000
  // and this bucket (whose lastAccessAt would also be the stale 100000)
  // would see zero elapsed time and refill nothing at all.
  let allowedCount = 0;
  while (consumeRateLimit(category, key, 30_000).allowed) allowedCount++;
  assert.equal(
    allowedCount,
    5,
    "exactly 5 tokens (30s of genuine elapsed time out of the 60s window) refilled -- proving the high-water was reset, not stale",
  );
});

test("each category maintains its own independent high-water timestamp", () => {
  // Push only the authenticated category's high-water to 100000.
  assert.equal(consumeRateLimit("client-v1-authenticated", "indep-auth", 100_000).allowed, true);

  // A brand-new key in the UNRELATED pairing-create category, called with a
  // real `now` of 0, must be created at effective time 0 -- not clamped up
  // to the authenticated category's 100000 high-water.
  const key = "indep-pairing";
  for (let i = 0; i < 10; i++) {
    assert.equal(
      consumeRateLimit("client-v1-pairing-create", key, 0).allowed,
      true,
      `pairing token ${i + 1} of 10, unaffected by the authenticated category's high-water`,
    );
  }
  assert.equal(
    consumeRateLimit("client-v1-pairing-create", key, 0).allowed,
    false,
    "exhausted at real time 0",
  );

  // A modest forward step to 30000 must show genuine 30000ms elapsed time
  // (5 of 10 tokens back), proving the pairing-create category's own
  // high-water was never dragged up to 100000 by the unrelated
  // authenticated category.
  let allowedCount = 0;
  while (consumeRateLimit("client-v1-pairing-create", key, 30_000).allowed) allowedCount++;
  assert.equal(
    allowedCount,
    5,
    "pairing-create category high-water is independent of the authenticated category's high-water",
  );
});

console.log("rate-limit.test.ts: ok");

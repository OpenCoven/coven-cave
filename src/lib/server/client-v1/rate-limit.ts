// In-memory, per-process token-bucket rate limiter for the `/api/client/v1`
// facade. Two categories exist today:
//
//   - `client-v1-pairing-create`: bounds how often the loopback peer may
//     start a new pairing handshake, keyed by the fixed loopback key (see
//     `LOOPBACK_PAIRING_CREATE_KEY` in the pairing route) — never by
//     caller-controlled input such as an installation id, which a caller can
//     trivially rotate to bypass a per-key limit. Capacity 10, refilling 10
//     tokens every 60,000ms.
//   - `client-v1-authenticated`: bounds how often an already-verified bearer
//     credential may call any route, keyed by credential id. Capacity 120,
//     refilling 120 tokens every 60,000ms.
//
// Each category is a real token bucket, not a fixed window: tokens trickle
// back continuously at `capacity / windowMs` tokens per millisecond, rather
// than all resetting at once at a window boundary. A bucket starts full (a
// brand-new key has never been throttled) and every successful consume costs
// exactly one token.
//
// Deliberately NOT shared, distributed, or persisted: a restart clears every
// bucket, matching pairing-store.ts's "nothing here is trusted across a
// restart" posture. Each category's key space is bounded (least-recently-used
// eviction once idle, fully-refilled buckets have been pruned) so an
// attacker who tries many distinct keys cannot grow this process's memory
// without limit.

export type RateLimitCategory = "client-v1-pairing-create" | "client-v1-authenticated";

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Bucket = {
  /** Tokens available as of `lastAccessAt` (fractional between consumes). */
  tokens: number;
  /** The last time this bucket was actually consumed — NOT touched by prune
   *  scans of other keys, so it stays a true "last used" timestamp usable for
   *  both idle-pruning and least-recently-used eviction. */
  lastAccessAt: number;
};

type CategoryConfig = {
  capacity: number;
  windowMs: number;
  /** Tokens regenerated per millisecond: `capacity / windowMs`. */
  ratePerMs: number;
};

function makeConfig(capacity: number, windowMs: number): CategoryConfig {
  return { capacity, windowMs, ratePerMs: capacity / windowMs };
}

const CATEGORY_CONFIG: Record<RateLimitCategory, CategoryConfig> = {
  "client-v1-pairing-create": makeConfig(10, 60_000),
  "client-v1-authenticated": makeConfig(120, 60_000),
};

// Bounds a flood of distinct keys (e.g. many bogus installation ids, or many
// distinct — even if individually valid — credential ids) the same way
// pairing-store.ts bounds outstanding requests: well past any legitimate
// concurrent count, with least-recently-used eviction so growth is capped
// rather than unlimited.
const MAX_KEYS_PER_CATEGORY = 1024;

const categoryBuckets: Record<RateLimitCategory, Map<string, Bucket>> = {
  "client-v1-pairing-create": new Map(),
  "client-v1-authenticated": new Map(),
};

// The highest `now` (post-validation) this category has EVER observed, across
// every key in it — NOT per-bucket. `-Infinity` means the category has never
// seen a call since process start (or since the last `resetRateLimitsForTest`).
// See the big comment on `consumeRateLimit` for why a per-bucket clamp alone
// is insufficient: a brand-new key created entirely during a wall-clock
// rollback has no prior `lastAccessAt` of its own to clamp against, so
// without a category-wide floor it would be created at the (bogus, low)
// rolled-back `now` and could then fabricate a refill once the wall clock
// returns to its previous, higher real value.
const categoryHighWater: Record<RateLimitCategory, number> = {
  "client-v1-pairing-create": -Infinity,
  "client-v1-authenticated": -Infinity,
};

/**
 * Returns how many tokens `bucket` would have "as of `now`" WITHOUT mutating
 * it — used both by the real consume path (which then commits the refill
 * back onto the bucket it actually touches) and by the prune scan (which
 * must never treat inspecting an unrelated key's bucket as activity on that
 * key).
 */
function virtualTokens(bucket: Bucket, config: CategoryConfig, now: number): number {
  const elapsedMs = Math.max(0, now - bucket.lastAccessAt);
  return Math.min(config.capacity, bucket.tokens + elapsedMs * config.ratePerMs);
}

/**
 * Drop every bucket in `map` that is BOTH fully refilled (every token it
 * could possibly hold is back) AND has gone at least one full refill
 * interval without being touched. A bucket that still owes tokens to a
 * recent burst, or one that was only just used, is never pruned — only a key
 * that has been completely idle for a whole window, with nothing left to
 * remember, is dropped.
 */
function pruneIdleFull(map: Map<string, Bucket>, config: CategoryConfig, now: number): void {
  for (const [key, bucket] of map) {
    const elapsedMs = Math.max(0, now - bucket.lastAccessAt);
    if (elapsedMs >= config.windowMs && virtualTokens(bucket, config, now) >= config.capacity) {
      map.delete(key);
    }
  }
}

/**
 * Evict the single least-recently-used bucket (smallest `lastAccessAt`).
 * Called ONLY immediately before inserting a brand-new key once the category
 * is already at capacity after pruning — an existing key's own bucket is
 * never evicted to make room for itself. Ties (equal `lastAccessAt`) break
 * by insertion order: `Map` iterates in insertion order and only a strictly
 * smaller timestamp replaces the current candidate, so among equal
 * timestamps the earliest-inserted key found first is the one evicted.
 */
function evictLeastRecentlyUsed(map: Map<string, Bucket>): void {
  let lruKey: string | null = null;
  let lruAt = Infinity;
  for (const [key, bucket] of map) {
    if (bucket.lastAccessAt < lruAt) {
      lruAt = bucket.lastAccessAt;
      lruKey = key;
    }
  }
  if (lruKey !== null) map.delete(lruKey);
}

/**
 * Consume one token from `key`'s bucket in `category`. Returns
 * `{ allowed: true }` and debits exactly one token when at least one is
 * available; returns `{ allowed: false, retryAfterSeconds }` — WITHOUT
 * debiting anything — once the bucket is empty, so a burst of rejected calls
 * can never drive a bucket negative or corrupt its state.
 *
 * A brand-new key starts with a FULL bucket (`capacity` tokens): it has
 * never been throttled, so there is nothing to wait for. Refill happens
 * continuously and lazily — tokens accrue at `capacity / windowMs` per
 * millisecond of elapsed time since the key's own last access, capped at
 * `capacity` (idle time can never accumulate a credit above the bucket's
 * ceiling).
 *
 * `retryAfterSeconds` is the ceiling of the time until the bucket next holds
 * at least one full token, always a positive integer (floored at 1 — a
 * caller told to wait a fraction of a second should still wait at least one
 * whole second).
 *
 * `now` must be a finite timestamp — NaN, +Infinity, or -Infinity throws a
 * `RangeError` before any map is touched (before pruning, before the key
 * lookup, before a new bucket could be created), so a caller that manages to
 * inject a non-finite clock reading can never create a key, corrupt an
 * existing bucket, or (worst case) trick `pruneIdleFull` into treating every
 * bucket as infinitely idle and wiping the whole category. Production's own
 * `Date.now()` default is always finite, so this only ever rejects an
 * explicitly-injected bad value.
 *
 * Time is monotonic per CATEGORY, not merely per bucket: once a finite `now`
 * has been validated, `effectiveNow = max(now, categoryHighWater[category])`
 * is computed and the category's high-water mark is advanced to it (never
 * retreated). `effectiveNow` — not the raw `now` — is then used consistently
 * for the prune scan, the existing-key lookup's refill math, a brand-new
 * bucket's initial `lastAccessAt`, and the retry-after math below.
 *
 * A PER-BUCKET clamp alone (against only that bucket's own prior
 * `lastAccessAt`) is insufficient: a brand-new key has no prior
 * `lastAccessAt` of its own to clamp against, so if the wall clock rolls
 * backward (NTP step, VM pause/resume, manual clock change) after some OTHER
 * key in the same category has already advanced time forward, a fresh key
 * created and exhausted during that rollback would otherwise be recorded at
 * the rolled-back (low) time — and would then fabricate an artificial refill
 * once the wall clock returns to its previous, higher real value. Tracking
 * the high-water mark once per category (rather than only once a bucket
 * exists) closes that gap while leaving every OTHER category's high-water
 * mark, and every bucket's tokens, untouched.
 */
export function consumeRateLimit(
  category: RateLimitCategory,
  key: string,
  now: number = Date.now(),
): RateLimitResult {
  if (!Number.isFinite(now)) {
    throw new RangeError(
      `consumeRateLimit: "now" must be a finite timestamp (ms since epoch), got ${now}`,
    );
  }

  const map = categoryBuckets[category];
  const config = CATEGORY_CONFIG[category];

  // Category-wide monotonic floor: never used to make time run BACKWARD
  // (`max` is a no-op for a same-or-forward `now`), only to absorb a
  // backward jump so it can never be observed as elapsed time by prune,
  // lookup, creation, or refill below.
  const effectiveNow = Math.max(now, categoryHighWater[category]);
  categoryHighWater[category] = effectiveNow;

  pruneIdleFull(map, config, effectiveNow);

  let bucket = map.get(key);
  if (!bucket) {
    // Make room only when the key doesn't already exist — an existing
    // (still-live) key refilling/debiting its own entry must never trigger
    // eviction of some OTHER key.
    if (map.size >= MAX_KEYS_PER_CATEGORY) {
      evictLeastRecentlyUsed(map);
    }
    bucket = { tokens: config.capacity, lastAccessAt: effectiveNow };
    map.set(key, bucket);
  } else {
    bucket.tokens = virtualTokens(bucket, config, effectiveNow);
    bucket.lastAccessAt = effectiveNow;
  }

  if (bucket.tokens < 1) {
    const tokensNeeded = 1 - bucket.tokens;
    const msUntilNextToken = tokensNeeded / config.ratePerMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(msUntilNextToken / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  bucket.tokens -= 1;
  return { allowed: true };
}

/** `consumeRateLimit` pinned to the pairing-create category. */
export function consumeClientV1PairingCreateLimit(key: string, now: number = Date.now()): RateLimitResult {
  return consumeRateLimit("client-v1-pairing-create", key, now);
}

/** `consumeRateLimit` pinned to the authenticated category, keyed by credential id. */
export function consumeClientV1AuthenticatedLimit(credentialId: string, now: number = Date.now()): RateLimitResult {
  return consumeRateLimit("client-v1-authenticated", credentialId, now);
}

/** Test-only: how many distinct keys are currently tracked for `category`. */
export function rateLimitKeyCountForTest(category: RateLimitCategory): number {
  return categoryBuckets[category].size;
}

/**
 * Test-only: drop every tracked bucket AND every category's high-water mark.
 * Resetting only the bucket maps would leave a stale high-water mark behind,
 * which could then silently clamp a subsequent test's low `now` values
 * upward and corrupt its expectations — both pieces of state are process
 * memory that must be wiped together for tests to be independent.
 */
export function resetRateLimitsForTest(): void {
  for (const map of Object.values(categoryBuckets)) map.clear();
  for (const category of Object.keys(categoryHighWater) as RateLimitCategory[]) {
    categoryHighWater[category] = -Infinity;
  }
}

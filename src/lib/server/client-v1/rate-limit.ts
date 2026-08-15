export const RATE_LIMIT_WINDOW_MS = 60_000;
export const PAIRING_CREATE_LIMIT = 10;
export const AUTHENTICATED_REQUEST_LIMIT = 120;
export const CLIENT_V1_RATE_LIMIT_CAPACITY = 256;

export type ClientV1RateLimitCategory = "pairing-create" | "authenticated";

export type ClientV1RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
};

type Bucket = {
  category: ClientV1RateLimitCategory;
  peer: string;
  count: number;
  resetAt: number;
};

const LIMITS: Record<ClientV1RateLimitCategory, number> = {
  "pairing-create": PAIRING_CREATE_LIMIT,
  authenticated: AUTHENTICATED_REQUEST_LIMIT,
};

const buckets = new Map<string, Bucket>();

function bucketKey(category: ClientV1RateLimitCategory, peer: string): string {
  return `${category}\u0000${peer}`;
}

function pruneExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function makeRoom(now: number): void {
  pruneExpired(now);
  while (buckets.size >= CLIENT_V1_RATE_LIMIT_CAPACITY) {
    const oldestKey = buckets.keys().next().value;
    if (oldestKey === undefined) break;
    buckets.delete(oldestKey);
  }
}

/**
 * Consumes one fixed-window request token for a category and trusted subject.
 * Pairing creation uses the verified loopback peer; authenticated requests use
 * the verified credential id. Untrusted request metadata must never be used.
 */
export function consumeClientV1RateLimit(
  category: ClientV1RateLimitCategory,
  peer: string,
  now = Date.now(),
): ClientV1RateLimitResult {
  const limit = LIMITS[category];
  if (limit === undefined) throw new Error(`Unknown client-v1 rate-limit category: ${String(category)}`);
  if (!peer) throw new Error("Client-v1 rate-limit peer must be nonempty");

  const key = bucketKey(category, peer);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket) makeRoom(now);
    bucket = {
      category,
      peer,
      count: 0,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
    buckets.set(key, bucket);
  }

  const allowed = bucket.count < limit;
  if (allowed) bucket.count += 1;
  const retryAfterMs = allowed ? 0 : Math.max(1, bucket.resetAt - now);

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterMs,
    retryAfterSeconds: allowed ? 0 : Math.ceil(retryAfterMs / 1_000),
  };
}

export function resetClientV1RateLimitsForTest(): void {
  buckets.clear();
}

export function clientV1RateLimitSnapshotForTest(): Bucket[] {
  return [...buckets.values()].map((bucket) => ({ ...bucket }));
}

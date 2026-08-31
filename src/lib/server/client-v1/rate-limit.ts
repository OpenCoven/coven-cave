export const CLIENT_V1_RATE_LIMIT_WINDOW_MS = 60_000;
export const CLIENT_V1_PAIRING_CREATE_LIMIT = 10;
export const CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT = 10;
export const CLIENT_V1_AUTHENTICATED_LIMIT = 120;
export const CLIENT_V1_INVALID_BEARER_LIMIT = 120;
export const CLIENT_V1_RATE_LIMIT_MAX_ENTRIES_PER_CATEGORY = 1_024;

export type ClientV1RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export interface ClientV1RateLimiter {
  consumePairingCreate(sourceIdentity: string): ClientV1RateLimitResult;
  consumeAuthenticated(credentialId: string): ClientV1RateLimitResult;
  consumeInvalidBearer(sourceIdentity: string): ClientV1RateLimitResult;
  /**
   * Charge one failed pairing-secret attempt against a single pairing request.
   *
   * Keyed by pairing request id rather than by caller, so a brute-force run
   * against one pairing cannot be widened by reconnecting, and cannot starve
   * any other pairing. Only a *wrong* secret is ever charged: a correct secret
   * — including the repeated polls a client makes while its request is still
   * pending — costs nothing, so legitimate polling is never rate limited.
   *
   * One bucket covers *every* route that compares a pairing secret, which
   * today is the exchange POST and the pairing-request GET (cave-ngro8 renamed
   * it after the poll route began sharing it). A second bucket per comparison
   * site would meter each route while bounding neither, since the cheapest
   * attack is simply to exhaust one oracle and then use the other.
   */
  consumePairingComparisonFailure(pairingRequestId: string): ClientV1RateLimitResult;
  /**
   * Read the failure budget for one pairing request without charging it.
   *
   * A route has to know whether the budget is already exhausted *before* it
   * compares secrets, or the limit would bound nothing. Reading never creates
   * an entry, so probing unknown ids cannot evict the entries that are
   * bounding a real brute-force attempt.
   */
  peekPairingComparisonFailure(pairingRequestId: string): ClientV1RateLimitResult;
}

export interface ClientV1RateLimiterOptions {
  maxEntriesPerCategory?: number;
  now?: () => number;
}

type RateLimitCategory =
  | "authenticated"
  | "invalid-bearer"
  | "pairing-create"
  | "pairing-comparison-failure";

type RateLimitEntry = {
  count: number;
  lastSeenAt: number;
  resetAt: number;
};

const LIMITS: Record<RateLimitCategory, number> = {
  authenticated: CLIENT_V1_AUTHENTICATED_LIMIT,
  "invalid-bearer": CLIENT_V1_INVALID_BEARER_LIMIT,
  "pairing-create": CLIENT_V1_PAIRING_CREATE_LIMIT,
  "pairing-comparison-failure": CLIENT_V1_PAIRING_COMPARISON_FAILURE_LIMIT,
};

function requireNow(now: number): number {
  if (!Number.isFinite(now) || now < 0) {
    throw new RangeError("Client v1 rate-limit clocks must return finite non-negative numbers.");
  }
  return now;
}

function requireIdentity(identity: string): string {
  if (!identity) {
    throw new Error("Client v1 rate-limit identities must be non-empty strings.");
  }
  return identity;
}

export function createClientV1RateLimiter(
  options: ClientV1RateLimiterOptions = {},
): ClientV1RateLimiter {
  const now = options.now ?? Date.now;
  const maxEntries =
    options.maxEntriesPerCategory ?? CLIENT_V1_RATE_LIMIT_MAX_ENTRIES_PER_CATEGORY;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Client v1 rate-limit max entries must be a positive safe integer.");
  }

  const categories: Record<RateLimitCategory, Map<string, RateLimitEntry>> = {
    authenticated: new Map(),
    "invalid-bearer": new Map(),
    "pairing-create": new Map(),
    "pairing-comparison-failure": new Map(),
  };

  function peek(
    category: RateLimitCategory,
    rawIdentity: string,
  ): ClientV1RateLimitResult {
    const currentTime = requireNow(now());
    const identity = requireIdentity(rawIdentity);
    const entries = categories[category];
    const limit = LIMITS[category];

    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }

    // Deliberately does not create an entry: an unrecorded identity has spent
    // nothing, and inserting one here would let an attacker churn the map with
    // identities it never charges, evicting the entries that are bounding a
    // real attempt.
    const entry = entries.get(identity);
    if (!entry) {
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt: currentTime + CLIENT_V1_RATE_LIMIT_WINDOW_MS,
        retryAfterSeconds: 0,
      };
    }
    if (entry.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.resetAt - currentTime) / 1_000),
        ),
      };
    }
    return {
      allowed: true,
      limit,
      remaining: limit - entry.count,
      resetAt: entry.resetAt,
      retryAfterSeconds: 0,
    };
  }

  function consume(
    category: RateLimitCategory,
    rawIdentity: string,
  ): ClientV1RateLimitResult {
    const currentTime = requireNow(now());
    const identity = requireIdentity(rawIdentity);
    const entries = categories[category];
    const limit = LIMITS[category];

    for (const [key, entry] of entries) {
      if (entry.resetAt <= currentTime) entries.delete(key);
    }

    let entry = entries.get(identity);
    if (!entry) {
      while (entries.size >= maxEntries) {
        let oldestKey: string | null = null;
        let oldestSeenAt = Infinity;
        for (const [key, candidate] of entries) {
          if (candidate.lastSeenAt < oldestSeenAt) {
            oldestKey = key;
            oldestSeenAt = candidate.lastSeenAt;
          }
        }
        if (oldestKey === null) break;
        entries.delete(oldestKey);
      }
      entry = {
        count: 0,
        lastSeenAt: currentTime,
        resetAt: currentTime + CLIENT_V1_RATE_LIMIT_WINDOW_MS,
      };
      entries.set(identity, entry);
    }

    entry.lastSeenAt = currentTime;
    if (entry.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.resetAt - currentTime) / 1_000),
        ),
      };
    }

    entry.count += 1;
    return {
      allowed: true,
      limit,
      remaining: limit - entry.count,
      resetAt: entry.resetAt,
      retryAfterSeconds: 0,
    };
  }

  return {
    consumeAuthenticated(credentialId) {
      return consume("authenticated", credentialId);
    },
    consumeInvalidBearer(sourceIdentity) {
      return consume("invalid-bearer", sourceIdentity);
    },
    consumePairingCreate(sourceIdentity) {
      return consume("pairing-create", sourceIdentity);
    },
    consumePairingComparisonFailure(pairingRequestId) {
      return consume("pairing-comparison-failure", pairingRequestId);
    },
    peekPairingComparisonFailure(pairingRequestId) {
      return peek("pairing-comparison-failure", pairingRequestId);
    },
  };
}

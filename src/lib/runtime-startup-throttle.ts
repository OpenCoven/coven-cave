export type RuntimeStartupThrottleDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

/**
 * Bounded process-local crash-loop protection for Cave-owned daemon launches.
 * A successful readiness handshake clears the failure history; a caller can
 * retry after the returned window instead of continuously creating process
 * trees that contend for the same socket.
 */
export class RuntimeStartupThrottle {
  private failures: number[] = [];
  private readonly maxFailures: number;
  private readonly windowMs: number;

  constructor(maxFailures = 3, windowMs = 60_000) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
  }

  allow(now = Date.now()): RuntimeStartupThrottleDecision {
    this.prune(now);
    if (this.failures.length < this.maxFailures) return { allowed: true };
    return { allowed: false, retryAfterMs: Math.max(1, this.failures[0] + this.windowMs - now) };
  }

  recordFailure(now = Date.now()): void {
    this.prune(now);
    this.failures.push(now);
  }

  recordSuccess(): void {
    this.failures = [];
  }

  private prune(now: number): void {
    this.failures = this.failures.filter((failedAt) => now - failedAt < this.windowMs);
  }
}

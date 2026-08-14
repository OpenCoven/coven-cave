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

/**
 * Owns one process-local startup lane. Concurrent callers share the same
 * operation, failures consume the bounded restart budget, and a proven
 * recovery clears it for a later unrelated incident.
 */
export class RuntimeStartupCoordinator<T> {
  private active: Promise<T> | null = null;
  private readonly throttle: RuntimeStartupThrottle;

  constructor(throttle = new RuntimeStartupThrottle()) {
    this.throttle = throttle;
  }

  run(
    operation: () => Promise<T>,
    throttled: (retryAfterMs: number) => T,
    succeeded: (result: T) => boolean,
  ): Promise<T> {
    if (this.active) return this.active;

    const decision = this.throttle.allow();
    if (!decision.allowed) {
      return Promise.resolve().then(() => throttled(decision.retryAfterMs));
    }

    let pending: Promise<T>;
    try {
      pending = operation();
    } catch (error) {
      this.throttle.recordFailure();
      return Promise.reject(error);
    }
    let tracked: Promise<T>;
    tracked = pending.then(
      (result) => {
        if (succeeded(result)) this.throttle.recordSuccess();
        else this.throttle.recordFailure();
        return result;
      },
      (error) => {
        this.throttle.recordFailure();
        throw error;
      },
    ).finally(() => {
      if (this.active === tracked) this.active = null;
    });
    this.active = tracked;
    return tracked;
  }
}

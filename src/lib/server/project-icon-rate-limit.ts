import { normalizeProjectRoot } from "../cave-projects-types.ts";

/**
 * A generated icon is a paid provider call. Keep accidental repeat presses
 * from becoming repeat spend while still allowing a person to regenerate a
 * composition after a short, explicit cooldown.
 */
export const PROJECT_ICON_COOLDOWN_MS = 60_000;

export type ProjectIconRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export type ProjectIconRateLimiter = {
  consume: (root: string) => ProjectIconRateLimitResult;
  reset: () => void;
};

export function createProjectIconRateLimiter({
  now = Date.now,
  cooldownMs = PROJECT_ICON_COOLDOWN_MS,
}: {
  now?: () => number;
  cooldownMs?: number;
} = {}): ProjectIconRateLimiter {
  const nextAllowedAt = new Map<string, number>();

  return {
    consume(root) {
      const key = normalizeProjectRoot(root);
      const current = now();
      const blockedUntil = nextAllowedAt.get(key);

      if (blockedUntil !== undefined && current < blockedUntil) {
        // Clamp the answer to one cooldown. If the wall clock moves backwards,
        // a local NTP correction must not turn a one-minute guard into hours.
        const remainingMs = Math.min(cooldownMs, blockedUntil - current);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
        };
      }

      nextAllowedAt.set(key, current + cooldownMs);
      return { allowed: true };
    },
    reset() {
      nextAllowedAt.clear();
    },
  };
}

/** Process-local budget for the desktop server. */
export const projectIconRateLimiter = createProjectIconRateLimiter();

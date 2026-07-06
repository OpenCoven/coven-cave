import type { SessionRow } from "@/lib/types";

export type PulseDay = { key: string; label: string; count: number };

const DAY_MS = 24 * 60 * 60_000;

/**
 * Bucket a familiar's sessions into per-day counts for the trailing `days`
 * window (oldest first, today last). Days are keyed by UTC date so they match
 * the sessions' ISO `updated_at` timestamps.
 */
export function buildSessionPulse(
  sessions: SessionRow[],
  familiarId: string,
  now: number,
  days = 14,
): PulseDay[] {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (session.familiarId !== familiarId) continue;
    const updated = Date.parse(session.updated_at);
    if (!Number.isFinite(updated)) continue;
    const key = new Date(updated).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, index) => {
    const daysBack = days - 1 - index;
    const day = new Date(now - daysBack * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    return {
      key,
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      count: counts.get(key) ?? 0,
    };
  });
}

export type PulseDelta = { current: number; previous: number; delta: number };

/**
 * Compare the newest half of a pulse window against the half before it —
 * e.g. for a 14-day pulse, this week's sessions vs the prior week's.
 */
export function pulseDelta(pulse: PulseDay[]): PulseDelta {
  const half = Math.floor(pulse.length / 2);
  const previous = pulse.slice(0, half).reduce((sum, day) => sum + day.count, 0);
  const current = pulse.slice(pulse.length - half).reduce((sum, day) => sum + day.count, 0);
  return { current, previous, delta: current - previous };
}

/** Total sessions across the pulse window. */
export function pulseTotal(pulse: PulseDay[]): number {
  return pulse.reduce((sum, day) => sum + day.count, 0);
}

import type { SessionRow } from "@/lib/types";

export type PulseDay = { key: string; label: string; count: number };

const DAY_MS = 24 * 60 * 60_000;
const PULSE_DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});

/**
 * UTC day key (YYYY-MM-DD) for an ISO timestamp — the same bucketing
 * {@link buildSessionPulse} uses, exported so session lists can be filtered
 * to a clicked pulse day. Null for missing/unparseable timestamps.
 */
export function sessionDayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

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
  const window = Array.from({ length: days }, (_, index) => {
    const daysBack = days - 1 - index;
    const day = new Date(now - daysBack * DAY_MS);
    return {
      day,
      key: day.toISOString().slice(0, 10),
    };
  });
  const windowKeys = new Set(window.map((day) => day.key));
  const counts = new Map<string, number>();
  for (const session of sessions) {
    if (session.familiarId !== familiarId) continue;
    const key = sessionDayKey(session.updated_at);
    if (!key || !windowKeys.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return window.map(({ day, key }) => {
    return {
      key,
      label: PULSE_DAY_LABEL.format(day),
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

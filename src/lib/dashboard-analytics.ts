/**
 * Pure derivations for the dashboard cockpit's deeper views. Operates on the
 * data the cockpit already fetches (familiars + session rows) — no extra API
 * calls — and is clock-injected so it unit-tests without a wall clock.
 */

import type { Familiar, SessionRow } from "@/lib/types";
import type { SparkPoint } from "@/components/ui/sparkline";
import type { TrendSeries } from "@/components/ui/charts/trend-chart";

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function sessionDayMs(s: SessionRow): number | null {
  const raw = s.created_at ?? s.updated_at;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/** Count of non-archived sessions per day over the last `days`, oldest-first.
 *  `familiarId === null` counts across all familiars. */
export function sessionsPerDay(
  sessions: SessionRow[],
  familiarId: string | null,
  nowMs: number,
  days = 7,
): number[] {
  const todayStart = startOfDay(nowMs);
  const buckets = new Array(days).fill(0);
  for (const s of sessions) {
    if (s.archived_at) continue;
    if (familiarId !== null && s.familiarId !== familiarId) continue;
    const t = sessionDayMs(s);
    if (t === null) continue;
    const idx = days - 1 - Math.round((todayStart - startOfDay(t)) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx] += 1;
  }
  return buckets;
}

export type FamiliarMiniProfile = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sessionsLast7d: number;
  lastActiveAt: string | null;
  /** 7-point sparkline series (daily session counts), oldest-first. */
  trend: SparkPoint[];
};

/** Per-familiar mini-profile for the Agents panel, derived from sessions. */
export function familiarMiniProfiles(
  familiars: Familiar[],
  sessions: SessionRow[],
  nowMs: number,
  days = 7,
): FamiliarMiniProfile[] {
  const lastByFamiliar = new Map<string, number>();
  for (const s of sessions) {
    if (s.archived_at) continue;
    const t = sessionDayMs(s);
    if (t === null || !s.familiarId) continue;
    lastByFamiliar.set(s.familiarId, Math.max(lastByFamiliar.get(s.familiarId) ?? 0, t));
  }
  return familiars.map((f) => {
    const counts = sessionsPerDay(sessions, f.id, nowMs, days);
    const last = lastByFamiliar.get(f.id);
    return {
      id: f.id,
      name: f.display_name,
      color: f.color || "var(--accent-presence)",
      active: (f.active_sessions ?? 0) > 0,
      sessionsLast7d: counts.reduce((a, b) => a + b, 0),
      lastActiveAt: last ? new Date(last).toISOString() : null,
      trend: counts.map((value, i) => ({ label: `${days - 1 - i}d`, value })),
    };
  });
}

/** Multi-series session-load over time for the top-N busiest familiars (by
 *  total sessions in the window); familiars with zero load are dropped. */
export function familiarLoadSeries(
  familiars: Familiar[],
  sessions: SessionRow[],
  nowMs: number,
  days = 7,
  topN = 4,
): TrendSeries[] {
  return familiars
    .map((f) => {
      const counts = sessionsPerDay(sessions, f.id, nowMs, days);
      const total = counts.reduce((a, b) => a + b, 0);
      return {
        id: f.id,
        label: f.display_name,
        color: f.color || "var(--accent-presence)",
        total,
        points: counts.map((y, x) => ({ x, y })),
      };
    })
    .filter((s) => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, topN)
    .map(({ id, label, color, points }) => ({ id, label, color, points }));
}

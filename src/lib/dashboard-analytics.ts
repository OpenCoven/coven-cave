/**
 * Pure derivations for the dashboard cockpit's deeper views. Operates on the
 * data the cockpit already fetches (familiars + session rows) — no extra API
 * calls — and is clock-injected so it unit-tests without a wall clock.
 */

import type { Familiar, SessionRow } from "@/lib/types";
import type { GitHubItem } from "@/lib/github-tasks";
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

// ─── Predictive signals ──────────────────────────────────────────────────────────

export type DashboardSignal = {
  id: string;
  severity: "warn" | "info";
  text: string;
  /** Where acting on the signal takes you (the stalled PR, the library, the
   *  familiar's analytics). Signals without a destination render as plain rows. */
  href?: string;
  /** True when href leaves the app (opened via the external-URL helper). */
  external?: boolean;
};

const STALE_PR_DAYS = 7;
const READING_QUEUE_LARGE = 8;

/** Cheap, pure, clock-injected "things drifting" detector for the cockpit's
 *  Signals strip. Reads only what the cockpit already fetches — no extra calls.
 *
 *  - PR stalled: an open PR / review request untouched for > 7 days.
 *  - Reading queue large: the reading list has grown past a comfortable size.
 *  - Familiar trending down: had sessions in the prior 4-day window (days 3–7
 *    ago) but none in the last 3 days. */
export function dashboardSignals(input: {
  github: GitHubItem[];
  reading: { status?: string }[];
  sessions: SessionRow[];
  familiars: Familiar[];
  nowMs: number;
}): DashboardSignal[] {
  const { github, reading, sessions, familiars, nowMs } = input;
  const out: DashboardSignal[] = [];

  // PR stalled > 7 days (open PRs / review requests with a stale updatedAt).
  for (const g of github) {
    if (g.kind !== "pr" && g.kind !== "review_request") continue;
    if (g.state === "closed") continue;
    const t = Date.parse(g.updatedAt);
    if (!Number.isFinite(t)) continue;
    const days = Math.floor((nowMs - t) / DAY_MS);
    if (days > STALE_PR_DAYS) {
      out.push({
        id: `pr-stalled-${g.id}`,
        severity: "warn",
        text: `PR stalled ${days}d: ${g.title}`,
        href: g.url,
        external: true,
      });
    }
  }

  // Reading queue grown large.
  if (reading.length > READING_QUEUE_LARGE) {
    out.push({
      id: "reading-large",
      severity: "info",
      text: `Reading queue is large (${reading.length} items)`,
      href: "/?mode=library",
    });
  }

  // Familiar trending down: active in the prior window, quiet in the last 3 days.
  const last3Start = startOfDay(nowMs) - 2 * DAY_MS; // today + previous 2 days
  const priorStart = startOfDay(nowMs) - (STALE_PR_DAYS - 1) * DAY_MS; // 7-day window start
  for (const f of familiars) {
    let recent = 0;
    let prior = 0;
    for (const s of sessions) {
      if (s.archived_at || s.familiarId !== f.id) continue;
      const t = sessionDayMs(s);
      if (t === null) continue;
      const dayStart = startOfDay(t);
      if (dayStart >= last3Start) recent += 1;
      else if (dayStart >= priorStart) prior += 1;
    }
    if (recent === 0 && prior > 0) {
      out.push({
        id: `familiar-down-${f.id}`,
        severity: "warn",
        text: `${f.display_name} is trending down — no sessions in 3 days`,
        href: `/dashboard/familiars/${encodeURIComponent(f.id)}/analytics`,
      });
    }
  }

  // Surface warnings ahead of info.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
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

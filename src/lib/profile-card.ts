/**
 * Profile card model — the pure numbers layer behind the Kaito-style profile
 * cards (cave-ujbr). One familiar (or the human operator) in, one render-ready
 * model out: a trailing-12-month activity heatmap, streaks, busiest day,
 * share-of-coven percentage, weekly + cumulative sparkline series, stat tiles,
 * and a ranked top-collaborators row.
 *
 * No React, no fetch — unit-tested in profile-card.test.ts. All day bucketing
 * is UTC (same rule as session-pulse's sessionDayKey) so counts line up with
 * the sessions' ISO timestamps everywhere activity is displayed.
 */

import { sessionDayKey } from "@/lib/session-pulse";
import type { SessionRow } from "@/lib/types";

export type ProfileKind = "familiar" | "human";

export type ProfileHeatmapCell = {
  /** UTC day key, YYYY-MM-DD. */
  key: string;
  count: number;
  /** 0 = no activity; 1..4 bucketed against the window max. */
  level: 0 | 1 | 2 | 3 | 4;
};

/** One Sun→Sat column; null cells fall outside the 12-month window. */
export type ProfileHeatmapWeek = (ProfileHeatmapCell | null)[];

export type ProfileHeatmapMonthLabel = {
  /** Week-column index the label sits over. */
  index: number;
  /** Uppercase short month, e.g. "JUL". */
  label: string;
};

export type ProfileHeatmap = {
  weeks: ProfileHeatmapWeek[];
  monthLabels: ProfileHeatmapMonthLabel[];
  max: number;
  total: number;
  /** Days in the window with at least one session. */
  activeDays: number;
  /** Days the window spans (windowed to today, inclusive). */
  windowDays: number;
};

export type ProfileSeriesPoint = { label: string; value: number };

export type ProfileStatTile = { label: string; value: string };

export type ProfileCollaborator = { familiarId: string; count: number };

export type ProfileCardModel = {
  kind: ProfileKind;
  /** Sessions attributed to the subject inside the 12-month window. */
  sessionsTotal: number;
  statTiles: ProfileStatTile[];
  heatmap: ProfileHeatmap;
  sessionsPanel: {
    total: number;
    /** Running total per week column — the "up and to the right" line. */
    cumulative: ProfileSeriesPoint[];
    busiestDay: { key: string; count: number } | null;
    /** Subject share of every coven session in the window, 0..100. */
    sharePct: number;
  };
  streakPanel: {
    current: number;
    longest: number;
    /** Sessions per week column. */
    weekly: ProfileSeriesPoint[];
    /** Share of window days with any activity, 0..100. */
    activeDaysPct: number;
  };
  collaborators: ProfileCollaborator[];
};

const DAY_MS = 24 * 60 * 60_000;
const WINDOW_DAYS = 365;
const THIRTY_DAYS_MS = 30 * DAY_MS;
/** Matches familiars-view-stats: a session touched in the last 5 minutes is live. */
const ACTIVE_WINDOW_MS = 5 * 60_000;
const COLLABORATORS_CAP = 12;

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
] as const;

/**
 * Attribution rule for the human card. Machine-spawned rows (`generated`) and
 * rows initiated by a familiar or the system are never the operator's; an
 * explicit human initiator always is. Rows with no attribution (older daemons)
 * default to the operator — someone opened them, and it wasn't a generator.
 */
export function isHumanSession(session: SessionRow): boolean {
  if (session.generated) return false;
  const kind = session.initiator?.kind;
  if (kind === "human") return true;
  if (kind === "familiar" || kind === "system") return false;
  return true;
}

/** Sessions attributed to the card's subject. */
export function subjectSessions(
  sessions: SessionRow[],
  kind: ProfileKind,
  familiarId?: string,
): SessionRow[] {
  if (kind === "human") return sessions.filter(isHumanSession);
  return sessions.filter((session) => session.familiarId === familiarId);
}

function utcDayStartMs(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function dayKeyOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Per-UTC-day counts for rows inside [startMs, endMs]. */
function bucketByDay(sessions: SessionRow[], startMs: number, endMs: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const key = sessionDayKey(session.updated_at);
    if (!key) continue;
    const ms = Date.parse(`${key}T00:00:00.000Z`);
    if (ms < startMs || ms > endMs) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function levelFor(count: number, max: number): ProfileHeatmapCell["level"] {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as ProfileHeatmapCell["level"];
}

/**
 * GitHub-style trailing-12-month grid: Sun-start week columns, today in the
 * final column, cells before the window start (or after today) are null.
 * Month labels sit on the first column whose Sunday enters a new month; a
 * cramped leading label (< 3 columns before the next) is dropped.
 */
export function buildProfileHeatmap(sessions: SessionRow[], now: number): ProfileHeatmap {
  const todayStart = utcDayStartMs(now);
  const windowStart = todayStart - (WINDOW_DAYS - 1) * DAY_MS;
  const gridStart = windowStart - new Date(windowStart).getUTCDay() * DAY_MS;

  const counts = bucketByDay(sessions, windowStart, todayStart);
  let max = 0;
  let total = 0;
  let activeDays = 0;
  for (const count of counts.values()) {
    max = Math.max(max, count);
    total += count;
    if (count > 0) activeDays += 1;
  }

  const weeks: ProfileHeatmapWeek[] = [];
  const monthLabels: ProfileHeatmapMonthLabel[] = [];
  let previousMonth = -1;
  for (let weekStart = gridStart; weekStart <= todayStart; weekStart += 7 * DAY_MS) {
    const week: ProfileHeatmapWeek = [];
    for (let day = 0; day < 7; day += 1) {
      const dayMs = weekStart + day * DAY_MS;
      if (dayMs < windowStart || dayMs > todayStart) {
        week.push(null);
        continue;
      }
      const key = dayKeyOf(dayMs);
      const count = counts.get(key) ?? 0;
      week.push({ key, count, level: levelFor(count, max) });
    }
    const month = new Date(weekStart).getUTCMonth();
    if (month !== previousMonth) {
      monthLabels.push({ index: weeks.length, label: MONTH_LABELS[month] });
      previousMonth = month;
    }
    weeks.push(week);
  }
  if (monthLabels.length > 1 && monthLabels[1].index - monthLabels[0].index < 3) {
    monthLabels.shift();
  }

  return { weeks, monthLabels, max, total, activeDays, windowDays: WINDOW_DAYS };
}

export type ProfileStreaks = { current: number; longest: number };

/**
 * Consecutive-active-day streaks over the heatmap window. The current streak
 * counts back from today; a quiet today defers to yesterday so the streak
 * doesn't blink to zero at midnight before the day's first session.
 */
export function computeStreaks(heatmap: ProfileHeatmap): ProfileStreaks {
  const days: ProfileHeatmapCell[] = [];
  for (const week of heatmap.weeks) {
    for (const cell of week) if (cell) days.push(cell);
  }

  let longest = 0;
  let run = 0;
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }

  let current = 0;
  let index = days.length - 1;
  if (index >= 0 && days[index].count === 0) index -= 1;
  for (; index >= 0 && days[index].count > 0; index -= 1) current += 1;

  return { current, longest };
}

/** Highest-count day in the window; ties go to the most recent day. */
export function busiestDay(heatmap: ProfileHeatmap): { key: string; count: number } | null {
  let best: { key: string; count: number } | null = null;
  for (const week of heatmap.weeks) {
    for (const cell of week) {
      if (!cell || cell.count === 0) continue;
      if (!best || cell.count >= best.count) best = { key: cell.key, count: cell.count };
    }
  }
  return best;
}

/** Sessions per week column, labeled by the column's first in-window day. */
export function weeklySeries(heatmap: ProfileHeatmap): ProfileSeriesPoint[] {
  return heatmap.weeks.map((week) => {
    const first = week.find((cell): cell is ProfileHeatmapCell => cell !== null);
    const value = week.reduce((sum, cell) => sum + (cell?.count ?? 0), 0);
    return { label: first?.key ?? "", value };
  });
}

/** Running total across the weekly series. */
export function cumulativeSeries(weekly: ProfileSeriesPoint[]): ProfileSeriesPoint[] {
  let total = 0;
  return weekly.map((point) => {
    total += point.value;
    return { label: point.label, value: total };
  });
}

/**
 * Top-collaborator ranking. The human's card ranks familiars by their session
 * counts (the roster the operator works with most). A familiar's card ranks
 * the OTHER familiars by how many of their sessions ran in project roots the
 * subject also worked in — shared ground, not raw activity.
 */
export function rankCollaborators(args: {
  kind: ProfileKind;
  familiarId?: string;
  sessions: SessionRow[];
  familiarIds: string[];
}): ProfileCollaborator[] {
  const counts = new Map<string, number>();
  const known = new Set(args.familiarIds);

  if (args.kind === "human") {
    for (const session of args.sessions) {
      const fid = session.familiarId;
      if (!fid || !known.has(fid)) continue;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
  } else {
    const subjectRoots = new Set<string>();
    for (const session of args.sessions) {
      if (session.familiarId === args.familiarId && session.project_root) {
        subjectRoots.add(session.project_root);
      }
    }
    for (const session of args.sessions) {
      const fid = session.familiarId;
      if (!fid || fid === args.familiarId || !known.has(fid)) continue;
      if (!session.project_root || !subjectRoots.has(session.project_root)) continue;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([familiarId, count]) => ({ familiarId, count }))
    .sort((a, b) => b.count - a.count || a.familiarId.localeCompare(b.familiarId))
    .slice(0, COLLABORATORS_CAP);
}

/** "@handle" slug for the human card: lowercase, dash-joined, or "operator". */
export function humanHandle(name: string | null | undefined): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "operator";
}

/** Compact display for tiles: 42_500 → "42.5K", 1_700_000 → "1.7M". */
export function compactCount(value: number): string {
  if (value >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimZero(value / 1_000)}K`;
  return String(value);
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export type ProfileCardInput = {
  kind: ProfileKind;
  /** Required when kind === "familiar". */
  familiarId?: string;
  /** Every coven session (the share denominator + collaborator source). */
  sessions: SessionRow[];
  familiarIds: string[];
  /** Coven memory entries for the subject familiar; ignored for the human. */
  memoryCount?: number;
  /** Distinct familiars roster size; shown on the human card. */
  familiarCount?: number;
  now?: number;
};

export function buildProfileCardModel(input: ProfileCardInput): ProfileCardModel {
  const now = input.now ?? Date.now();
  const todayStart = utcDayStartMs(now);
  const windowStart = todayStart - (WINDOW_DAYS - 1) * DAY_MS;

  const inWindow = (session: SessionRow): boolean => {
    const key = sessionDayKey(session.updated_at);
    if (!key) return false;
    const ms = Date.parse(`${key}T00:00:00.000Z`);
    return ms >= windowStart && ms <= todayStart;
  };

  const allWindowed = input.sessions.filter(inWindow);
  const subject = subjectSessions(allWindowed, input.kind, input.familiarId);

  const heatmap = buildProfileHeatmap(subject, now);
  const streaks = computeStreaks(heatmap);
  const weekly = weeklySeries(heatmap);
  const cumulative = cumulativeSeries(weekly);

  const thirtyCutoff = now - THIRTY_DAYS_MS;
  const activeCutoff = now - ACTIVE_WINDOW_MS;
  let last30d = 0;
  let activeNow = 0;
  for (const session of subject) {
    const ms = Date.parse(session.updated_at);
    if (!Number.isFinite(ms)) continue;
    if (ms > thirtyCutoff) last30d += 1;
    if (ms > activeCutoff && !session.archived_at) activeNow += 1;
  }

  const statTiles: ProfileStatTile[] =
    input.kind === "human"
      ? [
          { label: "total sessions", value: compactCount(subject.length) },
          { label: "sessions (30d)", value: compactCount(last30d) },
          { label: "familiars", value: compactCount(input.familiarCount ?? input.familiarIds.length) },
          // Operator-initiated rows are Cave conversations without a
          // project_root, so count the coven's projects — the workspaces the
          // operator runs — rather than rendering a permanent 0.
          { label: "projects", value: compactCount(new Set(allWindowed.map((s) => s.project_root).filter(Boolean)).size) },
        ]
      : [
          { label: "total sessions", value: compactCount(subject.length) },
          { label: "sessions (30d)", value: compactCount(last30d) },
          { label: "memories", value: compactCount(input.memoryCount ?? 0) },
          { label: "active now", value: compactCount(activeNow) },
        ];

  return {
    kind: input.kind,
    sessionsTotal: subject.length,
    statTiles,
    heatmap,
    sessionsPanel: {
      total: subject.length,
      cumulative,
      busiestDay: busiestDay(heatmap),
      sharePct: pct(subject.length, allWindowed.length),
    },
    streakPanel: {
      current: streaks.current,
      longest: streaks.longest,
      weekly,
      activeDaysPct: pct(heatmap.activeDays, heatmap.windowDays),
    },
    collaborators: rankCollaborators({
      kind: input.kind,
      familiarId: input.familiarId,
      sessions: allWindowed,
      familiarIds: input.familiarIds,
    }),
  };
}

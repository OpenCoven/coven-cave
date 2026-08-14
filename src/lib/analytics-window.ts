import { sessionDayKey, type PulseDay } from "@/lib/session-pulse";
import type { SessionRow } from "@/lib/types";

/** Time-window contract shared by the analytics scope controls and evidence reads. */
export type WindowId = "7d" | "14d" | "8w" | "all";

export const DEFAULT_WINDOW: WindowId = "8w";

export const ANALYTICS_WINDOWS: {
  id: WindowId;
  label: string;
  title: string;
  /** null = everything on record. */
  days: number | null;
}[] = [
  { id: "7d", label: "7D", title: "Last 7 days", days: 7 },
  { id: "14d", label: "14D", title: "Last 14 days", days: 14 },
  { id: "8w", label: "8W", title: "Last 8 weeks", days: 56 },
  { id: "all", label: "ALL", title: "Everything on record", days: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScopedActivityCadence = {
  activeNow: boolean;
  busiest: PulseDay | null;
  lastActive: string | null;
  perWeek: number;
};

/**
 * Derive the Activity card's breakdown from the same window-scoped sessions
 * as its headline count. The fixed windows use their exact span; ALL measures
 * the observed history through the current read, rather than a hidden 14-day
 * pulse subset.
 */
export function deriveScopedActivityCadence(
  sessions: readonly SessionRow[],
  now: number,
  days: number | null,
): ScopedActivityCadence {
  const stamped = sessions
    .map((session) => ({ session, ms: Date.parse(session.updated_at) }))
    .filter((entry) => Number.isFinite(entry.ms) && entry.ms <= now)
    .sort((a, b) => b.ms - a.ms);
  const counts = new Map<string, PulseDay>();
  for (const { session } of stamped) {
    const key = sessionDayKey(session.updated_at);
    if (!key) continue;
    const existing = counts.get(key);
    counts.set(key, existing
      ? { ...existing, count: existing.count + 1 }
      : {
          key,
          label: new Date(session.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          count: 1,
        });
  }
  const busiest = [...counts.values()].reduce<PulseDay | null>(
    (best, day) => best === null || day.count > best.count ? day : best,
    null,
  );
  const oldest = stamped.at(-1)?.ms;
  const spanDays = days ?? (oldest === undefined ? 0 : Math.max(1, Math.ceil((now - oldest) / DAY_MS)));

  return {
    activeNow: (stamped[0]?.ms ?? -Infinity) >= now - 2 * DAY_MS,
    busiest,
    lastActive: stamped[0]?.session.updated_at ?? null,
    perWeek: spanDays > 0 ? Math.round((stamped.length / spanDays) * 7) : 0,
  };
}

/** True when `iso` falls inside the window ending now. Unparseable timestamps
 * are kept rather than dropped — a missing stamp is not evidence of age. */
export function withinWindow(iso: string | null | undefined, windowId: WindowId, now: number): boolean {
  const spec = ANALYTICS_WINDOWS.find((entry) => entry.id === windowId);
  if (!iso) return true;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return true;
  if (ms > now) return false;
  return !spec || spec.days === null || now - ms <= spec.days * DAY_MS;
}

import { ritualStreak } from "@/lib/familiar-renown";
import type { CanonicalMemorySummary } from "@/lib/canonical-memory";
import type { Familiar, SessionRow } from "@/lib/types";

export type CanonicalMemoryAvailability = "ready" | "unavailable";

export type FamiliarCardStats = {
  memoryCount: number;
  memoryAvailability: CanonicalMemoryAvailability;
  latestMemory: { title: string; updatedAt: string } | null;
  lastSessionAt: string | null;
  /** Every non-archived session attributed to the familiar. */
  sessionsTotal: number;
  sessionsLast7d: number;
  hasActiveSession: boolean;
  /**
   * Ritual streak — consecutive UTC days with at least one session, ending
   * today (one-day grace while today is still young). 0 when broken; the
   * card renders that as an em dash, never as a reprimand.
   */
  streakDays: number;
  /**
   * Sessions per UTC day for the roster card's mini activity strip —
   * ACTIVITY_DAYS entries, oldest first, today last. Same UTC day bucketing
   * as the profile-card heatmap so both surfaces agree.
   */
  activity: number[];
};

const DAY_MS = 24 * 60 * 60_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const FIVE_MINUTES_MS = 5 * 60_000;
/** Days shown by the roster card activity strip. */
export const ACTIVITY_DAYS = 14;

function sessionStartAt(session: SessionRow): string | null {
  return session.created_at ?? session.updated_at ?? null;
}

export function buildFamiliarCardStats(args: {
  familiars: Familiar[];
  sessions: SessionRow[];
  covenEntries: CanonicalMemorySummary[];
  memoryAvailability: CanonicalMemoryAvailability;
  now?: number;
}): Map<string, FamiliarCardStats> {
  const now = args.now ?? Date.now();
  const sevenCutoff = now - SEVEN_DAYS_MS;
  const activeCutoff = now - FIVE_MINUTES_MS;
  const todayIndex = Math.floor(now / DAY_MS);

  const sessionsByFamiliar = new Map<string, SessionRow[]>();
  for (const session of args.sessions) {
    if (session.archived_at) continue;
    const fid = session.familiarId;
    if (!fid) continue;
    const bucket = sessionsByFamiliar.get(fid) ?? [];
    bucket.push(session);
    sessionsByFamiliar.set(fid, bucket);
  }

  const memoriesByFamiliar = new Map<string, CanonicalMemorySummary[]>();
  for (const entry of args.covenEntries) {
    const bucket = memoriesByFamiliar.get(entry.familiarId) ?? [];
    bucket.push(entry);
    memoriesByFamiliar.set(entry.familiarId, bucket);
  }

  const result = new Map<string, FamiliarCardStats>();
  for (const familiar of args.familiars) {
    const sessions = sessionsByFamiliar.get(familiar.id) ?? [];
    const memories = memoriesByFamiliar.get(familiar.id) ?? [];

    let lastSessionAt: string | null = null;
    let lastSessionMs = -Infinity;
    let sessionsLast7d = 0;
    let hasActiveSession = false;
    const activity = new Array<number>(ACTIVITY_DAYS).fill(0);
    const activeDays = new Set<number>();
    for (const session of sessions) {
      const startedAt = sessionStartAt(session);
      if (!startedAt) continue;
      const ms = Date.parse(startedAt);
      if (!Number.isFinite(ms)) continue;
      if (ms > lastSessionMs) {
        lastSessionMs = ms;
        lastSessionAt = startedAt;
      }
      if (ms > sevenCutoff) sessionsLast7d += 1;
      if (ms > activeCutoff) hasActiveSession = true;
      const dayIndex = Math.floor(ms / DAY_MS);
      activeDays.add(dayIndex);
      const daysAgo = todayIndex - dayIndex;
      if (daysAgo >= 0 && daysAgo < ACTIVITY_DAYS) {
        activity[ACTIVITY_DAYS - 1 - daysAgo] += 1;
      }
    }

    let latestMemory: FamiliarCardStats["latestMemory"] = null;
    let latestMs = -Infinity;
    for (const entry of memories) {
      const ms = Date.parse(entry.updatedAt);
      if (!Number.isFinite(ms)) continue;
      if (ms > latestMs) {
        latestMs = ms;
        latestMemory = { title: entry.title, updatedAt: entry.updatedAt };
      }
    }

    result.set(familiar.id, {
      memoryCount: memories.length,
      memoryAvailability: args.memoryAvailability,
      latestMemory,
      lastSessionAt,
      sessionsTotal: sessions.length,
      sessionsLast7d,
      hasActiveSession,
      streakDays: ritualStreak(activeDays, todayIndex),
      activity,
    });
  }
  return result;
}

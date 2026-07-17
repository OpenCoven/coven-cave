import type { SessionRow } from "@/lib/types";

/**
 * Renown & ritual streaks — the progression vocabulary for familiars.
 *
 * Every number here derives from real recorded work (sessions run, memories
 * curated); nothing is a synthetic counter. Tiers celebrate accumulation and
 * never regress punitively: a quiet week can end a streak, but the copy never
 * shames the gap — a streak of 0 simply isn't shown.
 *
 * Day bucketing matches the roster activity strip (UTC day index of the
 * session's start timestamp — see buildFamiliarCardStats) so the streak a
 * card reports always agrees with the heatmap next to it.
 */

const DAY_MS = 24 * 60 * 60_000;

// ── Ritual streaks ──────────────────────────────────────────────────────────

/**
 * Consecutive active days ending today — with a one-day grace, because today
 * isn't over: a streak that ran through yesterday still counts until tonight.
 * `dayIndices` are UTC day numbers (floor(ms / DAY_MS)); duplicates are fine.
 */
export function ritualStreak(dayIndices: Iterable<number>, todayIndex: number): number {
  const days = dayIndices instanceof Set ? (dayIndices as Set<number>) : new Set(dayIndices);
  let cursor = days.has(todayIndex) ? todayIndex : days.has(todayIndex - 1) ? todayIndex - 1 : null;
  if (cursor === null) return 0;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

function sessionStartMs(session: SessionRow): number | null {
  const iso = session.created_at ?? session.updated_at ?? null;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Active-day indices for one familiar's non-archived sessions. */
export function familiarActiveDays(sessions: SessionRow[], familiarId: string): Set<number> {
  const days = new Set<number>();
  for (const session of sessions) {
    if (session.archived_at || session.familiarId !== familiarId) continue;
    const ms = sessionStartMs(session);
    if (ms !== null) days.add(Math.floor(ms / DAY_MS));
  }
  return days;
}

/** Per-familiar ritual streak in days (0 when the streak is broken). */
export function familiarStreak(sessions: SessionRow[], familiarId: string, now: number): number {
  return ritualStreak(familiarActiveDays(sessions, familiarId), Math.floor(now / DAY_MS));
}

/** Coven-wide streak: consecutive days on which any familiar ran a session. */
export function covenStreak(sessions: SessionRow[], now: number): number {
  const days = new Set<number>();
  for (const session of sessions) {
    if (session.archived_at || !session.familiarId) continue;
    const ms = sessionStartMs(session);
    if (ms !== null) days.add(Math.floor(ms / DAY_MS));
  }
  return ritualStreak(days, Math.floor(now / DAY_MS));
}

// ── Renown tiers ────────────────────────────────────────────────────────────

export type RenownTierKey = "kindling" | "adept" | "magus" | "archon" | "luminary";

export type RenownTier = {
  key: RenownTierKey;
  /** Lowercase on purpose — the roster microlabel voice. */
  label: string;
  /** Minimum renown score for the tier. */
  min: number;
};

/**
 * The ladder a familiar climbs. Thresholds are tuned so the first step lands
 * within a familiar's first working week (early acknowledgement) while the
 * top remains a long arc. "warden" was deliberately skipped — it collides
 * with ward.toml, the guardrail file.
 */
export const RENOWN_TIERS: readonly RenownTier[] = [
  { key: "kindling", label: "kindling", min: 0 },
  { key: "adept", label: "adept", min: 10 },
  { key: "magus", label: "magus", min: 50 },
  { key: "archon", label: "archon", min: 150 },
  { key: "luminary", label: "luminary", min: 400 },
];

export type RenownInput = {
  /** Non-archived sessions attributed to the familiar. */
  sessionsTotal: number;
  /** Curated coven-memory entries. */
  memoryCount: number;
};

/**
 * The renown score. Memories weigh 3× a session: curation is rarer than
 * running, and the ladder should reward tending the grimoire, not just
 * volume.
 */
export function renownScore(input: RenownInput): number {
  return Math.max(0, input.sessionsTotal) + 3 * Math.max(0, input.memoryCount);
}

export type FamiliarRenown = {
  score: number;
  tier: RenownTier;
  /** Next rung, with how much work remains — null at the top of the ladder. */
  next: { tier: RenownTier; remaining: number } | null;
  /** 0..1 progress from the current tier floor toward the next. 1 at the top. */
  progress: number;
};

export function deriveRenown(input: RenownInput): FamiliarRenown {
  const score = renownScore(input);
  let tier = RENOWN_TIERS[0];
  let next: RenownTier | null = null;
  for (let i = RENOWN_TIERS.length - 1; i >= 0; i -= 1) {
    if (score >= RENOWN_TIERS[i].min) {
      tier = RENOWN_TIERS[i];
      next = RENOWN_TIERS[i + 1] ?? null;
      break;
    }
  }
  if (!next) return { score, tier, next: null, progress: 1 };
  const span = next.min - tier.min;
  return {
    score,
    tier,
    next: { tier: next, remaining: next.min - score },
    progress: span > 0 ? Math.min(1, Math.max(0, (score - tier.min) / span)) : 1,
  };
}

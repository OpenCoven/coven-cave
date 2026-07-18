// Milestone catalog + pure due-detection. No node: imports — the client
// watcher (use-milestone-watch.ts) computes due milestones from data it
// already holds; the server route only validates, dedupes against the
// ledger, and emits inbox items. Every milestone derives from real recorded
// work; none of these are synthetic counters.
//
// Voice: milestones are brand moments, so each carries one flourish — but the
// copy celebrates presence and never shames absence (no "you lost your
// streak" items exist, by design).

import type { RenownTierKey } from "@/lib/familiar-renown";

export type MilestoneAward = {
  /** Stable ledger key — awarded at most once, ever. */
  key: string;
  title: string;
  body: string;
  familiarId?: string | null;
};

export type CovenCounts = {
  familiarCount: number;
  /** Non-archived sessions across the whole coven. */
  sessionsTotal: number;
  /** Consecutive active days (covenStreak). */
  covenStreakDays: number;
};

type CovenMilestoneDef = {
  key: string;
  title: string;
  body: string;
  due: (counts: CovenCounts) => boolean;
};

const COVEN_MILESTONES: readonly CovenMilestoneDef[] = [
  {
    key: "summon:first",
    title: "First summoning",
    body: "A familiar answered the call. The coven begins.",
    due: (c) => c.familiarCount >= 1,
  },
  {
    key: "streak:7",
    title: "Seven-day ritual",
    body: "Sessions on seven consecutive days. The rhythm holds.",
    due: (c) => c.covenStreakDays >= 7,
  },
  {
    key: "streak:30",
    title: "Thirty-day ritual",
    body: "A full moon of daily practice.",
    due: (c) => c.covenStreakDays >= 30,
  },
  {
    key: "sessions:100",
    title: "One hundred sessions",
    body: "The coven's hundredth working is in the books.",
    due: (c) => c.sessionsTotal >= 100,
  },
  {
    key: "sessions:1000",
    title: "One thousand sessions",
    body: "A thousand workings. Few covens get here.",
    due: (c) => c.sessionsTotal >= 1000,
  },
];

/** Coven-wide milestones now due and not yet in the ledger. */
export function dueCovenMilestones(
  counts: CovenCounts,
  awarded: ReadonlySet<string>,
): MilestoneAward[] {
  return COVEN_MILESTONES.filter((m) => !awarded.has(m.key) && m.due(counts)).map(
    ({ key, title, body }) => ({ key, title, body }),
  );
}

export type TierAscension = {
  familiarId: string;
  displayName: string;
  tierKey: RenownTierKey;
  tierLabel: string;
};

/** Ledger key for a familiar reaching a renown tier. */
export function tierMilestoneKey(familiarId: string, tierKey: RenownTierKey): string {
  return `tier:${familiarId}:${tierKey}`;
}

/**
 * Tier ascensions not yet awarded. "kindling" is the floor everyone starts
 * on — arriving is not an ascension, so it never fires.
 */
export function dueTierMilestones(
  rows: TierAscension[],
  awarded: ReadonlySet<string>,
): MilestoneAward[] {
  return rows
    .filter((r) => r.tierKey !== "kindling" && !awarded.has(tierMilestoneKey(r.familiarId, r.tierKey)))
    .map((r) => ({
      key: tierMilestoneKey(r.familiarId, r.tierKey),
      title: `${r.displayName} ascends to ${r.tierLabel}`,
      body: "Renown earned through sessions run and memories kept.",
      familiarId: r.familiarId,
    }));
}

/** Server-side shape guard for POSTed awards. */
export const MILESTONE_KEY_RE = /^[a-z0-9][a-z0-9:_-]{2,79}$/;

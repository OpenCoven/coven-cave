// Mission catalog + pure progress derivation. Missions are the *forward*
// half of progression: milestones (milestone-defs.ts) acknowledge what already
// happened, while a mission states an objective you can still go and do, and
// pays bonus renown when you do it.
//
// Everything here is pure and node:-free — the client watcher
// (use-milestone-watch.ts) computes progress from data it already holds, and
// completions ride the existing renown ledger (`mission:` keys satisfy
// MILESTONE_KEY_RE), so a mission fires at most once and needs no new server
// surface.
//
// Voice: same contract as milestones — objectives invite, they never shame.
// There is no failure state and no expiry, so an untouched mission simply
// waits. Every signal derives from real recorded work; none is a synthetic
// counter.

import type { MilestoneAward } from "@/lib/milestone-defs";

/** Ledger namespace for mission completions. */
export const MISSION_KEY_PREFIX = "mission:";

export type MissionCategory = "coven" | "practice" | "memory";

/**
 * Coven-wide signals a mission can be measured against. Each one is already
 * computed by the milestone watcher from the roster, the session list, and the
 * canonical-memory counts.
 */
export type MissionSignals = {
  familiarCount: number;
  /** Non-archived sessions across the whole coven. */
  sessionsTotal: number;
  /** Consecutive active days (covenStreak). */
  covenStreakDays: number;
  /** Curated coven-memory entries across every familiar. */
  memoryTotal: number;
  /** Familiars with at least one non-archived session. */
  familiarsWithSession: number;
  /** Familiars with at least one curated memory entry. */
  familiarsWithMemory: number;
};

type MissionDef = {
  /** Stable ledger key, always `mission:`-prefixed. Paid out at most once. */
  key: string;
  title: string;
  /** Imperative statement of the objective — what to actually go and do. */
  objective: string;
  /** Completion copy, used as the inbox body when the mission pays out. */
  reward: string;
  category: MissionCategory;
  /** Bonus renown granted on completion. */
  bonus: number;
  /** Count required to complete. */
  target: number;
  /** Current count for these signals, clamped by the caller. */
  measure: (signals: MissionSignals) => number;
};

/**
 * The catalog. Targets sit deliberately in the gaps the milestone ladder
 * leaves open (milestones fire at 7/30 streak days and 100/1000 sessions), so
 * a mission is always the nearer, reachable thing. Bonus values scale with
 * effort, and curation pays more than volume — the same bias renownScore
 * already encodes.
 */
const MISSIONS: readonly MissionDef[] = [
  {
    key: "mission:coven:circle-of-three",
    title: "Circle of three",
    objective: "Summon three familiars.",
    reward: "Three familiars answer. A circle holds what a single voice cannot.",
    category: "coven",
    bonus: 5,
    target: 3,
    measure: (s) => s.familiarCount,
  },
  {
    key: "mission:practice:ten-workings",
    title: "Ten workings",
    objective: "Run ten sessions across the coven.",
    reward: "Ten sessions on the books. The practice is real now.",
    category: "practice",
    bonus: 10,
    target: 10,
    measure: (s) => s.sessionsTotal,
  },
  {
    key: "mission:practice:fifty-workings",
    title: "Fifty workings",
    objective: "Run fifty sessions across the coven.",
    reward: "Fifty sessions. Halfway to the hundredth working.",
    category: "practice",
    bonus: 25,
    target: 50,
    measure: (s) => s.sessionsTotal,
  },
  {
    key: "mission:practice:three-day-rhythm",
    title: "Three-day rhythm",
    objective: "Run a session on three consecutive days.",
    reward: "Three days running. A rhythm starts here.",
    category: "practice",
    bonus: 10,
    target: 3,
    measure: (s) => s.covenStreakDays,
  },
  {
    key: "mission:practice:fortnight-rhythm",
    title: "Fortnight rhythm",
    objective: "Run a session on fourteen consecutive days.",
    reward: "Fourteen days unbroken. Between the weekly rite and the full moon.",
    category: "practice",
    bonus: 30,
    target: 14,
    measure: (s) => s.covenStreakDays,
  },
  {
    key: "mission:memory:first-keeping",
    title: "First keeping",
    objective: "Curate one entry into coven memory.",
    reward: "The first memory is kept. The grimoire has a first page.",
    category: "memory",
    bonus: 5,
    target: 1,
    measure: (s) => s.memoryTotal,
  },
  {
    key: "mission:memory:tend-the-grimoire",
    title: "Tend the grimoire",
    objective: "Curate ten entries into coven memory.",
    reward: "Ten entries kept. Curation is rarer than running, and it shows.",
    category: "memory",
    bonus: 20,
    target: 10,
    measure: (s) => s.memoryTotal,
  },
  {
    key: "mission:coven:full-roster-at-work",
    title: "Full roster at work",
    objective: "Give every familiar in the coven at least one session.",
    reward: "Every familiar has run a working. Nobody is standing idle.",
    category: "coven",
    bonus: 20,
    // Satisfied only when the whole roster has worked, and never by an empty
    // or single-familiar coven — "everyone" has to mean something.
    target: 1,
    measure: (s) =>
      s.familiarCount >= 2 && s.familiarsWithSession >= s.familiarCount ? 1 : 0,
  },
  {
    key: "mission:coven:every-familiar-remembers",
    title: "Every familiar remembers",
    objective: "Give every familiar in the coven at least one curated memory.",
    reward: "Every familiar carries something forward. The coven has continuity.",
    category: "coven",
    bonus: 30,
    target: 1,
    measure: (s) =>
      s.familiarCount >= 2 && s.familiarsWithMemory >= s.familiarCount ? 1 : 0,
  },
];

/**
 * Assemble mission signals from the pieces the milestone watcher already
 * holds. `memoryCounts` is null when canonical memory is unavailable; that
 * reads as zero curated entries, which can only ever delay a payout, never
 * trigger one early.
 */
export function missionSignals(
  familiarIds: readonly string[],
  sessionsByFamiliar: ReadonlyMap<string, number>,
  memoryCounts: ReadonlyMap<string, number> | null,
  covenStreakDays: number,
  sessionsTotal: number,
): MissionSignals {
  let familiarsWithSession = 0;
  let familiarsWithMemory = 0;
  let memoryTotal = 0;
  for (const id of familiarIds) {
    if ((sessionsByFamiliar.get(id) ?? 0) > 0) familiarsWithSession += 1;
    const memories = memoryCounts?.get(id) ?? 0;
    if (memories > 0) familiarsWithMemory += 1;
    memoryTotal += memories;
  }
  return {
    familiarCount: familiarIds.length,
    sessionsTotal,
    covenStreakDays,
    memoryTotal,
    familiarsWithSession,
    familiarsWithMemory,
  };
}

export type MissionProgress = {
  key: string;
  title: string;
  objective: string;
  category: MissionCategory;
  bonus: number;
  /** Clamped to `target` — progress never reads past complete. */
  current: number;
  target: number;
  /** 0..1 for a progress bar. 1 when complete. */
  fraction: number;
  /** True once the completion has been recorded in the ledger. */
  complete: boolean;
  /** Met the objective but not yet paid out — a payout is one check away. */
  earned: boolean;
};

function progressFor(
  def: MissionDef,
  signals: MissionSignals,
  awarded: ReadonlySet<string>,
): MissionProgress {
  const raw = Math.max(0, Math.floor(def.measure(signals)));
  const current = Math.min(raw, def.target);
  const earned = raw >= def.target;
  return {
    key: def.key,
    title: def.title,
    objective: def.objective,
    category: def.category,
    bonus: def.bonus,
    current,
    target: def.target,
    fraction: def.target > 0 ? current / def.target : 1,
    complete: awarded.has(def.key),
    earned,
  };
}

/**
 * The whole board, ordered the way it should be read: open missions first and
 * nearest-to-done at the top (that is the one worth doing next), completed
 * ones last as a record. Ties break on the catalog's own order so the board
 * never reshuffles under equal progress.
 */
export function deriveMissions(
  signals: MissionSignals,
  awarded: ReadonlySet<string>,
): MissionProgress[] {
  const rows = MISSIONS.map((def, index) => ({ row: progressFor(def, signals, awarded), index }));
  rows.sort((a, b) => {
    if (a.row.complete !== b.row.complete) return a.row.complete ? 1 : -1;
    if (!a.row.complete && a.row.fraction !== b.row.fraction) return b.row.fraction - a.row.fraction;
    return a.index - b.index;
  });
  return rows.map((r) => r.row);
}

/** Missions whose objective is met and which are not yet in the ledger. */
export function dueMissionAwards(
  signals: MissionSignals,
  awarded: ReadonlySet<string>,
): MilestoneAward[] {
  return MISSIONS.filter((def) => !awarded.has(def.key) && def.measure(signals) >= def.target).map(
    (def) => ({
      key: def.key,
      title: `Mission complete — ${def.title}`,
      body: `${def.reward} +${def.bonus} renown.`,
    }),
  );
}

/**
 * Bonus renown earned from completed missions. Reads the same ledger keys the
 * awards were written under, so the total is derived, never separately stored,
 * and an unknown key (a mission retired from the catalog) contributes nothing
 * rather than throwing off the sum.
 */
export function missionBonusPoints(awarded: Iterable<string>): number {
  const byKey = new Map(MISSIONS.map((def) => [def.key, def.bonus]));
  let total = 0;
  for (const key of awarded) total += byKey.get(key) ?? 0;
  return total;
}

/** Total bonus on offer across the catalog — the ceiling for a progress readout. */
export function missionBonusCeiling(): number {
  return MISSIONS.reduce((sum, def) => sum + def.bonus, 0);
}

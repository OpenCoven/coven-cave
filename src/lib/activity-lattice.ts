// Three time views of one familiar's session activity, derived together so
// they can be read side by side.
//
// The analytics surface already had a 14-day pulse, but behind an overlay —
// one view at a time. The design this implements makes the point that paging
// between the year, the quarter and the fortnight is the problem: you cannot
// compare a quiet fortnight against its own year if only one is on screen. So
// all three are built from a single pass and rendered in one lattice.
//
// Pure and unit-tested; the rendering lives in familiar-activity-lattice.tsx.

import { buildSessionPulse, type PulseDay } from "@/lib/session-pulse";
import type { SessionRow } from "@/lib/types";

/** One day cell — the same shape the existing pulse uses. */
export type LatticeDay = PulseDay;

/** Seven consecutive days, oldest first. */
export type LatticeWeek = {
  /** Day key of the week's first day — stable for React keys. */
  key: string;
  days: LatticeDay[];
  total: number;
};

export type ActivityLattice = {
  /** 52 weeks (364 days), oldest first — the year at a glance. */
  year: LatticeWeek[];
  /** The trailing 8 weekly totals, oldest first — the quarter. */
  quarter: LatticeWeek[];
  /** The trailing 14 daily counts, oldest first — the fortnight. */
  fortnight: LatticeDay[];
  /** Busiest single day in the year window; 0 when nothing happened. Density
   *  shades scale against this so a quiet familiar's chart still reads. */
  peak: number;
  /** Every session counted in the year window. */
  total: number;
};

/** Weeks shown in the year grid. 52 × 7 = 364 days. */
export const LATTICE_WEEKS = 52;
/** Weeks shown in the quarter trend. */
export const QUARTER_WEEKS = 8;
/** Days shown in the fortnight pulse — matches the existing pulse window. */
export const FORTNIGHT_DAYS = 14;
const DAYS_PER_WEEK = 7;

/** Shade steps for the density grid, 0 (empty) through 4 (busiest). */
export const DENSITY_STEPS = 4;

/**
 * Bucket a day count into a 0–4 density step, scaled against the window's
 * peak. Any non-zero day is at least step 1, so a single session is never
 * indistinguishable from silence — the thing a density grid exists to show.
 */
export function densityStep(count: number, peak: number): number {
  if (count <= 0) return 0;
  if (peak <= 0) return 0;
  const scaled = Math.ceil((count / peak) * DENSITY_STEPS);
  return Math.min(DENSITY_STEPS, Math.max(1, scaled));
}

function chunkIntoWeeks(days: LatticeDay[]): LatticeWeek[] {
  const weeks: LatticeWeek[] = [];
  for (let index = 0; index < days.length; index += DAYS_PER_WEEK) {
    const slice = days.slice(index, index + DAYS_PER_WEEK);
    if (slice.length === 0) continue;
    weeks.push({
      key: slice[0].key,
      days: slice,
      total: slice.reduce((sum, day) => sum + day.count, 0),
    });
  }
  return weeks;
}

/**
 * Build all three time views from one 364-day pass over the sessions.
 *
 * Deriving the quarter and the fortnight from the same day series as the year
 * — rather than bucketing three times — is what makes them comparable: a day
 * carries the same count in all three views by construction, so the fortnight
 * can never disagree with the year that contains it.
 */
export function buildActivityLattice(
  sessions: SessionRow[],
  familiarId: string,
  now: number,
): ActivityLattice {
  const days = buildSessionPulse(sessions, familiarId, now, LATTICE_WEEKS * DAYS_PER_WEEK);
  const year = chunkIntoWeeks(days);
  return {
    year,
    quarter: year.slice(-QUARTER_WEEKS),
    fortnight: days.slice(-FORTNIGHT_DAYS),
    peak: days.reduce((max, day) => Math.max(max, day.count), 0),
    total: days.reduce((sum, day) => sum + day.count, 0),
  };
}

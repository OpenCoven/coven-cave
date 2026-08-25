// Per-day shape of a cron projection, for the calendar views that summarise a
// day rather than list it.
//
// `calendar-cron-projection` answers "which runs land in this window". Agenda
// renders those rows directly, but Week and Month have no room for a row per
// run — the frame (Rituals Redesign.dc.html, CALENDAR TAB) instead gives Week a
// six-band density strip and Month a single count. Both are derived here so the
// arithmetic is testable away from the DOM, and so the two views cannot drift
// into disagreeing about the same day.
//
// The band count is deliberately 6 over 24 hours — four-hour buckets. That is
// the frame's own choice, and its comment says why: "so a column says WHEN the
// load is". A finer bucket would render sub-pixel bands at the width a week
// column actually gets; a coarser one stops distinguishing morning from night.

import type { ProjectedCronRun } from "./calendar-cron-projection.ts";

/** Hours covered by one band. 24 / 4 = the six bands the frame draws. */
export const RUN_DENSITY_BAND_HOURS = 4;

/** Bands per day. */
export const RUN_DENSITY_BANDS = 24 / RUN_DENSITY_BAND_HOURS;

/**
 * Counts past this stop changing a band's height and colour.
 *
 * Without a clamp one busy cron flattens every other band to invisible, so the
 * strip would answer "how many" (which the label already says) instead of
 * "when" (which is the only thing the strip is for).
 */
export const RUN_DENSITY_MAX_LEVEL = 5;

export type RunDensityBand = {
  /** Hour this band starts at: 0, 4, 8, 12, 16, 20. */
  startHour: number;
  /** Runs landing in [startHour, startHour + 4). */
  count: number;
  /**
   * `count` clamped to RUN_DENSITY_MAX_LEVEL — the value the stylesheet keys
   * height and fill off, so no raw px or colour is computed in the component.
   */
  level: number;
  /** e.g. "2 runs 08:00–12:00". Spoken per band, so it names its own window. */
  label: string;
};

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/**
 * Bucket a day's projected runs into the six density bands.
 *
 * Always returns all six, including empty ones: the strip is a fixed axis, and
 * dropping empty buckets would slide the remaining bands to the wrong hours.
 *
 * `runs` may contain other days — this filters to `day` itself, so callers can
 * pass the whole window without slicing first.
 */
export function runDensityBands(
  runs: readonly ProjectedCronRun[],
  day: Date,
): RunDensityBand[] {
  const counts = new Array<number>(RUN_DENSITY_BANDS).fill(0);
  for (const run of runs) {
    const at = new Date(run.atIso);
    if (Number.isNaN(at.getTime())) continue;
    if (
      at.getFullYear() !== day.getFullYear() ||
      at.getMonth() !== day.getMonth() ||
      at.getDate() !== day.getDate()
    ) {
      continue;
    }
    const band = Math.floor(at.getHours() / RUN_DENSITY_BAND_HOURS);
    // getHours() is 0..23, so band is 0..5 — but clamp rather than trust it,
    // since an out-of-range write would corrupt a neighbouring bucket silently.
    if (band < 0 || band >= RUN_DENSITY_BANDS) continue;
    counts[band] += 1;
  }

  return counts.map((count, i) => {
    const startHour = i * RUN_DENSITY_BAND_HOURS;
    const endHour = startHour + RUN_DENSITY_BAND_HOURS;
    return {
      startHour,
      count,
      level: Math.min(count, RUN_DENSITY_MAX_LEVEL),
      label: `${count} ${count === 1 ? "run" : "runs"} ${pad(startHour)}:00–${pad(endHour)}:00`,
    };
  });
}

/**
 * How many projected runs land on `day`.
 *
 * Month cells show this alone — a day cell has room for a count and nothing
 * more, and a count with no strip is honest about being a count.
 */
export function runCountOn(runs: readonly ProjectedCronRun[], day: Date): number {
  let n = 0;
  for (const run of runs) {
    const at = new Date(run.atIso);
    if (Number.isNaN(at.getTime())) continue;
    if (
      at.getFullYear() === day.getFullYear() &&
      at.getMonth() === day.getMonth() &&
      at.getDate() === day.getDate()
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * The caption under a density strip, or under a month cell's glyph.
 *
 * Returns null at zero rather than "0 runs": a day with no projected runs
 * should draw no chrome at all, and returning a string would tempt a caller
 * into rendering an empty affordance.
 */
export function runCountLabel(count: number, noun = "runs"): string | null {
  if (count <= 0) return null;
  return `${count} ${count === 1 ? noun.replace(/s$/, "") : noun}`;
}

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

import type { CronProjection, ProjectedCronRun } from "./calendar-cron-projection.ts";

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
 * Whether `day` falls past the point where the projection is still complete.
 *
 * A partial day's count is a FLOOR, not a total: the caps dropped occurrences
 * it would otherwise hold. Callers say so with a "+" rather than presenting the
 * number as final — a cell reading "2 runs" where the answer is nine tells the
 * reader the month is quieter than it is, which the projection module's own
 * comment calls the same class of lie as a status that cannot be known.
 *
 * Compares against the END of the local day: a day containing the cut-off is
 * itself partial, because everything after that instant is unknown.
 */
export function dayProjectionIsPartial(
  projection: Pick<CronProjection, "truncated" | "completeThroughMs">,
  day: Date,
): boolean {
  if (!projection.truncated) return false;
  const dayEndMs =
    new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - 1;
  return dayEndMs > projection.completeThroughMs;
}

/**
 * The caption under a density strip, or under a month cell's glyph.
 *
 * Returns null at zero rather than "0 runs": a day with no projected runs
 * should draw no chrome at all, and returning a string would tempt a caller
 * into rendering an empty affordance.
 */
export function runCountLabel(count: number, noun = "runs", partial = false): string | null {
  // A partial day with zero KNOWN runs still has nothing to show: "0+ runs" is
  // noise on a day the reader has no reason to look at, and every other cell in
  // a truncated window already carries the "+".
  if (count <= 0) return null;
  const word = count === 1 && !partial ? noun.replace(/s$/, "") : noun;
  return `${count}${partial ? "+" : ""} ${word}`;
}

export type RunCluster = {
  /** Minutes from midnight — where the marker sits on the grid. */
  minutes: number;
  /** Every run firing at this minute, in the order given. */
  runs: ProjectedCronRun[];
};

/**
 * Group a day's runs by the exact minute they fire.
 *
 * Two crons on the same schedule land on the same pixel, and a per-run marker
 * then draws two labels on top of each other — measured in the browser with
 * real data: "Daily bug scan" and "Follow-up monitor" both at the same offset,
 * both illegible. Nudging them apart would be a lie about when they run, so
 * they are collapsed into one marker instead: the same instant IS one moment,
 * and the marker can name the extras.
 */
export function clusterRunsByMinute(
  runs: readonly ProjectedCronRun[],
  day: Date,
): RunCluster[] {
  const byMinute = new Map<number, ProjectedCronRun[]>();
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
    const minutes = at.getHours() * 60 + at.getMinutes();
    const bucket = byMinute.get(minutes);
    if (bucket) bucket.push(run);
    else byMinute.set(minutes, [run]);
  }
  return [...byMinute.entries()]
    .map(([minutes, group]) => ({ minutes, runs: group }))
    .sort((a, b) => a.minutes - b.minutes);
}

/** "Daily brief" alone, or "Daily brief +2" when others share the minute. */
export function clusterLabel(cluster: RunCluster): string {
  const [first, ...rest] = cluster.runs;
  if (!first) return "";
  return rest.length > 0 ? `${first.name} +${rest.length}` : first.name;
}

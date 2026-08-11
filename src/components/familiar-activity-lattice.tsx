"use client";

/**
 * FamiliarActivityLattice — the year, the quarter and the fortnight of one
 * familiar's session activity, in one lattice (cave-yd3qu).
 *
 * The surface already had a 14-day pulse, but it was the only time view on
 * screen. That is the thing the approved design argues against: "the 52-week
 * density grid, the 8-week trend and the 14-day pulse sit in distinct
 * locations in one lattice, so the year, the quarter and the fortnight can be
 * compared rather than paged between." A quiet fortnight means one thing
 * against a quiet year and the opposite against a busy one, and you cannot see
 * which if only one window is rendered.
 *
 * All three views come from `buildActivityLattice`, which derives them from a
 * single 364-day pass — so a day carries the same count in every view by
 * construction and the fortnight can never disagree with the year containing
 * it. Nothing here re-buckets; this file is rendering only.
 *
 * Two deliberate asymmetries, both about not lying:
 *
 *  - Only DAY cells select. The session list filters by day key
 *    (`sessionDayKey`), so a week has nothing to filter to — a clickable week
 *    would promise a filter that does not exist. Weeks report on hover and
 *    stay presentational.
 *  - The year grid is one `role="img"` with a summarising label rather than
 *    364 focusable cells. A screen-reader user gets the shape of the year in a
 *    sentence; 364 tab stops would be a worse answer to the same question.
 *    Sighted hover still reports every individual day, which is what the frame
 *    asks for.
 */

import { memo } from "react";
import { Icon } from "@/lib/icon";
import { Sparkline } from "@/components/ui/sparkline";
import {
  densityStep,
  type ActivityLattice,
  type LatticeDay,
  type LatticeWeek,
} from "@/lib/activity-lattice";

function sessionCount(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

/** "Mar 3 – Mar 9" for a week's own span, read off its days rather than
 *  recomputed, so the label cannot drift from the cells above it. */
function weekLabel(week: LatticeWeek): string {
  const first = week.days[0];
  const last = week.days[week.days.length - 1];
  if (!first || !last) return "";
  return first.label === last.label ? first.label : `${first.label} – ${last.label}`;
}

function busiestDay(days: LatticeDay[]): LatticeDay | null {
  return days.reduce<LatticeDay | null>(
    (best, day) => (best === null || day.count > best.count ? day : best),
    null,
  );
}

export const FamiliarActivityLattice = memo(function FamiliarActivityLattice({
  lattice,
  onSelectDay,
  selectedDayKey,
}: {
  lattice: ActivityLattice;
  /** Selecting a day filters the session list — the same contract the pulse
   *  chart already had, so the lattice adds views without adding vocabulary. */
  onSelectDay: (day: LatticeDay) => void;
  selectedDayKey: string | null;
}) {
  const yearDays = lattice.year.flatMap((week) => week.days);
  const yearPeak = busiestDay(yearDays);
  const fortnightMax = Math.max(1, ...lattice.fortnight.map((day) => day.count));
  const quarterTotal = lattice.quarter.reduce((sum, week) => sum + week.total, 0);
  // The shared Sparkline owns the hover readout, so a week reports its own span
  // and total the same way the day cells report theirs — and reusing it keeps
  // one trend rendering in the app instead of a second hand-rolled bar chart.
  const busiestWeek = lattice.quarter.reduce(
    (best, week) => (best === null || week.total > best.total ? week : best),
    null as (typeof lattice.quarter)[number] | null,
  );
  const busiestWeekLabel = busiestWeek ? `${weekLabel(busiestWeek)} with ${sessionCount(busiestWeek.total)}` : "—";
  const quarterPoints = lattice.quarter.map((week) => ({
    label: weekLabel(week),
    value: week.total,
  }));
  const fortnightTotal = lattice.fortnight.reduce((sum, day) => sum + day.count, 0);
  const silent = lattice.total === 0;

  return (
    // The host carries the container, not the grid: a container query cannot
    // change the layout of the element that declares it, and the lattice has
    // to answer for its OWN width rather than the analytics root's. It docks
    // inside a panel narrower than that root, so querying the root would size
    // the lattice against a box it never had.
    <div className="fa-lattice" data-testid="familiar-activity-lattice">
      <div className="fa-lattice__views">
      {/* Year — the density grid. Weeks run left to right, weekdays top to
          bottom, which is the reading most people already have from every
          other contribution grid they have seen. */}
      <section className="fa-lattice__cell fa-lattice__cell--year">
        <header className="fa-lattice__head">
          <Icon name="ph:calendar-blank" width={13} aria-hidden />
          <b>Year</b>
          <span className="fa-lattice__count">
            {sessionCount(lattice.total)} over {lattice.year.length} weeks
          </span>
        </header>
        <div
          className="fa-lattice__grid"
          role="img"
          aria-label={
            silent
              ? `Year density: no sessions in the last ${lattice.year.length} weeks.`
              : `Year density: ${sessionCount(lattice.total)} over ${lattice.year.length} weeks, busiest ${yearPeak?.label ?? "—"} with ${sessionCount(yearPeak?.count ?? 0)}.`
          }
        >
          {yearDays.map((day) => (
            <span
              key={day.key}
              className="fa-lattice__day"
              data-step={densityStep(day.count, lattice.peak)}
              data-selected={day.key === selectedDayKey ? "true" : undefined}
              // Hover reports the day itself — the frame's "every cell and
              // point reports its own day".
              title={`${day.label} · ${sessionCount(day.count)}`}
              aria-hidden
            />
          ))}
        </div>
      </section>

      {/* Quarter — weekly totals. Presentational: a week is not a filterable
          unit (see the header note). */}
      <section className="fa-lattice__cell fa-lattice__cell--quarter">
        <header className="fa-lattice__head">
          <Icon name="ph:chart-bar" width={13} aria-hidden />
          <b>Quarter</b>
          <span className="fa-lattice__count">
            {sessionCount(quarterTotal)} over {lattice.quarter.length} weeks
          </span>
        </header>
        <figure
          className="fa-lattice__trend"
          // The Sparkline is a graphic: without a role and a label a screen
          // reader gets nothing for the quarter, since the caption below is
          // aria-hidden. Same treatment the thread-score trend already uses.
          role="img"
          aria-label={
            silent
              ? `Quarter trend: no sessions in the last ${lattice.quarter.length} weeks.`
              : `Quarter trend: ${sessionCount(quarterTotal)} across the last ${lattice.quarter.length} weeks, busiest week ${busiestWeekLabel}.`
          }
        >
          <Sparkline points={quarterPoints} color="var(--accent-presence)" height={72} />
          <figcaption aria-hidden>
            Sessions per week, oldest to newest · hover for values
          </figcaption>
        </figure>
      </section>

      {/* Fortnight — the existing pulse, now beside its own year rather than
          standing in for one. These are the selectable cells. */}
      <section className="fa-lattice__cell fa-lattice__cell--fortnight">
        <header className="fa-lattice__head">
          <Icon name="ph:waveform-bold" width={13} aria-hidden />
          <b>Fortnight</b>
          <span className="fa-lattice__count">{sessionCount(fortnightTotal)}</span>
          <span className="fa-lattice__hint">select a day to filter sessions</span>
        </header>
        <div className="fa-lattice__pulse">
          {lattice.fortnight.map((day) => (
            <button
              key={day.key}
              type="button"
              className="fa-lattice__pulse-day focus-ring"
              data-empty={day.count === 0 ? "true" : undefined}
              data-selected={day.key === selectedDayKey ? "true" : undefined}
              aria-pressed={day.key === selectedDayKey}
              aria-label={`${day.label}, ${sessionCount(day.count)}`}
              title={`${day.label} · ${sessionCount(day.count)}`}
              onClick={() => onSelectDay(day)}
            >
              <i
                style={{ height: `${day.count === 0 ? 3 : Math.max(8, (day.count / fortnightMax) * 100)}%` }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </section>
      </div>
    </div>
  );
});

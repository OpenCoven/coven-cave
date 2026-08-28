// @ts-nocheck
// Day view's chrome after cave-25914.
//
// Three things were saying what one thing should say, and one thing was saying
// it backwards:
//   - the toolbar rendered fmtDateHeading(anchor) and DayView rendered a second
//     <h2> with the same string underneath it;
//   - the runs density band spanned the full row while the chart inside it is
//     capped at 320px, so a single-column view spent a whole band — ahead of
//     the first hour — mostly on empty space;
//   - projected runs drew the dashed rule flexible with the label pinned RIGHT,
//     putting a run's time and its name most of the viewport apart.
//
// Each is pinned here as the property, not the markup, so a refactor that keeps
// the behaviour passes and a regression that restores the duplication fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = readFileSync(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/calendar.css", import.meta.url), "utf8");

const dayView = view.match(/function DayView\(\{[\s\S]*?\n\}\n/)?.[0] ?? "";
assert.ok(dayView, "DayView is present");

// ── One date statement ──────────────────────────────────────────────────────
assert.doesNotMatch(dayView, /<h2/, "DayView renders no heading of its own");
// Scoped to JSX interpolation, not any mention: DayView still passes
// `label: fmtDateHeading(anchor)` into its column, which TimeGrid reads only
// for the reschedule announcement. That is a screen-reader string, not a
// second visible date.
assert.doesNotMatch(
  dayView,
  /\{fmtDateHeading\(anchor\)\}/,
  "…and renders no second visible copy of the date",
);
// The relative word did not disappear with that heading — it moved.
assert.match(
  view,
  /if \(effectiveView === "day"\) \{[\s\S]{0,400}?relDayWord\(anchor, toolbarNow\)/,
  "the toolbar heading carries the day's relative word",
);

// ── Runs summary: Day only, in the toolbar ──────────────────────────────────
assert.doesNotMatch(dayView, /<RunDensityStrip/, "Day draws no full-width density band");
// Week keeps its strip: there the per-column comparison IS the chart's point.
assert.match(view, /<RunDensityStrip/, "Week still draws the per-column density strip");
assert.match(
  view,
  /effectiveView === "day" && showRuns && dayRunCount > 0/,
  "the toolbar count is Day-only and follows the toggle",
);
// It counts THIS day, not the whole projection window — Day projects one day,
// but a count that silently followed the window would be wrong the moment the
// projection range changed.
assert.match(
  view,
  /dayRunCount = useMemo\([\s\S]{0,400}?isSameDay\(d, anchor\)/,
  "the count is scoped to the anchored day",
);

// ── The toggle is an overlay control, not a fifth view ──────────────────────
assert.match(view, /className="cal-runs-group shrink-0"/, "the runs control sits in its own group");
assert.match(css, /\.cal-runs-group \{[^}]*border-inline-start: 1px solid var\(--border-hairline\);/,
  "…separated from the view switcher by a rule");
assert.match(view, />\s*Ritual runs\s*</, "and is Title Case like the views beside it");

// ── Projections read left-to-right from the gutter ──────────────────────────
const mark = view.match(/className="cal-run-mark"[\s\S]*?\n\s{16}<\/div>/)?.[0] ?? "";
assert.ok(mark, "the projected-run marker is present");
const dotAt = mark.indexOf("cal-run-mark__dot");
const labelAt = mark.indexOf("cal-run-mark__label");
const tickAt = mark.indexOf("cal-run-mark__tick");
assert.ok(dotAt !== -1 && labelAt !== -1 && tickAt !== -1, "marker has dot, label and rule");
assert.ok(
  dotAt < labelAt && labelAt < tickAt,
  "the name sits beside the hour gutter and the dashed rule trails it",
);
// The dot is the channel that separates a forecast from a real event; without
// it the only difference was the dash, in the same accent.
assert.match(css, /\.cal-run-mark__dot \{[^}]*border-radius: 50%;/, "projections carry a hollow marker");

console.log("calendar-day-tighten.test.ts: ok");

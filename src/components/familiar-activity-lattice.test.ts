// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Wiring pins for the activity lattice (cave-yd3qu). The pure model already
// had 24 assertions of its own in src/lib/activity-lattice.test.ts; what was
// missing — and what this file covers — is that anything RENDERS it, and that
// the rendering keeps the promises the frame and the model make.

const lattice = await readFile(new URL("./familiar-activity-lattice.tsx", import.meta.url), "utf8");
const stage = await readFile(new URL("./familiar-analytics-stage.tsx", import.meta.url), "utf8");
const data = await readFile(new URL("./familiar-analytics-data.ts", import.meta.url), "utf8");
const content = await readFile(new URL("./familiar-analytics-content.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/familiar-analytics.css", import.meta.url), "utf8");

// ── The model is rendered at all ─────────────────────────────────────────────
// The whole gap this closes: activity-lattice.ts shipped in #4335 and then sat
// with no importer except its own test, so the surface still showed one time
// view. If this regresses to zero consumers the module is dead code again.
assert.match(
  data,
  /activityLattice: buildActivityLattice\(familiarSessions, data\.familiarId, now\)/,
  "the analytics model builds the lattice from the familiar's own sessions",
);
assert.match(
  content,
  /lattice=\{model\.activityLattice\}/,
  "the surface hands the lattice to the activity panel",
);
assert.match(
  stage,
  /<FamiliarActivityLattice[\s\S]{0,200}lattice=\{lattice\}/,
  "the activity panel renders the lattice component",
);

// ── Three views, one lattice ─────────────────────────────────────────────────
// "The 52-week density grid, the 8-week trend and the 14-day pulse sit in
// distinct locations in one lattice, so the year, the quarter and the
// fortnight can be compared rather than paged between."
for (const view of ["year", "quarter", "fortnight"]) {
  assert.match(
    lattice,
    new RegExp(`fa-lattice__cell--${view}`),
    `the ${view} view has its own cell`,
  );
}
// Paging between them is the failure mode being replaced, so the three must not
// come back as a tab/step state inside this component.
assert.doesNotMatch(
  lattice,
  /useState|activeView|currentView/,
  "the lattice renders all three views at once — no view state to page between",
);

// ── The single-chart pulse it replaces is gone ───────────────────────────────
assert.doesNotMatch(
  stage,
  /fa-pulse-panel__chart/,
  "the one-view-at-a-time chart is replaced, not left beside the lattice",
);

// ── Every cell and point reports its own day on hover ────────────────────────
// The frame is explicit about this, and it is what makes a dense grid legible
// at all: a shade with no readout is a picture, not a measure.
assert.match(
  lattice,
  /title=\{`\$\{day\.label\} · \$\{sessionCount\(day\.count\)\}`\}/,
  "day cells report their own day and count on hover",
);
// The quarter reuses the shared Sparkline rather than a second hand-rolled bar
// chart; the primitive owns the hover readout, so the week's own span is what
// it reports. This also keeps one trend rendering in the app instead of two.
assert.match(
  lattice,
  /<Sparkline points=\{quarterPoints\}/,
  "the quarter trend reuses the shared Sparkline primitive",
);
assert.match(
  lattice,
  /label: weekLabel\(week\),\s*\n\s*value: week\.total,/,
  "each trend point is labelled with the week's own span and carries its total",
);

// ── Only days select, because only days can be filtered ──────────────────────
// The session list filters by day key (sessionDayKey). A clickable week would
// promise a filter that does not exist, so weeks stay presentational.
assert.match(
  lattice,
  /className="fa-lattice__pulse-day focus-ring"[\s\S]{0,400}onClick=\{\(\) => onSelectDay\(day\)\}/,
  "fortnight days are buttons that select the day",
);
assert.doesNotMatch(
  lattice,
  /onSelectWeek|onClick=\{\(\) => onSelect\w*\(week\)/,
  "weeks are not selectable — there is no week filter to select into",
);

// Every graphic in the lattice needs a text alternative, not just the grid.
// The quarter's caption is aria-hidden, so without a label on the figure a
// screen reader gets nothing at all for that view — found in review on #4425,
// with all 18 checks green.
assert.match(
  lattice,
  /className="fa-lattice__trend"[\s\S]{0,400}role="img"[\s\S]{0,200}aria-label=\{/,
  "the quarter trend figure carries a role and a summarising label",
);

// ── The year grid is summarised, not 364 tab stops ───────────────────────────
assert.match(
  lattice,
  /className="fa-lattice__grid"\s*\n\s*role="img"/,
  "the year grid carries one image role with a summarising label",
);
assert.match(
  lattice,
  /aria-label=\{\s*silent/,
  "the year's label states the silent case rather than reading an empty grid",
);

// ── Density shades come from the model, never recomputed here ────────────────
// buildActivityLattice guarantees a day carries the same count in all three
// views; a second bucketing in the view would be free to disagree with it.
assert.match(
  lattice,
  /data-step=\{densityStep\(day\.count, lattice\.peak\)\}/,
  "shade steps come from the shared densityStep against the year's peak",
);
assert.match(
  css,
  /\.fa-lattice__day\s*\{[^}]*border-radius:\s*2px;/,
  "year cells keep a 2px micro-radius so the square grid never becomes circles",
);
assert.doesNotMatch(
  css,
  /\.fa-lattice__trend,\s*\n?\.fa-lattice__pulse\s*\{/,
  "the quarter Sparkline does not inherit the fortnight bar layout",
);
assert.match(
  css,
  /\.fa-lattice__trend\s*\{[^}]*display:\s*block;[^}]*margin:\s*0;/,
  "the quarter figure stacks its Sparkline and caption vertically",
);
assert.match(
  css,
  /\.fa-lattice__pulse\s*\{[^}]*display:\s*flex;[^}]*height:\s*72px;/,
  "the fortnight alone retains the fixed-height flex bar layout",
);
assert.match(
  css,
  /\.fa-lattice__trend figcaption\s*\{[^}]*margin-top:\s*var\(--space-1\);/,
  "the quarter caption has explicit space below the Sparkline",
);
// Call syntax, not bare names: the header comment legitimately cites
// `sessionDayKey` when explaining why weeks are not selectable, and a pin that
// cannot tell prose from code fails on its own documentation.
assert.doesNotMatch(
  lattice,
  /buildSessionPulse\(|sessionDayKey\(|new Date\(/,
  "the view does no bucketing of its own",
);

// ── The lattice measures its OWN box ─────────────────────────────────────────
// The analytics root already declares `container-name: fa`, but the lattice
// docks inside a panel narrower than that root — querying the root would size
// it against a box it never had. This is the cave-k3a9u failure in miniature:
// a breakpoint that describes the wrong element is a breakpoint that lies.
assert.match(
  css,
  /\.fa-lattice \{[^}]*container-name: fa-lattice/,
  "the lattice declares its own container",
);
assert.match(
  css,
  /@container fa-lattice \(max-width: 560px\)/,
  "the narrow rule queries the lattice's container by name, not the nearest one",
);
// A container query cannot restyle the element that declares the container, so
// the grid has to be a child of the host — otherwise the rule silently no-ops.
assert.match(
  css,
  /@container fa-lattice \(max-width: 560px\) \{\s*\.fa-lattice__views \{/,
  "the narrow rule targets the child grid, not the host that declares the container",
);
assert.match(
  lattice,
  /className="fa-lattice"[\s\S]{0,200}className="fa-lattice__views"/,
  "the host wraps the grid, matching what the container query targets",
);

// Swapping the quarter to the Sparkline made the bar rules dead; leaving them
// would be the same inert-CSS problem this PR removed elsewhere.
assert.doesNotMatch(
  css,
  /fa-lattice__week-bar/,
  "no stylesheet rules survive for a DOM shape the lattice no longer renders",
);

// ── No hand-copied colour ────────────────────────────────────────────────────
// The handoff paints its own hexes; the repo's ramp is a color-mix off a token
// so the grid survives all 12 palettes and both modes.
const latticeCss = css.slice(css.indexOf(".fa-lattice {"));
assert.doesNotMatch(
  latticeCss,
  /#[0-9a-fA-F]{3,8}\b/,
  "the lattice styles carry no literal colour",
);

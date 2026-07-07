// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

// ───────── Task 1: AM/PM hour labels ─────────
assert.match(
  source,
  /function fmtHourLabel\(h: number\): string \{/,
  "fmtHourLabel helper must exist",
);
assert.match(
  source,
  /\{fmtHourLabel\(h\)\}/,
  "TimeGrid must render hour labels via fmtHourLabel(h)",
);

// Functional check via dynamic eval of the extracted body.
const fnMatch = source.match(/function fmtHourLabel\(h: number\): string \{([\s\S]*?)\n\}/);
assert.ok(fnMatch, "fmtHourLabel body must be extractable for runtime check");
const body = fnMatch[1].replace(/: (number|string)/g, "");
const fmtHourLabel = new Function("h", body);
assert.equal(fmtHourLabel(0), "12 AM", "h=0 → 12 AM");
assert.equal(fmtHourLabel(1), "1 AM", "h=1 → 1 AM");
assert.equal(fmtHourLabel(11), "11 AM", "h=11 → 11 AM");
assert.equal(fmtHourLabel(12), "12 PM", "h=12 → 12 PM");
assert.equal(fmtHourLabel(13), "1 PM", "h=13 → 1 PM");
assert.equal(fmtHourLabel(23), "11 PM", "h=23 → 11 PM");

// ───────── Task 2: Day view always renders TimeGrid ─────────
assert.match(
  source,
  /function DayView\([\s\S]*?return \(\s*<div className="flex flex-col flex-1 overflow-hidden">[\s\S]*?<TimeGrid columns=\{columns\}/,
  "DayView must always render TimeGrid (no conditional EmptyScheduleState swap)",
);
// (2026-06-11) The floating empty-state Add-event overlays were removed on
// Val's instruction — the toolbar button is the single entry point. The old
// assertion requiring the DayView affordance is inverted below in the
// "Single Add-event affordance" block.

// ───────── Task 3: Week view always renders TimeGrid ─────────
assert.match(
  source,
  /function WeekView\([\s\S]*?<TimeGrid columns=\{columns\} onOpenItem=\{onOpenItem\}/,
  "WeekView must always render TimeGrid",
);

// ───────── Task 4: Today indicator ─────────
assert.match(
  source,
  /now && isSameDay\(col\.date, now\) \? "bg-\[color-mix\(in_oklch,var\(--accent-presence\)_6%,transparent\)\]" : ""/,
  "TimeGrid column body must tint today's column with accent-presence at 6%",
);
assert.match(
  source,
  /isToday[\s\S]{0,80}ring-1 ring-inset ring-\[var\(--accent-presence\)\]/,
  "MonthView cell must add ring-1 ring-inset on today",
);

// ───────── Task 5: Keyboard hints ─────────
// The always-visible footer hint bar was retired (§8 chrome diet); the
// bindings are documented in the canonical ⌘/ Shortcuts sheet instead.
const shortcuts = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
assert.doesNotMatch(
  source,
  /← → navigate · T today/,
  "CalendarView no longer renders a permanent keyboard-hints footer",
);
assert.match(
  shortcuts,
  /Calendar: Day \/ Week \/ Month \/ Agenda view/,
  "the calendar view-switch keys are documented in the Shortcuts sheet catalog",
);
assert.match(
  shortcuts,
  /Calendar: jump to today/,
  "the calendar Today key is documented in the Shortcuts sheet catalog",
);

// ───────── Task 6: + Add event toolbar button ─────────
assert.match(
  source,
  /aria-label="Add event"|>\s*Add event\s*</,
  "CalendarView header must include a 'Add event' button",
);
assert.match(
  source,
  /onAddEntry\(\{ fireAt: defaultEntryFireAt\(anchor\) \}\)/,
  "Toolbar new-event handler must call onAddEntry with anchor-derived fireAt",
);

// ───────── Task 7: Agenda showPast fallback ─────────
assert.match(
  source,
  /const \[showPast, setShowPast\] = useState\(false\);/,
  "AgendaView must hold a showPast state",
);
assert.match(
  source,
  /Show \{pastCount\} past item/,
  "AgendaView empty fallback must offer to show past items",
);
assert.match(
  source,
  /Hide past/,
  "AgendaView must offer a 'Hide past' toggle when showPast is on",
);

// ───────── Task 8: Mini-month popover ─────────
assert.match(
  source,
  /function MiniMonthPopover\(\s*\{\s*anchor,\s*onPick,\s*onClose,?\s*\}/,
  "MiniMonthPopover component must be defined",
);
assert.match(
  source,
  /const \[pickerOpen, setPickerOpen\] = useState\(false\);/,
  "CalendarView must own a pickerOpen state",
);
assert.match(
  source,
  /aria-label="Jump to date"/,
  "Popover dialog must carry aria-label='Jump to date'",
);
assert.match(
  source,
  /onClick=\{\(\) => setPickerOpen\(\(v\) => !v\)\}/,
  "Heading button must toggle pickerOpen",
);

console.log("calendar-view-polish.test.ts: ok");

// ── Single Add-event affordance, uniform toolbar height ──────────────────
// Day/Week previously floated absolute "+ Add event" overlays over the time
// grid; the toolbar button is now the only entry point.
assert.doesNotMatch(
  source,
  /absolute top-3 right-3[\s\S]{0,400}Add event/,
  "No floating Add-event overlays over the time grids",
);
assert.equal(
  (source.match(/Add event/g) ?? []).length,
  1, // the single toolbar button's visible label (now a shared <Button>, no redundant aria-label)
  "Exactly one Add event button (toolbar)",
);
assert.match(
  source,
  /inline-flex h-7 items-center px-2\.5 text-\[11px\][\s\S]{0,200}viewMode === id/,
  "View-mode tabs are h-7 — same height as the toolbar controls",
);
assert.match(
  source,
  /<Button[\s\S]{0,200}className="calendar-toolbar-button"\s*>\s*Today\s*<\/Button>/,
  "Today is the shared Button primitive, keeping the toolbar mobile hook",
);
assert.match(
  source,
  /<Button[\s\S]{0,220}leadingIcon="ph:plus-bold"[\s\S]{0,160}>\s*Add event\s*<\/Button>/,
  "Toolbar Add event is the shared Button primitive with its label",
);

// cave-4op toolbar slice: the nav arrows are shared IconButtons and the raw
// hand-rolled toolbar control markup is gone. The segmented view switcher and
// the heading / jump-to-date trigger stay bespoke (a segmented control and a
// text trigger, not standard buttons).
assert.match(source, /<IconButton[\s\S]{0,80}icon="ph:arrow-left-bold"[\s\S]{0,80}aria-label="Previous"/, "toolbar Previous is an IconButton");
assert.match(source, /<IconButton[\s\S]{0,80}icon="ph:arrow-right-bold"[\s\S]{0,80}aria-label="Next"/, "toolbar Next is an IconButton");
assert.doesNotMatch(source, /grid h-7 w-7 place-items-center rounded-md text-\[var\(--text-muted\)\]/, "no hand-rolled toolbar nav-arrow markup remains");

// ───────── Mobile toolbar hit areas ─────────
assert.match(source, /calendar-toolbar/, "Calendar toolbar should expose a stable mobile hook");
assert.match(source, /calendar-toolbar-icon/, "Calendar icon buttons should expose a mobile hook");
assert.match(source, /calendar-toolbar-button/, "Calendar toolbar buttons should expose a mobile hook");
assert.match(source, /calendar-heading-button/, "Calendar heading button should expose a mobile hook");
assert.match(source, /calendar-empty-action/, "Calendar empty-state actions should expose a mobile hook");
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.calendar-toolbar-icon,[\s\S]*\.calendar-toolbar-button,[\s\S]*\.calendar-heading-button,[\s\S]*\.calendar-empty-action\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "Mobile calendar toolbar and empty-state controls should meet the shared touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.calendar-toolbar-icon\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "Mobile calendar icon buttons should be square touch targets",
);

// Calendar event buttons show a visible keyboard focus ring. The time-grid
// events are arrow-navigable via roving tabindex, so focus must be visible.
assert.ok(
  source.includes("focus-ring-inset absolute flex items-center gap-1 rounded px-1.5 py-0.5 text-left text-[10px]"),
  "time-grid event buttons have a focus ring",
);
assert.ok(
  source.includes("focus-ring-inset flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px]"),
  "all-day event buttons have a focus ring",
);

// Month view: clicking an empty current-month day pre-fills the add form for
// that day; the date number still navigates into the day.
assert.match(source, /const canAdd = isCurrentMonth && !!onAddEntry;/, "month cells know when they can add");
assert.match(source, /const onCell = \(\) => \{[\s\S]{0,120}onAddEntry!\(\{ fireAt: defaultEntryFireAt\(day\) \}\)[\s\S]{0,40}onDayClick\?\.\(day\)/, "an empty day click adds (current month) or navigates (otherwise)");
assert.match(source, /onClick=\{onCell\}/, "the day cell click runs the add/navigate handler");
assert.match(source, /aria-label=\{`Open \$\{fmtDateHeading\(day\)\}`\}/, "the date number is a button labelled to open the day");
assert.match(source, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); onDayClick\?\.\(day\); \}\}/, "the date number navigates into the day (stops the cell add)");

// ── Per-familiar colour coding + legend ──
assert.match(source, /import \{ familiarAccent \} from "@\/lib\/familiar-color"/, "uses the familiar-accent helper");
assert.match(source, /const FamiliarColorContext = createContext/, "provides per-familiar colour via context (no prop threading)");
assert.match(source, /<FamiliarColorContext\.Provider value=\{accentFor\}>/, "CalendarView provides the accent fn");
assert.match(source, /familiarAccent\(f\.color, f\.id\)/, "maps each familiar to its accent (explicit colour or derived)");
assert.match(source, /const accent = useFamiliarAccent\(item\.familiarId\)/, "item chips read their familiar's accent");
assert.match(source, /borderLeftColor: accent, borderLeftWidth: 3/, "the accent renders as a left spine on chips");
assert.match(source, /legendFamiliars\.length >= 2/, "the colour legend only shows when ≥2 familiars are in view");
assert.match(source, /aria-label="Familiar colour legend"/, "the legend is labelled");

// ───────── cave-4op: action controls use the shared Button / IconButton primitives ─────────
// The Calendar's *action controls* — the item detail panel (Close/Open/Done/
// Dismiss) and the empty-state / agenda actions (Add task, Show past, Hide
// past) — are standardized onto the shared primitives so their radius, height,
// focus ring, and disabled treatment come from one place (cave-4op). Bespoke
// *content* elements (item/deadline chips, draggable time-grid events, month &
// mini-month date cells) and the tightly-pinned toolbar / segmented switcher
// are deliberately out of scope here — they are not standard controls.
assert.match(
  source,
  /import \{ Button \} from "@\/components\/ui\/button"/,
  "calendar imports the shared Button primitive",
);
assert.match(
  source,
  /import \{ IconButton \} from "@\/components\/ui\/icon-button"/,
  "calendar imports the shared IconButton primitive",
);

/** Slice out a top-level function body by name, up to the next function decl. */
function fnRegion(name) {
  const m = new RegExp(`function ${name}\\(`).exec(source);
  assert.ok(m, `${name} must exist`);
  const after = source.slice(m.index + m[0].length);
  const next = /\n(?:export )?function \w+\(/.exec(after);
  return after.slice(0, next ? next.index : after.length);
}

// No raw <button> survives in the standardized control clusters.
for (const name of ["EmptyScheduleState", "AgendaView", "ItemDetailPanel"]) {
  assert.doesNotMatch(
    fnRegion(name),
    /<button\b/,
    `${name} action controls use <Button>/<IconButton>, not a raw <button>`,
  );
}

const detail = fnRegion("ItemDetailPanel");
assert.match(detail, /<IconButton\b[\s\S]*?aria-label="Close"/, "detail panel Close is an IconButton");
assert.match(detail, /<Button\b[\s\S]*?variant="primary"/, "detail panel Open is a primary Button");
assert.match(detail, /<Button\b[\s\S]*?variant="secondary"[\s\S]*?Done/, "detail panel Done is a secondary Button");
assert.match(detail, /<IconButton\b[\s\S]*?aria-label="Dismiss"/, "detail panel Dismiss is an IconButton");

// The empty-state / agenda actions keep their mobile hook while using the primitive.
assert.match(
  fnRegion("EmptyScheduleState"),
  /<Button\b[\s\S]*?className="calendar-empty-action"/,
  "empty-schedule Add action is a Button that keeps the mobile hook",
);
assert.match(
  fnRegion("AgendaView"),
  /<Button\b[\s\S]*?className="calendar-empty-action"/,
  "agenda empty-state actions are Buttons that keep the mobile hook",
);

// cave-4op mini-month micro-slice: the jump-to-date popover's month nav arrows
// and its Today shortcut use the shared primitives. The day-cell grid stays
// bespoke (date cells with today/anchor states, not standard controls).
assert.match(
  source,
  /<IconButton[\s\S]{0,80}icon="ph:arrow-left-bold"[\s\S]{0,80}aria-label="Previous month"/,
  "mini-month Previous is an IconButton",
);
assert.match(
  source,
  /<IconButton[\s\S]{0,80}icon="ph:arrow-right-bold"[\s\S]{0,80}aria-label="Next month"/,
  "mini-month Next is an IconButton",
);
assert.match(
  source,
  /<Button[\s\S]{0,120}fullWidth[\s\S]{0,140}onClick=\{\(\) => onPick\(today\)\}[\s\S]{0,40}>\s*Today\s*<\/Button>/,
  "mini-month Today is a fullWidth Button",
);
assert.doesNotMatch(
  source,
  /grid h-6 w-6 place-items-center rounded-md/,
  "no hand-rolled mini-month nav-arrow markup remains",
);

console.log("calendar-view-polish.test.ts: month click-to-add + familiar colours + cave-4op control primitives ok");

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
  /col\.isToday \? "bg-\[color-mix\(in_oklch,var\(--accent-presence\)_6%,transparent\)\]" : ""/,
  "TimeGrid column body must tint today's column with accent-presence at 6%",
);
assert.match(
  source,
  /isToday[\s\S]{0,80}ring-1 ring-inset ring-\[var\(--accent-presence\)\]/,
  "MonthView cell must add ring-1 ring-inset on today",
);

// ───────── Task 5: Keyboard hints footer ─────────
assert.match(
  source,
  /← → navigate · T today · D Day · W Week · M Month · A Agenda/,
  "CalendarView must render the keyboard-hints footer string",
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
  2, // aria-label + button label of the single toolbar button
  "Exactly one Add event button (toolbar), counted via its label + aria-label",
);
assert.match(
  source,
  /inline-flex h-7 items-center px-2\.5 text-\[11px\][\s\S]{0,200}viewMode === id/,
  "View-mode tabs are h-7 — same height as the toolbar controls",
);
assert.match(
  source,
  /inline-flex h-7 items-center rounded-md border[\s\S]{0,200}Today/,
  "Today button matches the h-7 toolbar height",
);
assert.match(
  source,
  /aria-label="Add event"/,
  "Toolbar Add event button is labeled",
);

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

console.log("calendar-view-polish.test.ts: month click-to-add + familiar colours ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./calendar-view.tsx", import.meta.url), "utf8");

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
assert.match(
  source,
  /function DayView\([\s\S]*?\+ Add event/,
  "DayView must render a floating '+ Add event' affordance when empty",
);

// ───────── Task 3: Week view always renders TimeGrid ─────────
assert.match(
  source,
  /function WeekView\([\s\S]*?<TimeGrid columns=\{columns\} onOpenItem=\{onOpenItem\} \/>\s*\{isWeekEmpty && onAddEntry/,
  "WeekView must always render TimeGrid then conditionally render the empty add-CTA",
);

console.log("calendar-view-polish.test.ts: ok");

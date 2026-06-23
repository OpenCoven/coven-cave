// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const inbox = await readFile(new URL("./inbox-escalations-view.tsx", import.meta.url), "utf8");
const calendar = await readFile(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

// ───────── Automations wrapper ─────────

assert.match(
  inbox,
  /activeFamiliarId\?:\s*string \| null/,
  "InboxEscalationsView keeps the old inbox prop contract for callers",
);

assert.match(
  inbox,
  /<AutomationsView[\s\S]*familiars=\{familiars \?\? \[\]\}[\s\S]*onNewReminder=\{onNewReminder \?\? \(\(\) => \{\}\)\}[\s\S]*onOpenSession=\{onOpenSession\}/,
  "InboxEscalationsView should render only the Schedules surface",
);

assert.doesNotMatch(
  inbox,
  />Escalations<|inbox-view__tabs|setTab\(/,
  "Hidden inbox/escalations UI should not render inside the Schedules surface",
);

// ───────── Calendar ─────────

assert.match(
  calendar,
  /activeFamiliarId\?:\s*string \| null/,
  "CalendarView must accept an optional activeFamiliarId prop",
);

// The scope predicate honors the multiselect set (empty = All) and falls back
// to the single activeFamiliarId; scopedItems filters every sub-view through it.
assert.match(
  calendar,
  /scopeFamiliarIds\s*\?\s*familiarInScope\(scopeFamiliarIds, familiarId\)\s*:\s*activeFamiliarId == null \|\| familiarId === activeFamiliarId/,
  "Calendar's scope predicate uses the multiselect set, falling back to activeFamiliarId",
);
assert.match(
  calendar,
  /const scopedItems = useMemo[\s\S]*?\.filter\(\(it\) => inScope\(it\.familiarId\)\)[\s\S]*?\[items, inScope\]/,
  "Calendar must derive a scopedItems memo filtering by the scope predicate",
);
assert.match(
  calendar,
  /const scopedDeadlines = useMemo[\s\S]*?\.filter\(\(d\) => inScope\(d\.familiarId\)\)/,
  "Calendar deadlines respect the same scope predicate",
);

for (const view of ["AgendaView", "DayView", "WeekView", "MonthView"]) {
  assert.match(
    calendar,
    new RegExp(`<${view}\\s*\\n?\\s*items=\\{scopedItems\\}`),
    `${view} must receive scopedItems so every sub-view respects the hard-scope`,
  );
}

assert.match(
  calendar,
  /scopedItems\.filter\(\(i\) => i\.status === "pending"\)/,
  "Calendar's pending pill count must derive from scopedItems too",
);

// ───────── Workspace wiring ─────────

assert.match(
  workspace,
  /<InboxEscalationsView[\s\S]*?activeFamiliarId=\{activeId\}/,
  "Workspace must pass activeId to InboxEscalationsView",
);

assert.match(
  workspace,
  /const calendarFamiliarId = activeId \?\? familiars\[0\]\?\.id \?\? null/,
  "Workspace calendar mode should default All familiars to one familiar",
);

assert.match(
  workspace,
  /<CalendarView[\s\S]*?activeFamiliarId=\{calendarFamiliarId\}/,
  "Workspace must pass the effective selected familiar to CalendarView",
);

console.log("inbox-calendar-familiar-scope.test.ts: ok");

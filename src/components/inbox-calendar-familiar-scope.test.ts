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
  "InboxEscalationsView should render only the Automations schedule surface",
);

assert.doesNotMatch(
  inbox,
  />Escalations<|inbox-view__tabs|setTab\(/,
  "Hidden inbox/escalations UI should not render inside the Automations surface",
);

// ───────── Calendar ─────────

assert.match(
  calendar,
  /activeFamiliarId\?:\s*string \| null/,
  "CalendarView must accept an optional activeFamiliarId prop",
);

assert.match(
  calendar,
  /const scopedItems = useMemo[\s\S]*?it\.familiarId === activeFamiliarId[\s\S]*?\[items, activeFamiliarId\]/,
  "Calendar must derive a scopedItems memo filtering on item.familiarId",
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
  /<CalendarView[\s\S]*?activeFamiliarId=\{activeId\}/,
  "Workspace must pass activeId to CalendarView",
);

console.log("inbox-calendar-familiar-scope.test.ts: ok");

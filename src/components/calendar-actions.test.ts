// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const ws = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

// ───────── Detail panel: real, kind-aware actions (no dead buttons) ─────────
for (const cb of ["onComplete", "onDismiss", "onSnooze"]) {
  assert.match(view, new RegExp(`${cb}\\?:\\s*\\(`), `Props must declare ${cb}`);
}
assert.match(view, /onComplete\(item\.id\); onClose\(\)/, "Done must call onComplete(id), not just close");
assert.match(view, /onDismiss\(item\.id\); onClose\(\)/, "Dismiss must call onDismiss(id), not just close");
assert.match(view, /onSnooze\(item\.id, untilIso\)/, "Snooze must call onSnooze(id, untilIso)");
assert.match(view, /import \{ SnoozeMenu \} from "@\/components\/snooze-menu"/, "Reuses the shared SnoozeMenu");
assert.match(view, /onOpen\(item\); onClose\(\)/, "Open action must invoke onOpen and close");
assert.match(view, /function openTargetLabel/, "Open label must be derived from item.link/sessionId");

// ───────── Detail panel as accessible dialog ─────────
assert.match(view, /role="dialog"/, "Detail panel must be a dialog");
assert.match(view, /aria-modal="true"/, "Detail panel must be aria-modal");
assert.match(view, /aria-labelledby=\{titleId\}/, "Detail panel must be labelled by its title");
assert.match(view, /useFocusTrap\(true, panelRef, \{ onEscape: onClose \}\)/, "Detail panel must trap focus + Escape");

// ───────── Dismissed items leave the calendar ─────────
assert.match(view, /\.filter\(\(it\) => it\.status !== "dismissed"\)/, "Dismissed items must be filtered out of the calendar");

// ───────── Overlap-aware time grid ─────────
assert.match(view, /import \{ itemDate, packEventColumns \} from "@\/lib\/calendar-layout"/, "TimeGrid uses the extracted lane packer");
// Lane packing is memoised per columns change (a drag re-renders the grid
// continuously) and rendered from the cached result, not recomputed inline.
assert.match(view, /const packedColumns = useMemo\(\(\) => columns\.map\(\(c\) => packEventColumns\(c\.items\)\), \[columns\]\)/, "Time-grid lane packing is memoised on columns");
assert.match(view, /packedColumns\[ci\]\.map/, "Time-grid events render from the packed lanes");
assert.match(view, /data-calendar-event="true"/, "Events keep the roving-tabindex hook attribute");
assert.doesNotMatch(view, /minHeight: 20/, "Old fixed 20px event height must be gone");

// ───────── Hydration-safe, live-ticking "now" ─────────
// `now` is null on the server / first paint, then resolves on mount and
// re-ticks each minute, so today-highlights + the now-line don't mismatch SSR
// and the current-time indicator tracks the clock.
assert.match(view, /function useNow\(\): Date \| null \{[\s\S]*?setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\)/, "useNow ticks every minute");
assert.match(view, /col\.isToday && now &&/, "the now-line only renders once `now` resolves");
// The grid sub-views derive "today" from useNow (hydration-safe + live), not a
// render-time `new Date()` (Agenda, Day, Week, Month, TimeGrid).
assert.ok((view.match(/const now = useNow\(\)/g) ?? []).length >= 5, "every grid sub-view uses useNow for today");

// ───────── Month-cell keyboard access ─────────
assert.match(view, /role="button"[\s\S]*?tabIndex=\{0\}[\s\S]*?onKeyDown=\{\(e\) => \{[\s\S]*?Enter[\s\S]*?onDayClick/, "Month day cells must be keyboard-operable");
// Month cells list a day's items in chronological order, like every other view.
assert.match(view, /list\.sort\(\(a, b\) => \(itemDate\(a\)\?\.getTime\(\) \?\? 0\) - \(itemDate\(b\)\?\.getTime\(\) \?\? 0\)\)/, "Month items are sorted by time");
// Month deadline overflow surfaces a "+N due" affordance instead of dropping silently.
assert.match(view, /\+\{dayDeadlines\.length - 2\} due/, "Month shows a deadline-overflow indicator");

// ───────── All-day overflow is reachable (was a dead no-op in Day/Week) ─────────
// AllDayStrip's "+N more" routes through onMore; Week wires it to open the day,
// Day uncaps entirely (single wide column).
assert.match(view, /onClick=\{\(\) => onMore\?\.\(col\.date\)\}/, "all-day overflow calls onMore");
assert.match(view, /<AllDayStrip columns=\{allDayColumns\} onOpenItem=\{onOpenItem\} onMore=\{onOpenDay\} \/>/, "Week wires all-day overflow to open the day");
assert.match(view, /onOpenItem=\{onOpenItem\}\s*\n\s*maxVisible=\{Infinity\}/, "Day view shows every all-day item");
assert.match(view, /const goToDay = \(day: Date\) => \{[\s\S]*?setViewMode\("day"\)/, "goToDay opens the single-day view");

// ───────── View toggle is an accessible group ─────────
assert.match(view, /role="group" aria-label="Calendar view"/, "view-mode toggle is a labelled group");
assert.match(view, /aria-pressed=\{viewMode === id\}/, "each view-mode button announces its pressed state");

// ───────── Shortcut guard ignores contenteditable ─────────
assert.match(view, /target\.isContentEditable/, "Single-key shortcuts must not fire inside contenteditable");

// ───────── No render-time array mutation in AgendaView ─────────
assert.match(view, /\[\.\.\.groupItems\]\s*\n\s*\.sort/, "AgendaView must sort a copy, not the memoized array");

// ───────── Workspace wires optimistic mutations to the inbox routes ─────────
assert.match(ws, /\/api\/inbox\/\$\{id\}\/done/, "completeInboxItem must POST the done route");
assert.match(ws, /\/api\/inbox\/\$\{id\}\/dismiss/, "dismissInboxItem must POST the dismiss route");
assert.match(ws, /\/api\/inbox\/\$\{id\}\/snooze/, "snoozeInboxItem must POST the snooze route");
assert.match(ws, /onComplete=\{completeInboxItem\}/, "CalendarView must receive onComplete");
assert.match(ws, /onDismiss=\{dismissInboxItem\}/, "CalendarView must receive onDismiss");
assert.match(ws, /onSnooze=\{snoozeInboxItem\}/, "CalendarView must receive onSnooze");

console.log("calendar-actions.test.ts: ok");

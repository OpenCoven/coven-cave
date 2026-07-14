// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = await readFile(new URL("./calendar-view.tsx", import.meta.url), "utf8");
const ws = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");

// ───────── Detail panel: real, kind-aware actions (no dead buttons) ─────────
for (const cb of ["onComplete", "onDismiss", "onSnooze"]) {
  assert.match(view, new RegExp(`${cb}\\?:\\s*\\(`), `Props must declare ${cb}`);
}
assert.match(view, /onComplete\(item\.id\); announce\([\s\S]*?\); onClose\(\)/, "Done calls onComplete(id), announces, then closes");
assert.match(view, /onDismiss\(item\.id\); announce\([\s\S]*?\); onClose\(\)/, "Dismiss calls onDismiss(id), announces, then closes");
assert.match(view, /onSnooze\(item\.id, untilIso\)/, "Snooze must call onSnooze(id, untilIso)");
assert.match(view, /import \{ SnoozeMenu \} from "@\/components\/snooze-menu"/, "Reuses the shared SnoozeMenu");
assert.match(view, /onOpen\(item\); onClose\(\)/, "Open action must invoke onOpen and close");
assert.match(view, /function openTargetLabel/, "Open label must be derived from item.link/sessionId");

// ───────── Detail panel as accessible dialog ─────────
assert.match(view, /role="dialog"/, "Detail panel must be a dialog");
assert.match(view, /aria-modal="true"/, "Detail panel must be aria-modal");
assert.match(view, /aria-labelledby=\{titleId\}/, "Detail panel must be labelled by its title");
assert.match(view, /useFocusTrap\(true, panelRef, \{ onEscape: onClose \}\)/, "Detail panel must trap focus + Escape");
// A backdrop makes aria-modal honest (calendar behind is inert) and gives the
// drawer the outside-click dismiss it was missing (was: close button/Escape only).
assert.match(
  view,
  /<div className="cave-cal-detail-backdrop" role="presentation" onClick=\{onClose\} \/>/,
  "Detail panel has a click-to-dismiss backdrop behind it",
);

// ───────── Dismissed items leave the calendar ─────────
assert.match(view, /\.filter\(\(it\) => it\.status !== "dismissed"\)/, "Dismissed items must be filtered out of the calendar");

// ───────── Overlap-aware time grid ─────────
assert.match(view, /import \{ itemDate, packEventColumnsWithOverflow, WEEK_MAX_LANES, DAY_MAX_LANES, type PlacedOverflow \} from "@\/lib\/calendar-layout"/, "TimeGrid uses the extracted lane packer");
// Lane packing is memoised per columns change (a drag re-renders the grid
// continuously) and rendered from the cached result, not recomputed inline.
assert.match(view, /const packedColumns = useMemo\(\n?\s*\(\) => columns\.map\(\(c\) => packEventColumnsWithOverflow\(c\.items, maxLanes\)\),\n?\s*\[columns, maxLanes\],?\n?\s*\)/, "Time-grid lane packing is memoised on columns");
assert.match(view, /packedColumns\[ci\]\.events\.map/, "Time-grid events render from the packed lanes");
assert.match(view, /data-calendar-event="true"/, "Events keep the roving-tabindex hook attribute");
assert.doesNotMatch(view, /minHeight: 20/, "Old fixed 20px event height must be gone");

// ───────── Hydration-safe, live-ticking "now" ─────────
// `now` is null on the server / first paint, then resolves on mount and
// re-ticks each minute, so today-highlights + the now-line don't mismatch SSR
// and the current-time indicator tracks the clock.
assert.match(view, /function useNow\(\): Date \| null \{[\s\S]*?setInterval\(\(\) => setNow\(new Date\(\)\), 60_000\)/, "useNow ticks every minute");
// (cave-6xer) The first tick is aligned to the next wall-clock minute — a
// mount-anchored interval left the now-line up to ~60s stale at each rollover.
assert.match(view, /setTimeout\(\(\) => \{[\s\S]{0,120}?\}, 60_000 - \(Date\.now\(\) % 60_000\)\)/, "useNow aligns its first tick to the wall-clock minute");
assert.match(view, /now && isSameDay\(col\.date, now\) &&/, "the now-line only renders once `now` resolves, derived from TimeGrid's own clock");
// The grid sub-views derive "today" from useNow (hydration-safe + live), not a
// render-time `new Date()` (Agenda, Day, Week, Month, TimeGrid).
assert.ok((view.match(/const now = useNow\(\)/g) ?? []).length >= 5, "every grid sub-view uses useNow for today");

// ───────── Month-cell keyboard access ─────────
// (cave-zqsj) The month is a real ARIA grid: grid → header row of
// columnheaders + a rowgroup of week rows → roving gridcells (←/→ = day,
// ↑/↓ = week). Cells previously were role="button" divs WRAPPING nested
// buttons — invalid — with no row/position semantics and no 2-D arrow nav.
assert.match(view, /role="grid"\s*\n\s*aria-label=\{`\$\{MONTHS\[anchor\.getMonth\(\)\]\} \$\{anchor\.getFullYear\(\)\}`\}/, "the month grid is a labelled ARIA grid");
assert.match(view, /<div role="row" className="mb-1 grid grid-cols-7">\s*\n\s*\{WEEKDAYS\.map[\s\S]{0,160}role="columnheader"/, "weekday headers are columnheaders in a row");
assert.match(view, /role="rowgroup"[\s\S]{0,220}\{weeks\.map\(\(week, wi\) => \(\s*\n\s*<div key=\{wi\} role="row"/, "day cells render as one ARIA row per week");
assert.match(view, /role="gridcell"\s*\n\s*data-month-cell="true"\s*\n\s*tabIndex=\{-1\}[\s\S]*?onKeyDown=\{\(e\) => \{[\s\S]*?Enter[\s\S]*?onCell/, "month day cells are roving gridcells, keyboard-operable");
assert.match(view, /itemSelector: '\[data-month-cell="true"\]',\s*\n\s*columns: 7,/, "month cells rove 2-D over a 7-column grid");
assert.match(view, /if \(anchorIndex >= 0\) setActiveIndex\(anchorIndex\)/, "the grid's tab stop follows the anchor day");
// (cave-sth7) Nested widgets stay OUT of the tab order — 42 tabbable date
// buttons (plus overflow buttons) defeated the single roving tab stop. The
// date button's open-day action moves to Shift+Enter on the cell.
assert.match(view, /<button\n\s*type="button"\n\s*tabIndex=\{-1\}\n\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); onDayClick\?\.\(day\); \}\}/, "the date-number button is tab-skipped");
assert.match(view, /if \(e\.key === "Enter" && e\.shiftKey\) \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*onDayClick\?\.\(day\);/, "Shift+Enter on the cell opens the day (keyboard path for the date button)");
assert.ok((view.match(/tabIndex=\{-1\}\n\s*onClick=\{\(e\) => \{\n\s*e\.stopPropagation\(\);\n\s*onDayClick\?\.\(day\);/g) ?? []).length >= 2, "both month overflow buttons are tab-skipped");
// (cave-zqsj) The selected/anchor day was colour-or-nothing; it now carries
// aria-selected + a ", selected" label token (mirroring the mini-month), and
// the week header names today instead of a bg tint alone.
assert.match(view, /aria-selected=\{isAnchor \|\| undefined\}/, "the anchor day is aria-selected");
assert.match(view, /\$\{isAnchor \? ", selected" : ""\}`\}/, "the anchor day is named selected");
assert.match(view, /aria-current=\{now && isSameDay\(col\.date, now\) \? "date" : undefined\}/, "the week header today-column carries aria-current");
assert.match(view, /\{now && isSameDay\(col\.date, now\) && <span className="sr-only">, today<\/span>\}/, "the week header today-column has a text token");
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
assert.match(view, /\[\.\.\.groupItems\][\s\S]*?\.sort\(\(a, b\) => \(itemDate\(a\)\?\.getTime\(\) \?\? 0\) - \(itemDate\(b\)\?\.getTime\(\) \?\? 0\)\)/, "AgendaView sorts a copy by the itemDate key (fireAt ?? firedAt ?? createdAt), not the memoized array");

// ───────── Workspace wires optimistic mutations to the inbox routes ─────────
assert.match(ws, /\/api\/inbox\/\$\{id\}\/done/, "completeInboxItem must POST the done route");
assert.match(ws, /\/api\/inbox\/\$\{id\}\/dismiss/, "dismissInboxItem must POST the dismiss route");
assert.match(ws, /\/api\/inbox\/\$\{id\}\/snooze/, "snoozeInboxItem must POST the snooze route");
assert.match(ws, /onComplete=\{completeInboxItem\}/, "CalendarView must receive onComplete");
assert.match(ws, /onDismiss=\{dismissInboxItem\}/, "CalendarView must receive onDismiss");
assert.match(ws, /onSnooze=\{snoozeInboxItem\}/, "CalendarView must receive onSnooze");

// ── Keyboard reschedule (drag is mouse-only) ────────────────────────────────
// Time-grid events nudge their start with Alt+↑/↓ (±15min, +Shift = 1h) via the
// same onReschedule path as drag; plain ↑/↓ stay with the roving focus nav.
assert.match(view, /if \(!e\.altKey \|\| \(e\.key !== "ArrowUp" && e\.key !== "ArrowDown"\)\) return;/, "events only reschedule on Alt+↑/↓");
assert.match(view, /const step = \(e\.shiftKey \? 60 : 15\) \* \(e\.key === "ArrowDown" \? 1 : -1\)/, "Alt+↑/↓ nudges ±15min, Alt+Shift by an hour");
assert.match(view, /onReschedule\(ev\.item\.id, slot\.toISOString\(\)\)/, "keyboard nudge persists through onReschedule");
// Documented in the ⌘/ Shortcuts sheet since the footer hint bar retired (§8).
const shortcutsCatalog = await readFile(new URL("../lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
assert.match(shortcutsCatalog, /Calendar: reschedule the focused event/, "the Shortcuts sheet documents the keyboard reschedule");

// ───────── a11y: announcements + non-visual affordances ─────────
assert.match(view, /import \{ useAnnouncer \} from "@\/components\/ui\/live-region"/, "CalendarView imports the shared announcer");
assert.match(view, /announce\(`\$\{label\} view, \$\{headingLabel\(\)\}`\)/, "view + period changes are announced to screen readers");
// The now-line carries a text alternative (it was a bare coloured rule before).
assert.match(view, /<span className="sr-only">Current time, \{fmtTime\(now\.toISOString\(\)\)\}<\/span>/, "the now-indicator announces the current time");
// Timed events name their time (position alone conveyed it before).
assert.match(view, /aria-label=\{`\$\{fmtTime\(\(ev\.item\.fireAt \?\? ev\.item\.firedAt\)!\)\}, \$\{ev\.item\.title\}/, "grid events include their time in the accessible name");
// Deadlines read as deadlines, not indistinguishable from events.
assert.match(view, /aria-label=\{`\$\{deadline\.title\}, task deadline/, "deadline chips are distinguishable from events non-visually");
// The jump-to-date popover traps focus + Escape (it leaked Tab before).
assert.match(view, /function MiniMonthPopover[\s\S]*?useFocusTrap\(true, ref, \{ onEscape: onClose \}\)/, "MiniMonthPopover traps focus");
// Today is conveyed with aria-current, not colour alone (month cell + mini-month).
assert.ok((view.match(/aria-current=\{isToday \? "date" : undefined\}/g) ?? []).length >= 2, "today is marked with aria-current=\"date\"");
// Horizontal arrows don't page the period out from under a focused grid event
// or month day-cell (both own their arrows via roving nav).
assert.match(view, /if \(target\.closest\('\[data-calendar-event="true"\], \[data-month-cell="true"\]'\)\) break;/, "a focused event or month cell keeps its own Arrow handling");

// ───────── Detail panel reconciles with live items (cave-latd) ─────────
// `selectedItem` is a snapshot captured at click; an effect keyed on
// [items, selectedItem?.id] adopts the fresh copy when it changes and closes
// the panel when the item is gone — so it never shows stale status/fireAt and
// never lingers over a deleted id (acting on which fires against nothing).
assert.match(
  view,
  /const fresh = items\.find\(\(it\) => it\.id === selectedItem\.id\)/,
  "the open detail panel looks up its fresh copy in the live items prop",
);
assert.match(
  view,
  /JSON\.stringify\(fresh\) !== JSON\.stringify\(selectedItem\)\) setSelectedItem\(fresh\)/,
  "the reconciler adopts the fresh item only when its content changed",
);
assert.match(
  view,
  /const fresh = items\.find[\s\S]{0,220}\} else \{\s*\n\s*setSelectedItem\(null\)/,
  "a deleted item closes the panel instead of lingering over a dead id",
);

// ───────── a11y: reschedules are announced; chips name their familiar ─────────
// (cave-nsmi) Alt+↑/↓ and drag reschedules confirm the new time via the live
// region — moving an event was silent to SR/keyboard users before.
assert.match(view, /onReschedule\(ev\.item\.id, slot\.toISOString\(\)\);\s*\n\s*announce\(`Rescheduled "\$\{ev\.item\.title\}" to \$\{fmtTime\(slot\.toISOString\(\)\)\}`\)/, "keyboard reschedule announces the new time");
assert.match(view, /announce\(`Rescheduled "\$\{dragged\?\.title \?\? "event"\}" to \$\{col\.label\}, \$\{fmtTime\(slot\.toISOString\(\)\)\}`\)/, "drag-drop reschedule announces the day and time");
// (cave-nsmi) The owning familiar was colour-only (left-border accent, WCAG
// 1.4.1) — every chip variant now names it in the accessible name / tooltip.
assert.match(view, /const FamiliarNameContext = createContext/, "familiar names are provided alongside the accent colours");
assert.match(view, /<FamiliarNameContext\.Provider value=\{nameFor\}>/, "CalendarView provides the familiar-name lookup");
assert.ok((view.match(/\{familiarName && <span className="sr-only">, \{familiarName\}<\/span>\}/g) ?? []).length >= 2, "agenda/all-day + month chips append the familiar name for AT");
assert.match(view, /task deadline\$\{done \? ", done" : ""\}\$\{familiarName \? `, \$\{familiarName\}` : ""\}/, "deadline chips name their familiar");
assert.match(view, /\$\{done \? ", done" : ""\}\$\{familiarName \? `, \$\{familiarName\}` : ""\}`\}\n\s*title=\{`\$\{familiarName \? `\$\{ev\.item\.title\} — \$\{familiarName\}` : ev\.item\.title\}/, "grid events name their familiar in label + tooltip");

// ── Narrow split panes (cave-87zv) ───────────────────────────────────────────
// Week view needs ~7 usable columns; below 560px of container width it falls
// back to the DAY presentation without clobbering the user's stored week
// choice. Everything presentation-driven (render switch, heading, navigate
// step, announcements) reads effectiveView; the toggle keeps viewMode.
assert.match(view, /const effectiveView: ViewMode = viewMode === "week" && narrowPane \? "day" : viewMode/, "week falls back to day rendering in narrow panes");
assert.match(view, /setNarrowPane\(w > 0 && w < 560\)/, "the fallback keys on container width, not viewport");
assert.match(view, /\{effectiveView === "week" && \(/, "the render switch reads the effective view");
assert.match(view, /if \(effectiveView === "week"\) return addDays\(prev, dir \* 7\)/, "navigate steps by the VISIBLE unit");
assert.match(view, /aria-pressed=\{viewMode === id\}/, "the view toggle still reflects the user's stored choice");

console.log("calendar-actions.test.ts: ok");

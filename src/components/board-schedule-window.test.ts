import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const boardTypes = readFileSync("src/lib/cave-board-types.ts", "utf8");
const boardStore = readFileSync("src/lib/cave-board.ts", "utf8");
const createRoute = readFileSync("src/app/api/board/route.ts", "utf8");
const updateRoute = readFileSync("src/app/api/board/[id]/route.ts", "utf8");
const modal = readFileSync("src/components/new-card-modal.tsx", "utf8");
const inspector = readFileSync("src/components/board-inspector.tsx", "utf8");
const kanban = readFileSync("src/components/board-kanban.tsx", "utf8");
const table = readFileSync("src/components/board-table.tsx", "utf8");
const stack = readFileSync("src/components/board-card-stack.tsx", "utf8");
const view = readFileSync("src/components/board-view.tsx", "utf8");
const gantt = readFileSync("src/components/board-gantt.tsx", "utf8");
const styles = readFileSync("src/styles/board.css", "utf8");

assert.match(boardTypes, /startDate\?: string \| null/, "Task cards persist an optional start date");
assert.match(boardTypes, /endDate\?: string \| null/, "Task cards persist an optional end date");
assert.match(boardStore, /function normalizeBoardDate/, "Task persistence normalizes schedule dates");
assert.match(boardStore, /startDate: normalizeBoardDate\(input\.startDate\)/, "Task creation stores normalized start dates");
assert.match(boardStore, /endDate: normalizeBoardDate\(input\.endDate\)/, "Task creation stores normalized end dates");
assert.match(boardStore, /startDate: "startDate" in patch \? normalizeBoardDate\(patch\.startDate\) : current\.startDate \?\? null/, "Task updates patch normalized start dates");
assert.match(boardStore, /endDate: "endDate" in patch \? normalizeBoardDate\(patch\.endDate\) : current\.endDate \?\? null/, "Task updates patch normalized end dates");
assert.match(createRoute, /startDate\?: string \| null/, "Create API accepts startDate");
assert.match(createRoute, /endDate\?: string \| null/, "Create API accepts endDate");
assert.match(updateRoute, /startDate: string \| null/, "Update API accepts startDate");
assert.match(updateRoute, /endDate: string \| null/, "Update API accepts endDate");

assert.match(modal, /startDate,\s*setStartDate/, "New task modal tracks start date");
assert.match(modal, /endDate,\s*setEndDate/, "New task modal tracks end date");
assert.match(modal, /<Field label="Start date">[\s\S]*?type="date"[\s\S]*?value=\{startDate\}/, "New task modal renders a start-date input");
assert.match(modal, /<Field label="End date">[\s\S]*?type="date"[\s\S]*?value=\{endDate\}/, "New task modal renders an end-date input");
assert.match(modal, /startDate: startDate \|\| null/, "New task modal includes startDate in create payload");
assert.match(modal, /endDate: endDate \|\| null/, "New task modal includes endDate in create payload");
assert.match(inspector, /<div className="board-drawer-field-label">Start date<\/div>[\s\S]*?type="date"[\s\S]*?value=\{card\.startDate \?\? ""\}/, "Inspector exposes a start-date editor");
assert.match(inspector, /<div className="board-drawer-field-label">End date<\/div>[\s\S]*?type="date"[\s\S]*?value=\{card\.endDate \?\? ""\}/, "Inspector exposes an end-date editor");
assert.match(inspector, /onPatch\(card\.id, \{ startDate: e\.target\.value \|\| null \}\)/, "Inspector patches startDate");
assert.match(inspector, /onPatch\(card\.id, \{ endDate: e\.target\.value \|\| null \}\)/, "Inspector patches endDate");

assert.match(kanban, /scheduleLabel\(card\.startDate, card\.endDate\)[\s\S]*?board-kanban-card-chip--schedule/, "Kanban cards show schedule chips");
assert.match(table, /key: "startDate"[\s\S]*?label: "Start"/, "Table has a start-date column");
assert.match(table, /key: "endDate"[\s\S]*?label: "End"/, "Table has an end-date column");
assert.match(table, /formatBoardDate\(card\.startDate\)/, "Table renders formatted start dates");
assert.match(table, /formatBoardDate\(card\.endDate\)/, "Table renders formatted end dates");
assert.match(stack, /scheduleLabel\(card\.startDate, card\.endDate\)[\s\S]*?board-card-stack__row-schedule/, "Mobile task rows show schedule windows");
assert.match(view, /type ViewMode = "kanban" \| "table" \| "gantt"/, "BoardView includes Gantt as the third view mode");
assert.match(view, /<BoardGantt cards=\{filtered\}/, "BoardView renders the Gantt view");
assert.match(gantt, /export function BoardGantt/, "BoardGantt component exists");
assert.match(gantt, /startDate/, "BoardGantt reads start dates");
assert.match(gantt, /endDate/, "BoardGantt reads end dates");
assert.match(gantt, /board-gantt-row__bar/, "BoardGantt renders timeline bars");
assert.match(styles, /\.board-gantt/, "Board Gantt styles are defined");

// Gantt bars can be RESIZED from either edge to set a new start / end date
// independently (in addition to dragging the whole bar to move both).
assert.match(gantt, /type DragMode = "move" \| "resize-start" \| "resize-end"/, "Gantt drag has move + resize modes");
assert.match(gantt, /function clampDelta\(mode: DragMode, delta: number, dur: number\)/, "clamp helper bounds a resize so it can't invert the bar");
assert.match(gantt, /if \(mode === "resize-start"\) return Math\.min\(delta, dur - 1\)/, "resize-start can't drag the start past the end");
assert.match(gantt, /if \(mode === "resize-end"\) return Math\.max\(delta, -\(dur - 1\)\)/, "resize-end can't drag the end past the start");
// The left edge patches startDate, the right edge patches endDate.
assert.match(gantt, /d\.mode === "resize-start"[\s\S]*?\{\s*patch\.startDate = newStart;/, "resize-start persists a new startDate");
assert.match(gantt, /else \{\s*patch\.endDate = newEnd;/, "resize-end persists a new endDate");
// Each non-milestone bar renders a grab handle at each edge.
assert.match(gantt, /const resizeHandle = \(which: "start" \| "end"\)/, "bars render edge resize handles");
assert.match(gantt, /beginDrag\(e, row\.rowId, which === "start" \? "resize-start" : "resize-end"\)/, "edge handles start a resize drag");
assert.match(gantt, /\{draggable \? resizeHandle\("start"\) : null\}[\s\S]*?\{draggable \? resizeHandle\("end"\) : null\}/, "both edge handles render inside the bar");
assert.match(styles, /\.cg-bar__resize \{/, "resize-handle styles exist");
assert.match(styles, /cursor: ew-resize/, "resize handles show the horizontal-resize cursor");

// The timeline anchors on the earliest task itself (flush left) rather than
// snapping back to that week's Monday, which left a near-empty leading column.
assert.match(
  gantt,
  /const rangeStart = new Date\(Date\.UTC\(min\.getUTCFullYear\(\), min\.getUTCMonth\(\), min\.getUTCDate\(\)\)\)/,
  "the Gantt window starts on the earliest task so the first bar is flush left",
);
assert.doesNotMatch(gantt, /const rangeStart = startOfWeekMon\(min\)/, "the leading Monday-snap is gone");
assert.match(gantt, /width: Math\.min\(7, totalDays - i\)/, "the trailing week column is clamped to the range");

// The Owner column was removed from every Gantt mode — familiar bar colour now
// carries the owner cue. No header, per-row cell, grid track, flag, or row field
// for the owner column remains.
assert.doesNotMatch(gantt, /hideOwner/, "the hideOwner flag is gone");
assert.doesNotMatch(gantt, /cg-c-owner/, "no Owner column header/cell remains in the markup");
assert.doesNotMatch(gantt, /cg--no-owner/, "the no-owner modifier class is gone");
assert.doesNotMatch(gantt, /row\.owner|owner: ownerName/, "GanttRow no longer carries an owner field");
assert.doesNotMatch(styles, /cg-c-owner|cg--no-owner/, "Owner column styles are removed");
assert.match(styles, /\.cg-left \{[\s\S]*?grid-template-columns: 300px 58px 58px 26px;/, "the left table uses the four-column (ownerless) layout with a wide task column");

// By-familiar grouping colour-codes bars by familiar.
assert.match(gantt, /const familiarColor = \(id: string \| null\): string \| undefined =>/, "a per-familiar colour helper exists");
assert.match(gantt, /color: byFamiliar \? \(familiarColor\(card\.familiarId\) \?\? "var\(--text-muted\)"\) : undefined/, "rows carry a familiar colour (or neutral fallback) only in by-familiar mode");
assert.match(gantt, /\.\.\.\(row\.color \? \{ background: row\.color \} : \{\}\)/, "the bar paints the familiar colour when present");

// The status legend (shown when NOT grouping by familiar) uses the board's
// actual statuses (no invented "In Progress"/"At Risk"): Running, Blocked, Done
// map 1:1; the shared colour is labelled with the three statuses it represents.
assert.match(gantt, /cg-sw--in-progress" aria-hidden \/>Running</, "in-progress swatch is labelled Running");
assert.match(gantt, /cg-sw--at-risk" aria-hidden \/>Blocked</, "at-risk swatch is labelled Blocked");
assert.match(gantt, /cg-sw--pending" aria-hidden \/>Backlog · Inbox · Review</, "pending swatch lists the statuses it bundles");
assert.doesNotMatch(gantt, />In Progress</, "the invented 'In Progress' label is gone");
assert.doesNotMatch(gantt, />At Risk</, "the invented 'At Risk' label is gone");

// The legend swaps to per-familiar swatches when grouping by familiar. The Owner
// column was removed (#1671), so the gate is now `groupMode === "familiar"`
// directly rather than the old `hideOwner` alias.
assert.match(gantt, /\{groupMode === "familiar" \? \(/, "the legend is conditional on the by-familiar mode");
assert.match(gantt, /groups\.map\(\(g\) => \(/, "the legend renders a swatch per familiar group");
assert.match(gantt, /background: familiarColor\(g\.key === "__unassigned__" \? null : g\.key\) \?\? "var\(--text-muted\)"/, "familiar legend swatches match the bar colours");

// The timeline-zoom control reads as a zoom: a magnifier glyph + compact
// single-letter buttons (D/W/M), with the full word + what it does in the
// title/aria so it's clear and narrow (not a "Day/Week/Month" range filter).
assert.match(gantt, /className="cg-zoom-cell"[\s\S]{0,80}name="ph:magnifying-glass"/, "the zoom control shows a magnifier glyph");
assert.match(gantt, /\["day", "Day", "D",/, "day zoom carries a short label + hint");
assert.match(gantt, /\["month", "Month", "M",/, "month zoom carries a short label + hint");
assert.match(gantt, /aria-label=\{`Zoom: \$\{full\}`\}/, "each zoom button announces the full word");
assert.match(gantt, /title=\{`\$\{full\} — \$\{hint\}`\}/, "each zoom button explains what the scale does");
assert.match(gantt, />\s*\{short\}\s*<\/button>/, "buttons render the compact single-letter label");
assert.match(styles, /\.board-group-toggle \.cg-zoom-cell/, "the zoom glyph cell is styled to match the segmented control");

console.log("board-schedule-window.test.ts: ok");

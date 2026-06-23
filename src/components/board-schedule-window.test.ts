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

// Grouping by familiar drops the redundant Owner column (header + cells + grid).
assert.match(gantt, /const hideOwner = groupMode === "familiar"/, "owner column is hidden when grouping by familiar");
assert.match(gantt, /className=\{`cg\$\{hideOwner \? " cg--no-owner" : ""\}`\}/, "the no-owner modifier class is applied to the grid");
assert.match(gantt, /\{!hideOwner && <span className="cg-c-owner">Owner<\/span>\}/, "the Owner header is conditional");
assert.match(gantt, /\{!hideOwner && <span className="cg-c-owner">\{row\.owner\}<\/span>\}/, "the per-row owner cell is conditional");
assert.match(styles, /\.cg--no-owner \.cg-left \{ flex-basis: 332px; grid-template-columns: 190px 58px 58px 26px; \}/, "the no-owner layout drops the owner column width");
assert.match(styles, /\.cg--no-owner \.cg-grouprow \.cg-left \{ grid-template-columns: auto 1fr auto; \}/, "group rows keep their own three-column template");

console.log("board-schedule-window.test.ts: ok");

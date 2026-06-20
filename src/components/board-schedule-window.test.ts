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

console.log("board-schedule-window.test.ts: ok");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./board-view-display.tsx", import.meta.url), "utf8");
assert.match(source, /export type ViewMode = "kanban" \| "table" \| "gantt"/, "view modes have one display-model owner");
assert.match(source, /export function loadBoardPreference/, "stored view preferences are validated in one helper");
assert.match(source, /export function BoardKanbanSkeleton/, "the initial Kanban preview is a separate display primitive");
assert.match(source, /aria-hidden/, "the decorative loading preview remains hidden from assistive technology");

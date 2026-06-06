// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  cardMatchesBoardSearch,
  parseBoardSearchQuery,
} from "./board-search.ts";

const card = {
  id: "card-1",
  title: "Board card drag between columns",
  notes: "Use dnd-kit or native drag events.",
  status: "inbox",
  priority: "medium",
  familiarId: "cody",
  sessionId: "session-1",
  labels: ["ux", "board", "drag"],
};

const familiarsById = new Map([
  ["cody", { id: "cody", display_name: "Cody" }],
]);

assert.deepEqual(parseBoardSearchQuery('drag label:ux status:inbox -priority:urgent'), [
  { key: null, value: "drag", negated: false },
  { key: "label", value: "ux", negated: false },
  { key: "status", value: "inbox", negated: false },
  { key: "priority", value: "urgent", negated: true },
]);

assert.equal(cardMatchesBoardSearch(card, "", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "drag ux", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "label:ux status:inbox familiar:cody", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, 'title:"between columns" -label:backend', familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "is:open", familiarsById), true);
assert.equal(cardMatchesBoardSearch({ ...card, status: "done" }, "is:closed", familiarsById), true);
assert.equal(cardMatchesBoardSearch(card, "is:closed", familiarsById), false);
assert.equal(cardMatchesBoardSearch(card, "label:backend", familiarsById), false);
assert.equal(cardMatchesBoardSearch(card, "priority:urgent", familiarsById), false);

const boardView = await readFile(new URL("../components/board-view.tsx", import.meta.url), "utf8");
assert.match(boardView, /board-search-input/, "Tasks header should expose one search input");
assert.doesNotMatch(boardView, /label="Labels"/, "Tasks header should not show Labels as a separate filter control");
assert.doesNotMatch(boardView, /allLabels/, "Tasks view should not build a dedicated labels filter row");

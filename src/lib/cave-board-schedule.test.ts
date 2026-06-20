import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-schedule-"));
process.env.HOME = tmpHome;

const board = await import("./cave-board.ts");

const card = await board.createCard({
  title: "Timeline card",
  startDate: "2026-06-20",
  endDate: "2026-06-24",
});

assert.equal(card.startDate, "2026-06-20", "createCard stores a valid start date");
assert.equal(card.endDate, "2026-06-24", "createCard stores a valid end date");

const updated = await board.updateCard(card.id, {
  startDate: "2026-06-21",
  endDate: "2026-06-25",
});
assert.equal(updated?.startDate, "2026-06-21", "updateCard patches a start date");
assert.equal(updated?.endDate, "2026-06-25", "updateCard patches an end date");

const cleared = await board.updateCard(card.id, { startDate: null, endDate: null });
assert.equal(cleared?.startDate, null, "updateCard clears start date to null");
assert.equal(cleared?.endDate, null, "updateCard clears end date to null");

const invalid = await board.createCard({
  title: "Invalid dates",
  startDate: "not-a-date",
  endDate: "2026-02-31",
});
assert.equal(invalid.startDate, null, "invalid start dates normalize to null");
assert.equal(invalid.endDate, null, "invalid end dates normalize to null");

const reloaded = await board.loadBoard();
assert.equal(reloaded.cards.find((c) => c.id === card.id)?.startDate, null, "cleared start date persisted");
assert.equal(reloaded.cards.find((c) => c.id === card.id)?.endDate, null, "cleared end date persisted");
assert.equal(reloaded.cards.find((c) => c.id === invalid.id)?.startDate, null, "invalid start date persisted as null");
assert.equal(reloaded.cards.find((c) => c.id === invalid.id)?.endDate, null, "invalid end date persisted as null");

console.log("cave-board-schedule.test.ts OK");

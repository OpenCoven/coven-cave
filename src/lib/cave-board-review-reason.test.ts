import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// A task's lifecycleReason explains its latest lifecycle change. Enhance also
// records a familiar's review reason when the task stays where it is (#5684);
// without that, every task a familiar kept open showed no reason at all.
const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-review-reason-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

const created = await board.createCard({ title: "Review me" });
const moved = await board.updateCard(created.id, {
  status: "review",
  lifecycle: "review",
  lifecycleReason: "Draft is up for review.",
});
assert.equal(moved?.lifecycleReason, "Draft is up for review.", "a lifecycle change records its reason");

// An ordinary write with an unchanged lifecycle keeps the change's reason.
const edited = await board.updateCard(created.id, {
  notes: "Edited notes",
  lifecycleReason: "An unrelated edit's reason",
});
assert.equal(edited?.lifecycleReason, "Draft is up for review.", "ordinary writes keep the lifecycle change's reason");

// A review write records the familiar's current reason in place.
const reviewed = await board.updateCard(created.id, {
  lifecycleReason: "Still waiting on Val's read of sections 3 to 5.",
}, { automated: true, reviewReason: true });
assert.equal(reviewed?.lifecycle, "review", "a review write does not move the task");
assert.equal(reviewed?.lifecycleReason, "Still waiting on Val's read of sections 3 to 5.", "a review write records the review reason");

// An empty review reason never erases the one on record.
const blank = await board.updateCard(created.id, { lifecycleReason: "   " }, { automated: true, reviewReason: true });
assert.equal(blank?.lifecycleReason, "Still waiting on Val's read of sections 3 to 5.", "a blank review reason is ignored");

const reloaded = await board.loadBoard();
assert.equal(
  reloaded.cards.find((card) => card.id === created.id)?.lifecycleReason,
  "Still waiting on Val's read of sections 3 to 5.",
  "the review reason persists",
);

await rm(tmpHome, { recursive: true, force: true });

console.log("cave-board-review-reason.test.ts OK");

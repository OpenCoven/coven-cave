// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Salem "Save to Board" seeds a card with checklist steps. createCard must
// accept `steps: {text}[]` and round-trip them into CardStep[]. Isolated to a
// temp home so it never touches the real ~/.coven/cave-board.json.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-steps-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

// SAFETY GATE — never mutate a real board.
assert.ok(
  board.BOARD_PATH.startsWith(tmpHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

const card = await board.createCard({
  title: "Salem path: Run your first familiar in Cave",
  labels: ["salem", "happy-path", "first-familiar-cave"],
  links: ["https://docs.opencoven.ai/cave"],
  steps: [
    { text: "Install the Coven CLI" },
    { text: "Start the Coven daemon" },
    { text: "   " }, // whitespace-only → dropped
    { text: "Create your first familiar" },
  ],
});

assert.equal(card.steps.length, 3, "whitespace-only steps are dropped");
assert.equal(card.steps[0].text, "Install the Coven CLI", "step text round-trips");
assert.equal(card.steps[0].done, false, "new steps start not-done");
assert.ok(card.steps[0].id && card.steps[0].addedAt, "steps get an id + addedAt");
assert.deepEqual(card.labels, ["salem", "happy-path", "first-familiar-cave"], "labels round-trip");

// Reload from disk to confirm the steps persisted.
const reloaded = (await board.loadBoard()).cards.find((c) => c.id === card.id);
assert.equal(reloaded?.steps.length, 3, "steps persisted to the board file");

// A card created without steps stays empty (no regression).
const plain = await board.createCard({ title: "no steps" });
assert.deepEqual(plain.steps, [], "cards without steps have an empty checklist");

await rm(tmpHome, { recursive: true, force: true });
console.log("cave-board-steps.test.ts OK");

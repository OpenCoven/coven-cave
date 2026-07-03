// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// updateCard applies intent ops against the CURRENT card under the board lock —
// the regression the 2026-07-02 board audit flagged: full-array PATCHes computed
// from stale render state silently clobbered concurrent element edits. Isolated
// to a temp home so it never touches the real ~/.coven/cave-board.json.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-ops-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

assert.ok(
  board.BOARD_PATH.startsWith(tmpHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

const card = await board.createCard({
  title: "Ops under the lock",
  labels: ["seed"],
  steps: [{ text: "one" }, { text: "two" }],
});
const [s1, s2] = card.steps;

// ── The clobber regression: two "concurrent" op patches both survive ─────────
// (withBoardLock serializes them; each resolves against the then-current card.)
await Promise.all([
  board.updateCard(card.id, { ops: { stepOps: [{ op: "toggle", id: s1.id }] } }),
  board.updateCard(card.id, { ops: { stepOps: [{ op: "add", text: "three" }] } }),
  board.updateCard(card.id, { ops: { labelOps: [{ op: "add", value: "urgent" }] } }),
]);
let stored = (await board.loadBoard()).cards.find((c) => c.id === card.id);
assert.equal(stored.steps.length, 3, "the concurrent add survives the toggle");
assert.equal(stored.steps.find((s) => s.id === s1.id).done, true, "the toggle survives the add");
assert.deepEqual(stored.labels, ["seed", "urgent"], "the label add survives both");

// ── Ops flow through the SAME normalization as plain patches ─────────────────
const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const withAtt = await board.updateCard(card.id, {
  ops: { attachmentOps: [{ op: "add", attachments: [
    { name: "spec.md", type: "text/markdown", size: 4, text: "# s" },
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 68, dataUrl: pngDataUrl },
  ] }] },
});
assert.equal(withAtt.attachments.length, 2, "attachment ops add");
assert.equal(withAtt.attachments[1].dataUrl, undefined, "op-added images stored lean (dataUrl stripped)");

const removed = await board.updateCard(card.id, {
  ops: { attachmentOps: [{ op: "remove", name: "shot.png" }] },
});
assert.deepEqual(removed.attachments.map((a) => a.name), ["spec.md"], "attachment ops remove by name");

// ── Ops and plain fields combine in one PATCH ─────────────────────────────────
const combo = await board.updateCard(card.id, {
  title: "Renamed via combo",
  ops: { stepOps: [{ op: "remove", id: s2.id }] },
});
assert.equal(combo.title, "Renamed via combo");
assert.equal(combo.steps.some((s) => s.id === s2.id), false, "op applied alongside the plain field");

// ── Back-compat: full-array patches still replace wholesale ───────────────────
const replaced = await board.updateCard(card.id, { steps: [] });
assert.deepEqual(replaced.steps, [], "legacy full-array patch replaces (enrich-steps relies on this)");

await rm(tmpHome, { recursive: true, force: true });
console.log("cave-board-ops: ok");

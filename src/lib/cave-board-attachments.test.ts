// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Home-composer "Task" destination carries staged files onto the created card.
// createCard must accept `attachments` and store them LEAN — inlined text is
// kept, but the heavy base64 image `dataUrl` is stripped so cave-board.json
// doesn't bloat. Isolated to a temp home so it never touches the real board.

const tmpHome = await mkdtemp(path.join(tmpdir(), "cave-board-attach-"));
process.env.HOME = tmpHome;
process.env.COVEN_HOME = path.join(tmpHome, ".coven");

const board = await import("./cave-board.ts");

// SAFETY GATE — never mutate a real board.
assert.ok(
  board.BOARD_PATH.startsWith(tmpHome),
  `refusing to run: BOARD_PATH (${board.BOARD_PATH}) is not under the temp home`,
);

// A 1x1 transparent PNG data URL — a valid, small image payload.
const pngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const card = await board.createCard({
  title: "Ship the attachment carry",
  attachments: [
    { name: "spec.md", type: "text/markdown", size: 12, text: "# hello" },
    { name: "shot.png", type: "image/png", mimeType: "image/png", size: 68, dataUrl: pngDataUrl },
  ],
});

assert.ok(Array.isArray(card.attachments), "card carries an attachments array");
assert.equal(card.attachments.length, 2, "both staged attachments round-trip");

const [doc, img] = card.attachments;
assert.equal(doc.name, "spec.md", "text attachment name round-trips");
assert.equal(doc.text, "# hello", "text attachment content is preserved on the card");

assert.equal(img.name, "shot.png", "image attachment name round-trips");
assert.equal(img.dataUrl, undefined, "image base64 dataUrl is stripped — board JSON stays lean");
assert.equal(img.mimeType, undefined, "image mimeType is stripped alongside the dataUrl");
assert.equal(img.type, "image/png", "the lightweight `type` is retained so the icon still resolves");

// Reload from disk — attachments survive the load/backfill round-trip.
const reloaded = await board.loadBoard();
const stored = reloaded.cards.find((c) => c.id === card.id);
assert.ok(stored, "created card is found after reload");
assert.equal(stored.attachments.length, 2, "attachments persist across reload");
assert.equal(stored.attachments[1].dataUrl, undefined, "stored image stays lean after reload");

// A card created without attachments must NOT sprout an empty array.
const bare = await board.createCard({ title: "No files here" });
assert.equal(bare.attachments, undefined, "cards with no staged files omit the attachments field");

// ── Inspector edit path: updateCard applies the same lean pipeline ──────────
// Add a fresh file (with a fat image dataUrl) to a card that had none — it must
// be stored lean, exactly like createCard.
const added = await board.updateCard(bare.id, {
  attachments: [
    { name: "later.txt", type: "text/plain", size: 5, text: "hi" },
    { name: "diagram.png", type: "image/png", mimeType: "image/png", size: 68, dataUrl: pngDataUrl },
  ],
});
assert.ok(added, "updateCard returns the updated card");
assert.equal(added.attachments.length, 2, "updateCard stores added attachments");
assert.equal(added.attachments[0].text, "hi", "added text attachment keeps its content");
assert.equal(added.attachments[1].dataUrl, undefined, "updateCard strips the added image dataUrl lean");

// Remove one attachment (PATCH the filtered array).
const removed = await board.updateCard(bare.id, {
  attachments: added.attachments.filter((a) => a.name !== "diagram.png"),
});
assert.equal(removed.attachments.length, 1, "updateCard removes an attachment");
assert.equal(removed.attachments[0].name, "later.txt", "the surviving attachment is the right one");

// A patch that does NOT mention attachments leaves them untouched.
const untouched = await board.updateCard(bare.id, { title: "Renamed" });
assert.equal(untouched.attachments.length, 1, "an unrelated patch preserves attachments");

// Clearing to an empty array drops the field entirely.
const cleared = await board.updateCard(bare.id, { attachments: [] });
assert.equal(cleared.attachments, undefined, "clearing to [] removes the attachments field");

await rm(tmpHome, { recursive: true, force: true });
console.log("cave-board-attachments: ok");

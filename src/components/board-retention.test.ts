import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Client half of the Board undo contract (cave-xddxs): undo goes through the
// restore endpoint instead of re-creating cards. Board cards no longer carry a
// Beads link (#5566), so both removal paths delete what was asked.

const view = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/board/[id]/route.ts", import.meta.url), "utf8");
const restore = await readFile(new URL("../app/api/board/restore/route.ts", import.meta.url), "utf8");

// ── Both removal paths delete what was asked ────────────────────────────────
assert.doesNotMatch(view, /beadRef|Unlink to delete|linked task/, "no card is held back by a Beads link");
assert.match(view, /const snapshot = doneCards;/, "Clear done removes every done card");
assert.match(view, /const toRemove = requested;/, "bulk delete removes every requested card");

// ── Undo restores rather than re-creates ────────────────────────────────────
assert.match(
  view,
  /fetch\("\/api\/board\/restore", \{[\s\S]{0,200}?body: JSON\.stringify\(\{ cards: banner\.snapshot \}\)/,
  "undo posts the stored snapshots to the restore endpoint",
);
// The old behaviour, and the whole defect: re-creating through the create route
// minted a new id and dropped most fields.
assert.doesNotMatch(
  view,
  /handleUndoClear[\s\S]{0,1200}?fetch\("\/api\/board", \{\s*\n?\s*method: "POST"/,
  "undo no longer re-creates cleared cards through the create route",
);

// ── The server deletes without a link guard ─────────────────────────────────
assert.match(route, /const outcome = await deleteCard\(id\);/, "DELETE removes the card");
assert.doesNotMatch(route, /linked_bead_requires_unlink|unlink/, "there is no unlink step");

// ── Restore never clobbers ──────────────────────────────────────────────────
assert.match(restore, /restoreCards/, "the restore route delegates to the store");
assert.match(
  restore,
  /skipped/,
  "and reports ids it declined to overwrite rather than silently winning",
);

console.log("board-retention.test.ts ok");

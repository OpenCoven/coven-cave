import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Client half of the Board mirror-retention contract (cave-xddxs). The STORE is
// the retention boundary — see src/lib/cave-board-retention.test.ts, which
// exercises the real guard. These assertions pin the experience around it: both
// removal paths preserve linked mirrors and say so, and undo goes through the
// restore endpoint instead of re-creating cards.

const view = await readFile(new URL("./board-view.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/board/[id]/route.ts", import.meta.url), "utf8");
const restore = await readFile(new URL("../app/api/board/restore/route.ts", import.meta.url), "utf8");

// ── Both removal paths preserve linked mirrors ──────────────────────────────
// Clear done and bulk delete are separate code paths; a fix to one is not a fix
// to the other, so each is pinned.
assert.match(
  view,
  /const preserved = doneCards\.filter\(\(c\) => c\.beadRef\);\s*\n\s*const snapshot = doneCards\.filter\(\(c\) => !c\.beadRef\);/,
  "Clear done splits linked mirrors out of the delete set",
);
assert.match(
  view,
  /const preserved = requested\.filter\(\(c\) => c\.beadRef\);\s*\n\s*const toRemove = requested\.filter\(\(c\) => !c\.beadRef\);/,
  "bulk delete splits linked mirrors out of the delete set",
);
// Silently keeping them would be its own bug: the operator asked for a deletion
// and must be told which ones did not happen.
assert.match(view, /Kept \$\{preserved\.length\} linked/, "the preserved count is announced");

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

// ── The server is the boundary ──────────────────────────────────────────────
assert.match(
  route,
  /linked_bead_requires_unlink/,
  "DELETE refuses a linked card with a named error",
);
assert.match(route, /\{ status: 409 \}/, "and refuses it with 409, not a generic failure");
assert.match(
  route,
  /searchParams\.get\("unlink"\) === "1"/,
  "an explicit unlink flag is the only way past the guard",
);

// ── Restore never clobbers ──────────────────────────────────────────────────
assert.match(restore, /restoreCards/, "the restore route delegates to the store");
assert.match(
  restore,
  /skipped/,
  "and reports ids it declined to overwrite rather than silently winning",
);

console.log("board-retention.test.ts ok");

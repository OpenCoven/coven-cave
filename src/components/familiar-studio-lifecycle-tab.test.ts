// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-lifecycle-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLifecycleTab/);
assert.match(source, /archiveFamiliar/);
assert.match(source, /unarchiveFamiliar/);
assert.match(source, /clearAllFamiliarOverrides/);
assert.match(source, /clearGlyphOverride/);
assert.match(source, /clearFamiliarImage/);
// The roster (Active/Archived reorder + archive) renders here unconditionally —
// it's the manager the standalone "Manage familiars" page used to host, now part
// of Settings → Familiars (no more listView gate).
assert.match(source, /<h3 className="familiar-studio-lifecycle__heading">Active<\/h3>/, "the Lifecycle tab shows the active roster");
assert.match(source, /Archived/, "and the archived roster");
assert.match(source, /setFamiliarOrder/, "reordering the roster persists familiar order");
assert.match(source, /canMoveUp/, "Rows expose canMoveUp prop for disabled-edge state");
assert.match(source, /canMoveDown/, "Rows expose canMoveDown prop for disabled-edge state");
assert.match(source, /ph:arrow-up-bold/, "Move-up icon is wired");
assert.match(source, /ph:arrow-down-bold/, "Move-down icon is wired");

// The active roster is also drag-reorderable (dnd-kit), alongside the arrows.
assert.match(source, /DndContext/, "active roster is wrapped in a DndContext");
assert.match(source, /SortableContext/, "active rows are sortable");
assert.match(source, /useSortable/, "each active row hooks the sortable transform");
assert.match(source, /ph:dots-six-vertical/, "each active row exposes a drag grip");
assert.match(source, /arrayMove\(ids, oldIndex, newIndex\)/, "drag reorder moves the id then persists via setFamiliarOrder");

// The roster order here is distinct from the avatar-strip pin order in
// Appearance — the hint cross-links so users find both (2026-07-06).
assert.match(source, /avatar strip's pinned order/, "lifecycle hint disambiguates roster order from pin order");
assert.match(source, /window\.location\.hash = "appearance"/, "lifecycle hint links to Appearance");

// ── Dual-track lifecycle (cave-ykwk): Remove = undo-safe detach ─────────────
// Archive stays the reversible hide; Remove detaches a mistaken binding. These
// pins hold the safety-critical seams of that flow.

// Remove defers through the shared undo hook — nothing hits the server while
// the toast's undo window is open.
assert.match(source, /import \{ useUndoDelete \} from "@\/lib\/use-undo-delete"/);
assert.match(source, /import \{ UndoToast \} from "@\/components\/ui\/undo-toast"/);
assert.match(source, /useUndoDelete<ResolvedFamiliar>/);
assert.match(
  source,
  /fetch\(`\/api\/familiars\/\$\{encodeURIComponent\(f\.id\)\}`, \{ method: "DELETE" \}\)/,
  "remove commits as DELETE /api/familiars/[id]",
);

// Every row (active AND archived) exposes Remove as a distinct action beside
// Archive/Unarchive, with an inline confirm strip that spells out detach
// semantics: what is cleared vs. what survives, plus the active-session warning.
assert.match(source, /aria-label=\{`Remove \$\{familiar\.display_name\}`\}/);
assert.match(source, /aria-label=\{`Archive \$\{familiar\.display_name\}`\}/);
assert.match(source, /roster entry and agent binding/, "confirm copy explains what is cleared");
assert.match(source, /stay on\s+your disk/, "confirm copy explains what survives");
assert.match(source, /active_sessions/, "confirm warns using the daemon session count");
assert.match(source, /keep\s+running until they finish/);
assert.match(source, /Archive hides a familiar/, "archive-vs-remove semantics are explained in-product");

// Restore path: Recently removed shelf + POST restore + announcer feedback,
// then a roster re-fetch threaded from Settings.
assert.match(source, /Recently removed/);
assert.match(source, /fetch\("\/api\/familiars\/removed"/);
assert.match(source, /useAnnouncer/);
assert.match(source, /"assertive"/, "failures announce assertively");
assert.match(source, /onRosterChanged\?\.\(\)/);

// Remove never touches the client-side archive store — archive and remove are
// independent tracks, so an archived familiar restores as archived.
{
  const removeFlow = source.slice(
    source.indexOf("function performRemove"),
    source.indexOf("async function restoreRemoved"),
  );
  assert.ok(removeFlow.length > 0, "performRemove flow present before restoreRemoved");
  assert.doesNotMatch(removeFlow, /archiveFamiliar|unarchiveFamiliar/, "remove leaves the archive store alone");
}

// ── Route seams ──────────────────────────────────────────────────────────────
{
  const path = await import("node:path");
  const apiDir = path.join(process.cwd(), "src", "app", "api", "familiars");
  const deleteRoute = readFileSync(path.join(apiDir, "[id]", "route.ts"), "utf8");
  const removedRoute = readFileSync(path.join(apiDir, "removed", "route.ts"), "utf8");
  const rosterRoute = readFileSync(path.join(apiDir, "route.ts"), "utf8");

  // Tombstone-before-mutate: the snapshot must land on disk before
  // familiars.toml or cave-config.json are touched — never destroy the only
  // copy of the entry.
  const tombstoneAt = deleteRoute.indexOf("await addTombstone(");
  assert.ok(tombstoneAt > 0, "delete route snapshots a tombstone");
  assert.ok(
    tombstoneAt < deleteRoute.indexOf("writeFile(familiarsToml"),
    "tombstone is written before familiars.toml is mutated",
  );
  assert.ok(
    tombstoneAt < deleteRoute.indexOf("saveConfig("),
    "tombstone is written before the binding is dropped",
  );
  assert.match(deleteRoute, /status: 404/, "nothing-to-remove is a 404, not a silent ok");

  // The roster GET hides tombstoned ids (the daemon may not have re-read
  // familiars.toml yet) and create clears a reused id's tombstone so the new
  // familiar isn't invisible.
  assert.match(rosterRoute, /removedFamiliarIds/);
  assert.match(rosterRoute, /\.filter\(\(f\) => !removedIds\.has\(f\.id\)\)/);
  assert.match(rosterRoute, /takeTombstone\(draft\.id\)/);

  // Restore refuses to clobber a re-created id (duplicate [[familiar]] blocks —
  // the daemon only reads the first) and keeps the tombstone for later.
  assert.match(removedRoute, /familiarsTomlContainsId/);
  assert.match(removedRoute, /hasNonemptyDescriptionFromTomlBlock/);
  const descriptionValidationAt = removedRoute.lastIndexOf("hasNonemptyDescriptionFromTomlBlock");
  assert.ok(descriptionValidationAt > 0, "restore validates its tombstone description");
  assert.ok(
    descriptionValidationAt < removedRoute.indexOf("await takeTombstone(id)"),
    "restore validates a tombstone description before consuming it",
  );
  assert.match(removedRoute, /status: 409/);
}

console.log("familiar-studio-lifecycle-tab.test.ts: ok");

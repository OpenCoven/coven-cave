// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-lifecycle-section.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarLifecycleSection/);
assert.match(source, /archiveFamiliar/);
assert.match(source, /unarchiveFamiliar/);
// The section is scoped to the SELECTED familiar (it lives at the bottom of the
// Identity tab) — the roster manager (reorder/list) retired with the Lifecycle
// tab, so no roster lists or ordering machinery may creep back in here.
assert.doesNotMatch(source, /setFamiliarOrder|DndContext|SortableContext|useSortable/, "no roster reordering in the lifecycle section");
assert.match(source, /isArchived \? \(/, "archive/unarchive toggles off the selected familiar's archived state");

// The roster order hint moved out with the reorder UI; archive-vs-remove
// semantics still explained in-product.
assert.match(source, /Archive hides a familiar/, "archive-vs-remove semantics are explained in-product");

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

// Remove is a distinct action beside Archive/Unarchive, with an inline confirm
// strip that spells out detach semantics: what is cleared vs. what survives,
// plus the active-session warning.
assert.match(source, /aria-label=\{`Remove \$\{familiar\.display_name\}`\}/);
assert.match(source, /aria-label=\{`Archive \$\{familiar\.display_name\}`\}/);
assert.match(source, /aria-label=\{`Unarchive \$\{familiar\.display_name\}`\}/);
assert.match(source, /roster entry and agent binding/, "confirm copy explains what is cleared");
assert.match(source, /stay on\s+your disk/, "confirm copy explains what survives");
assert.match(source, /active_sessions/, "confirm warns using the daemon session count");
assert.match(source, /keep\s+running until they finish/);

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

// The section renders from the Identity tab — the only lifecycle home now.
{
  const identityTab = readFileSync(
    new URL("./familiar-studio-identity-tab.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    identityTab,
    /<FamiliarLifecycleSection familiar=\{familiar\} onRosterChanged=\{onRosterChanged\} \/>/,
    "the Identity tab hosts the lifecycle section",
  );
}

// ── Route seams ──────────────────────────────────────────────────────────────
{
  const path = await import("node:path");
  const apiDir = path.join(process.cwd(), "src", "app", "api", "familiars");
  const deleteRoute = readFileSync(path.join(apiDir, "[id]", "route.ts"), "utf8");
  const removedRoute = readFileSync(path.join(apiDir, "removed", "route.ts"), "utf8");
  const rosterRoute = readFileSync(path.join(apiDir, "route.ts"), "utf8");
  const rosterHelper = readFileSync(path.join(process.cwd(), "src", "lib", "server", "familiar-roster.ts"), "utf8");

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
  assert.match(rosterRoute, /loadVisibleFamiliarRoster/);
  assert.match(rosterHelper, /removedFamiliarIds/);
  assert.match(rosterHelper, /\.filter\(\(familiar\) => !removedIds\.has\(familiar\.id\)\)/);
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

console.log("familiar-lifecycle-section.test.ts: ok");

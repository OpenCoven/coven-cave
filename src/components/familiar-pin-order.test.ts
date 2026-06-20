// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./familiar-pin-order.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Sources its own roster (Settings has no workspace context) and resolves it.
assert.match(
  source,
  /fetch\("\/api\/familiars"/,
  "fetches the familiar roster",
);
assert.match(source, /useResolvedFamiliars\(rawFamiliars\)/, "resolves familiars (avatars/names)");
assert.match(source, /useFamiliarPins\(\)/, "reads the current pin list");

// Pinned familiars are drag-to-reorder and persisted via setPins(arrayMove(...)).
assert.match(
  source,
  /setPins\(arrayMove\(pinnedIds, oldIndex, newIndex\)\)/,
  "drag reorder persists the new pin order via setPins",
);
assert.match(source, /<DndContext[\s\S]*<SortableContext/, "uses dnd-kit sortable context");
assert.match(source, /useSortable\(\{\s*id: familiar\.id/, "each pinned row is sortable by familiar id");

// Unpin from a row; pin an unpinned familiar from the chip row.
assert.match(
  source,
  /familiar-pin-order__unpin[\s\S]*onClick=\{\(\) => togglePin\(familiar\.id\)\}/,
  "each pinned row has an unpin button",
);
assert.match(
  source,
  /familiar-pin-order__chip[\s\S]*onClick=\{\(\) => togglePin\(f\.id\)\}/,
  "unpinned familiars can be pinned from the chip row",
);

// Empty state when nothing is pinned.
assert.match(source, /No pinned familiars yet/, "shows an empty-state hint when no pins");

// CSS hooks exist.
assert.match(globals, /\.familiar-pin-order__row\[data-dragging\] \{/, "dragging row has a fade style");
assert.match(globals, /\.familiar-pin-order__chip \{/, "pin chips are styled");

console.log("familiar-pin-order component: all assertions passed");

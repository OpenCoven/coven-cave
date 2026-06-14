// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");

// ───────── Task 7: inline stats row ─────────

assert.match(
  source,
  /data-testid="memory-stats-inline"/,
  "Inline stats row must be marked with data-testid='memory-stats-inline'",
);

assert.doesNotMatch(
  source,
  /grid gap-2 sm:grid-cols-2 lg:grid-cols-4/,
  "Old four-card stats grid must be removed",
);

for (const label of ["Familiar memories", "Coven origin", "External harnesses", "Runtime memory"]) {
  assert.ok(source.includes(label), `Inline stats row must keep label: ${label}`);
}

// ───────── Graph-absence guards ─────────

assert.doesNotMatch(
  source,
  /memory-graph-3d|MemoryGraph3D|buildMemoryGraphModel|Loading 3D memory graph|viewMode.*graph/s,
  "FamiliarsMemoryView must not mount or import the removed 3D memory graph",
);

assert.doesNotMatch(
  source,
  /Selected memory|Click any card in the map|graph-recent-list/,
  "FamiliarsMemoryView must not keep graph-only side panel copy",
);

// ───────── Task 8: empty-state min-height collapsed ─────────

assert.doesNotMatch(
  source,
  /grid min-h-\[180px\] place-items-center rounded-lg border border-dashed/,
  "Familiar memory empty-state card must not enforce min-h-[180px]",
);

assert.match(
  source,
  /grid place-items-center rounded-lg border border-dashed border-\[var\(--border-hairline\)\] px-4 py-6/,
  "Empty-state card must use py-6 padding instead of min-h",
);

console.log("familiars-memory-view-full-tab.test.ts: ok");

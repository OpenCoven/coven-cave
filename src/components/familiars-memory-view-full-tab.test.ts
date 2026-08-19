import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

// ───────── Compact scope/status row + filter counts ─────────

assert.match(
  source,
  />\s*Familiar Memory\s*</,
  "The compact scope row keeps the surface title",
);
assert.match(source, /\{selectedFamiliar\?\.display_name \?\? "No familiar selected"\}/, "the scope row names its familiar");
assert.match(source, /Canonical \$\{overviewState\.value\.verification\.state\}/, "canonical verification remains visible");

assert.doesNotMatch(
  source,
  /memory-stats-inline|data-testid="memory-masthead"/,
  "the expanded statistics masthead remains removed",
);
assert.match(source, /aria-controls=\{overviewPanelId\}/, "canonical overview is reachable from the compact status row");
assert.match(source, /<CanonicalMemoryOverviewPanel overview=\{overviewState\.value\}/, "the full canonical overview remains available on demand");

for (const label of ["Coven origin", "External runtimes", "Runtime memory"]) {
  assert.ok(source.includes(label), `Filter popover must keep source option: ${label}`);
}

// The source options count the selected familiar's scoped file pool.
assert.match(
  source,
  /familiarScopedFiles\.filter\(\s*\(entry\) => entry\.sourceKind === "coven-origin",?\s*\)/,
  "Source counts must derive from the selected familiar's scoped file pool",
);

// ───────── Graph-absence guards ─────────

assert.doesNotMatch(
  source,
  /memory-graph-3d|MemoryGraph3D|buildMemoryGraphModel|Loading 3D memory graph|viewMode[\s\S]*graph/,
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

// The memory list/cards render flat — the master-detail list drops its bordered
// box wrapper (rows keep their divide-y hairlines) and the compact cards become
// borderless divided rows instead of bordered card boxes.
assert.doesNotMatch(
  source,
  /overflow-y-auto rounded-lg border border-\[var\(--border-hairline\)\] bg-\[var\(--bg-raised\)\]\/25/,
  "Master-detail memory list should not be wrapped in a bordered rounded box",
);
assert.doesNotMatch(
  source,
  /rounded-lg border border-\[var\(--border-hairline\)\] bg-\[var\(--bg-raised\)\]\/35 p-3/,
  "Compact memory cards should not be bordered rounded card boxes",
);
assert.match(
  source,
  /flex flex-col divide-y divide-\[var\(--border-hairline\)\] border-t border-\[var\(--border-hairline\)\]/,
  "Compact memories render as a flat divided list",
);

console.log("familiars-memory-view-full-tab.test.ts: ok");

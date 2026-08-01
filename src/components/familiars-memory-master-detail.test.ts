import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

assert.match(source, /buildMemoryRows\(/, "full view must derive rows from buildMemoryRows");
assert.match(source, /import \{ MemoryRowItem \}/, "must render MemoryRowItem rows");
assert.match(source, /import \{ MemoryReaderPane \}/, "must render the reader pane");
assert.match(source, /<MemoryReaderPane/, "reader pane is mounted in the full view");
assert.ok(!/memory-suggestions/.test(source), "the standalone Suggested-for-cleanup section is removed");
assert.match(source, /Stale \(\{suggestions\.length\}\)/, "a Stale (N) filter pill is present");
assert.match(source, /Delete \{bulkDeletable\.length\} cleanable/, "bulk-delete action retained");
assert.ok(!/memory-list-drawer/.test(source), "old grid drawer removed");
assert.match(
  source,
  /expandRow\?\.kind === "file"[\s\S]*?<MemoryReaderModal[\s\S]*?path=\{expandRow\.contentPath\}/,
  "file fullscreen expand uses the resolved content path",
);
assert.match(
  source,
  /export function MemoryReaderModal[\s\S]*?<DocumentReader[\s\S]*?navigation="rail"/,
  "file fullscreen expand uses the persistent shared contents rail",
);
assert.match(
  source,
  /expandRow\?\.kind === "canonical"[\s\S]*?<CanonicalMemoryReader[\s\S]*?memoryId=\{expandRow\.memoryId\}/,
  "canonical fullscreen expand dispatches by opaque memory ID",
);

// Responsive: panes gate on selection below the container breakpoint; reader has a Back button.
// Layout keys off the view's own container width (@container/memview), not the viewport,
// so the master-detail collapses to one pane inside narrow surfaces like the Studio drawer.
assert.match(source, /selectedRowId\s*\?\s*"hidden @min-\[1024px\]\/memview:flex"\s*:\s*"flex"/, "list pane hides below the container breakpoint when a row is selected");
assert.match(source, /selectedRowId\s*\?\s*"flex"\s*:\s*"hidden @min-\[1024px\]\/memview:flex"/, "reader wrapper hides below the container breakpoint when nothing is selected");
assert.match(
  source,
  /onBack=\{clearMemorySelection\}/,
  "reader receives the shared back-to-list handler that also releases any pinned canonical landing",
);
assert.match(
  source,
  /selectedRow\?\.kind === "canonical"[\s\S]*?<CanonicalMemoryReader/,
  "selected canonical rows dispatch to the canonical reader",
);
assert.match(
  source,
  /row=\{selectedRow\?\.kind === "file" \? selectedRow : null\}/,
  "the path-bearing file reader receives file rows only",
);

const reader = await readFile(new URL("./familiars-memory-reader.tsx", import.meta.url), "utf8");
assert.match(reader, /aria-label="Back to list"/, "reader renders a Back button");
assert.match(reader, /@min-\[1024px\]\/memview:hidden/, "Back button is hidden at/above the container breakpoint");

// Grouping: a Group control drives groupMemoryRows over the paged rows.
assert.match(source, /value=\{groupMode\}/, "Group control is bound to groupMode");
assert.match(source, /groupMemoryRows\(pagedRows, groupMode\)/, "grouped mode wraps the paged rows");
assert.match(source, /groupMode === "none" \?/, "flat list renders only when group mode is none");

// A selected familiar's list contains ONLY that familiar's memories — no
// shared/global-pool rows, so no "Coven-wide memory" divider exists.
assert.ok(
  !/Coven-wide memory/.test(source),
  "no shared-pool divider: the view is strictly scoped to the selected familiar",
);
assert.match(
  source,
  /entry\.familiarId === effectiveFamiliarFilter/,
  "file entries are strictly filtered to the selected familiar",
);

console.log("familiars-memory-master-detail: all assertions passed");

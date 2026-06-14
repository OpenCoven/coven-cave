// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

assert.match(source, /buildMemoryRows\(/, "full view must derive rows from buildMemoryRows");
assert.match(source, /import \{ MemoryRowItem \}/, "must render MemoryRowItem rows");
assert.match(source, /import \{ MemoryReaderPane \}/, "must render the reader pane");
assert.match(source, /<MemoryReaderPane/, "reader pane is mounted in the full view");
assert.ok(!/memory-suggestions/.test(source), "the standalone Suggested-for-cleanup section is removed");
assert.match(source, /Stale \(\{suggestions\.length\}\)/, "a Stale (N) filter pill is present");
assert.match(source, /Delete \{bulkDeletable\.length\} cleanable/, "bulk-delete action retained");
assert.ok(!/memory-list-drawer/.test(source), "old grid drawer removed");
assert.match(source, /MemoryReaderModal path=\{expandRow\.contentPath \?\? expandRow\.path\}/, "fullscreen expand uses the resolved content path");

// Responsive: panes gate on selection below xl; reader has a Back button.
assert.match(source, /selectedRowId \? "hidden xl:flex" : "flex"/, "list pane hides below xl when a row is selected");
assert.match(source, /selectedRowId \? "flex" : "hidden xl:flex"/, "reader wrapper hides below xl when nothing is selected");
assert.match(source, /onBack=\{\(\) => setSelectedRowId\(null\)\}/, "reader receives a back-to-list handler");

const reader = await readFile(new URL("./agents-memory-reader.tsx", import.meta.url), "utf8");
assert.match(reader, /aria-label="Back to list"/, "reader renders a Back button");
assert.match(reader, /xl:hidden/, "Back button is hidden at xl and above");

// Grouping: a Group control drives groupMemoryRows over the paged rows.
assert.match(source, /value=\{groupMode\}/, "Group control is bound to groupMode");
assert.match(source, /groupMemoryRows\(pagedRows, groupMode\)/, "grouped mode wraps the paged rows");
assert.match(source, /groupMode === "none" \?/, "flat list renders only when group mode is none");

console.log("agents-memory-master-detail: all assertions passed");

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
assert.match(source, /MemoryReaderModal path=\{expandRow\.path\}/, "fullscreen expand wired to expandRow");

console.log("agents-memory-master-detail: all assertions passed");

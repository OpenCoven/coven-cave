// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-reader.tsx", import.meta.url), "utf8");

assert.match(source, /export function MemoryReaderPane\(/, "MemoryReaderPane must be exported");
assert.match(source, /useMemoryFile\(/, "reader must load file content via the shared hook");
assert.match(source, /<MarkdownBlock/, "Rendered mode must use MarkdownBlock");

// Rendered/Raw toggle, defaulting to rendered.
assert.match(source, /useState<"rendered" \| "raw">\("rendered"\)/, "toggle defaults to rendered");
assert.ok(source.includes("Rendered") && source.includes("Raw"), "both toggle labels present");
assert.match(source, /<pre/, "Raw mode must render a <pre> of the source");

// Full file — no 40-line clip in the inline reader.
assert.ok(!/Showing first/.test(source), "inline reader must NOT clip long files");
assert.ok(!/MAX_LINES/.test(source), "inline reader must NOT use a line cap");

// Content comes from the resolved contentPath; entries without one fall back to the
// excerpt (e.g. agent memories the server couldn't resolve to an allow-listed file).
assert.match(source, /useMemoryFile\(fetchPath\)/, "reader fetches the resolved contentPath");
assert.match(source, /row\?\.contentPath \?\? null/, "fetchPath is the row's contentPath");
assert.match(source, /hasFile \? text \?\? "" : row\.excerpt/, "no contentPath → excerpt fallback");

// Copy-path + empty state + open-file + expand.
assert.match(source, /navigator\.clipboard\.writeText/, "copy-path button must copy the path");
assert.match(source, /Select a memory to read/, "empty state when no row selected");
assert.match(source, /onOpenFile/, "reader exposes an open-file callback");
assert.match(source, /onExpand/, "reader exposes an expand callback");

console.log("agents-memory-reader: all assertions passed");

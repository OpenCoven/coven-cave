import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./familiars-memory-row.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/familiars-memory.css", import.meta.url), "utf8");

assert.match(source, /export function MemoryRowItem\(/, "MemoryRowItem must be exported");
// The row was a discriminated union — a canonical row carried an excerpt and
// could not be deleted, a file row carried a path and could. The canonical
// variant went with the vault, so the row is one shape and the glyph is fixed.
assert.match(source, /name="ph:file-text"/, "row uses the file glyph");
assert.doesNotMatch(
  source,
  /CanonicalMemoryRow|row\.kind === "canonical"/,
  "the retired canonical variant is gone from the prop union and the render",
);
// unified grammar: title + age, excerpt/path, then meaningful metadata
assert.match(source, /\{row\.title\}/, "row renders the title");
assert.match(source, /\{age\}/, "row renders the age label passed in");
assert.match(source, /compactRowPath\(row\.path\)/, "row renders the compacted file path");
assert.match(source, /\{row\.sourceLabel\}/, "row renders the source label");
// selected styling via accent border
assert.match(source, /selected/, "row reacts to a selected prop");
assert.match(
  css,
  /\.fm-memory-row\.is-selected \{[\s\S]*?border-left-color: var\(--accent-presence\);/,
  "selected row uses the accent border",
);
// hover-revealed actions: opacity toggled on group hover/focus
assert.match(source, /opacity-0/, "actions hidden by default");
assert.match(source, /group-hover\/row:opacity-100/, "actions revealed on row hover");
// structural entries hide delete
// Delete stays unrepresentable for a structural entry — that guard predates the
// vault and is the reason this row could never offer a destructive action on
// something the app depends on.
assert.match(source, /onDelete && row\.protection !== "structural"/, "delete is hidden for structural entries");
assert.match(source, /onDelete/, "row supports a delete callback");
assert.match(source, /onExpand/, "row supports an expand callback");
assert.match(source, /onSelect/, "row supports a select callback");
// stale dot
assert.match(source, /row\.stale/, "row indicates staleness");

console.log("familiars-memory-row: all assertions passed");

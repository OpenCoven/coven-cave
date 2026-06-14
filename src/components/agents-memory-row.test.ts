// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-row.tsx", import.meta.url), "utf8");

assert.match(source, /export function MemoryRowItem\(/, "MemoryRowItem must be exported");
// type glyph differs by kind
assert.match(source, /row\.kind === "agent" \? "ph:brain" : "ph:file-text"/, "row uses a per-kind type glyph");
// two-line: title + age on line 1, source/size/stale on line 2
assert.match(source, /\{row\.title\}/, "row renders the title");
assert.match(source, /\{age\}/, "row renders the age label passed in");
assert.match(source, /\{row\.sourceLabel\}/, "row renders the source label");
// selected styling via accent border
assert.match(source, /selected/, "row reacts to a selected prop");
assert.match(source, /var\(--accent-presence\)/, "selected row uses the accent border");
// hover-revealed actions: opacity toggled on group hover/focus
assert.match(source, /opacity-0/, "actions hidden by default");
assert.match(source, /group-hover\/row:opacity-100/, "actions revealed on row hover");
// structural entries hide delete
assert.match(source, /row\.protection !== "structural"/, "delete is hidden for structural entries");
assert.match(source, /onDelete/, "row supports a delete callback");
assert.match(source, /onExpand/, "row supports an expand callback");
assert.match(source, /onSelect/, "row supports a select callback");
// stale dot
assert.match(source, /row\.stale/, "row indicates staleness");

console.log("agents-memory-row: all assertions passed");

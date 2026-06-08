// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-glyph-picker-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarGlyphPickerPanel/, "Must export the panel");
assert.match(source, /searchGlyphs/, "Must use searchGlyphs");
assert.match(source, /setGlyphOverride/, "Must call setGlyphOverride");
assert.match(source, /clearGlyphOverride/, "Must support clearing the override");
assert.match(source, /Recent/, "Recent strip must be present");

console.log("familiar-glyph-picker-panel.test.ts: ok");

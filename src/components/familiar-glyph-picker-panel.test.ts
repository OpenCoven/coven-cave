// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-glyph-picker-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarGlyphPickerPanel/, "Must export the panel");
assert.doesNotMatch(
  source,
  /import\s+\{[^}]*searchGlyphs[^}]*\}\s+from\s+["']@\/lib\/glyph-catalog["']/s,
  "picker panel must not statically import the full glyph catalog",
);
assert.match(
  source,
  /import\("@\/lib\/glyph-catalog"\)/,
  "picker panel lazily imports the searchable glyph catalog",
);
assert.match(source, /aria-busy="true"/, "lazy catalog load keeps an explicit loading state");
assert.match(source, /min-h-\[22rem\]/, "loading and loaded panels reserve stable height");
assert.match(source, /searchGlyphs/, "Must use searchGlyphs");
assert.match(source, /setGlyphOverride/, "Must call setGlyphOverride");
assert.match(source, /clearGlyphOverride/, "Must support clearing the override");
assert.match(source, /Recent/, "Recent strip must be present");

console.log("familiar-glyph-picker-panel.test.ts: ok");

assert.doesNotMatch(source, /window.addEventListener\("keydown"/, "a retained hidden picker cannot capture another editor's shortcuts");
assert.match(source, /event.target.closest\('\[data-glyph-button="true"\]'\)/, "reset requires a focused glyph button inside this picker");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const glyph = readFileSync(new URL("./familiar-glyph.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const lazySurfaces = readFileSync(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
  glyph,
  /^import .*ph-glyph-catalog\.json/m,
  "ordinary familiar rendering must not statically import the full catalog",
);
assert.match(
  glyph,
  /import\("@\/lib\/ph-glyph-catalog\.json"\)/,
  "uncommon saved glyphs load the full offline catalog on demand",
);
assert.match(
  glyph,
  /ph-familiar-core\.json/,
  "ordinary rendering uses the tiny generated familiar core",
);
assert.match(
  glyph,
  /catch\(\(\) => \{[\s\S]*guaranteed core fallback/,
  "failed lazy loads retain a visible core fallback",
);

assert.doesNotMatch(
  workspace,
  /from "@\/components\/familiar-glyph-picker"/,
  "workspace must not statically import the glyph picker",
);
assert.match(
  lazySurfaces,
  /import\("@\/components\/familiar-glyph-picker"\)/,
  "glyph picker is exposed through the shared lazy surface boundary",
);
assert.match(
  workspace,
  /glyphPickerFor \? \([\s\S]*<FamiliarGlyphPicker/,
  "workspace does not mount or fetch the picker until it opens",
);

console.log("familiar-glyph-loading.test.ts: ok");

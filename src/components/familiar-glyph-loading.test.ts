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
// Issue #5192: the catalogue-landed signal used to ride a setState whose value
// the render never read. The React Compiler memoizes that shape away, so the
// 800 mounted picker glyphs never re-rendered and stayed on the sparkle
// fallback. The loaded set must reach render through a store React itself
// re-renders on, and the render must consume it.
assert.match(
  glyph,
  /useSyncExternalStore\(/,
  "catalog-loaded signal must re-render through a store, not an unread setState",
);
assert.match(
  glyph,
  /fullCatalogNames/,
  "the loaded catalog snapshot must be read in render, not only in effects",
);
assert.doesNotMatch(
  glyph,
  /const \[, \w+\] = useState/,
  "no unread-setState force-update may come back (React Compiler memoizes it away)",
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

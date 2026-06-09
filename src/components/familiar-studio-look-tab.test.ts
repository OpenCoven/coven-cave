// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-look-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLookTab/);
assert.match(source, /FamiliarGlyphPickerPanel/);
assert.match(source, /setFamiliarImage/);
assert.match(source, /clearFamiliarImage/);
assert.match(source, /setFamiliarOverride/);
assert.match(source, /color/);
assert.match(source, /input.*type="color"/);
assert.match(source, /input.*type="file"/);
assert.match(source, /onDrop|onDragOver/, "Drag-drop wired for image upload");
assert.match(
  source,
  /color-mix\(in oklch, var\(--accent-presence\)/,
  "Color presets should include theme-derived pastel colors",
);
assert.match(
  source,
  /type ColorScope = "familiar" \| "harness"/,
  "Look tab should support familiar and harness color scopes",
);
assert.match(
  source,
  /allFamiliars: ResolvedFamiliar\[\]/,
  "Look tab should receive all familiars for group palette assignment",
);
assert.match(
  source,
  /setFamiliarOverride\(target\.id, \{ color \}\)/,
  "Color scope application should write the selected color to every target familiar",
);
assert.match(source, /Same harness/, "Look tab should expose same-harness color assignment");
assert.match(source, /Palette by familiar/, "Look tab should expose per-familiar palette distribution");
assert.match(source, /Palette by harness/, "Look tab should expose per-harness palette distribution");

console.log("familiar-studio-look-tab.test.ts: ok");

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

console.log("familiar-studio-look-tab.test.ts: ok");

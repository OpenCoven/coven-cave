// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-lifecycle-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioLifecycleTab/);
assert.match(source, /archiveFamiliar/);
assert.match(source, /unarchiveFamiliar/);
assert.match(source, /clearAllFamiliarOverrides/);
assert.match(source, /clearGlyphOverride/);
assert.match(source, /clearFamiliarImage/);
assert.match(source, /listView/);

console.log("familiar-studio-lifecycle-tab.test.ts: ok");

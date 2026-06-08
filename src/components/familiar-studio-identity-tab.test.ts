// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-studio-identity-tab.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /export function FamiliarStudioIdentityTab/);
assert.match(source, /display_name/);
assert.match(source, /role/);
assert.match(source, /pronouns/);
assert.match(source, /description/);
assert.match(source, /setFamiliarOverride/);
assert.match(source, /clearFamiliarOverrideField/);

console.log("familiar-studio-identity-tab.test.ts: ok");

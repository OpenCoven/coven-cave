// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automation-create-dialog.tsx", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "dialog actions should use the shared Button primitive");
assert.match(source, /StandardSelect/, "dialog dropdowns should use the shared StandardSelect primitive");
assert.doesNotMatch(source, /<button\b/, "dialog should not hand-roll button controls");
assert.doesNotMatch(source, /rounded-md|rounded-lg/, "dialog controls should use radius tokens instead of hard-coded radii");

console.log("automation-create-dialog.test.ts: ok");

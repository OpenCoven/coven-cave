// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./automation-familiar-select.tsx", import.meta.url), "utf8");

assert.match(source, /import \{ Button \}/, "familiar chips should use the shared Button primitive");
assert.doesNotMatch(source, /<button\b/, "familiar chips should not hand-roll button controls");
assert.doesNotMatch(
  source,
  /rounded-full|rounded-md|rounded-lg/,
  "familiar chips should use radius tokens instead of hard-coded radii",
);
assert.match(source, /toggleFamiliarSelection/, "multi-select behavior should stay in shared selection logic");
assert.match(source, /aria-pressed=\{active\}/, "familiar chips should keep pressed state semantics");

console.log("automation-familiar-select.test.ts: ok");

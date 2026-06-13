import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./memory/route.ts", import.meta.url), "utf8");
assert.match(source, /scanCovenFamiliarWorkspaces/, "route surfaces coven familiar workspace memory");
assert.match(source, /workspaces.*familiars|"familiars"/, "scans the coven familiars dir");
console.log("memory-coven-workspaces.test: ok");

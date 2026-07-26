import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("./memory/route.ts", import.meta.url), "utf8");
const inventory = await readFile(
  new URL("../../lib/server/memory-file-inventory.ts", import.meta.url),
  "utf8",
);
assert.match(source, /listMemoryFileEntries/, "route returns the shared memory file inventory");
assert.match(
  inventory,
  /collectCovenFamiliarWorkspaces/,
  "memory inventory surfaces coven familiar workspace memory",
);
assert.match(inventory, /workspaces.*familiars|"familiars"/, "scans the coven familiars dir");
console.log("memory-coven-workspaces.test: ok");

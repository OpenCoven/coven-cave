import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const tab = await readFile(new URL("./familiar-studio-memory-tab.tsx", import.meta.url), "utf8");
assert.match(tab, /AgentsMemoryView/, "memory tab embeds the memory view");
assert.match(tab, /lockToFamiliar/, "memory tab scopes to one familiar");
const studio = await readFile(new URL("./familiar-studio.tsx", import.meta.url), "utf8");
assert.match(studio, /id: "memory"/, "studio registers a memory tab");
console.log("familiar-studio-memory-tab.test: ok");

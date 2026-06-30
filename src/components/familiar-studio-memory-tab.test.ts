import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const tab = await readFile(new URL("./familiar-studio-memory-tab.tsx", import.meta.url), "utf8");
assert.match(tab, /FamiliarsMemoryView/, "memory tab embeds the memory view");
assert.match(tab, /lockToFamiliar/, "memory tab scopes to one familiar");
// The standalone studio drawer was removed; Settings → Familiars (the inline
// panel) is the single source of truth and registers the tabs.
const studio = await readFile(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
assert.match(studio, /id: "memory"/, "the Settings familiar panel registers a memory tab");
console.log("familiar-studio-memory-tab.test: ok");

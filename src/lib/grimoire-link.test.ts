// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { grimoireHash, GRIMOIRE_HASH_PREFIX } from "./grimoire-link.ts";

// ── Pure hash builder ────────────────────────────────────────────────────────

assert.equal(GRIMOIRE_HASH_PREFIX, "#grimoire:", "prefix matches the grimoire-view deep-link format");
assert.equal(grimoireHash("knowledge", "my-entry"), "#grimoire:knowledge:my-entry");
assert.equal(grimoireHash("knowledge", "characters/my-entry"), "#grimoire:knowledge:characters%2Fmy-entry");
assert.equal(grimoireHash("journal", "2026-07-07"), "#grimoire:journal:2026-07-07");
assert.equal(
  grimoireHash("memory", "/Users/x/.coven/memory/notes.md"),
  "#grimoire:memory:%2FUsers%2Fx%2F.coven%2Fmemory%2Fnotes.md",
  "ids are URL-encoded so paths survive the hash",
);

// ── Consumers: cross-surface "Open in Grimoire" links (cave-kv3) ─────────────

const lib = await readFile(new URL("./grimoire-link.ts", import.meta.url), "utf8");
const reader = await readFile(new URL("../components/familiars-memory-reader.tsx", import.meta.url), "utf8");
const inspector = await readFile(new URL("../components/inspector-pane.tsx", import.meta.url), "utf8");

assert.match(
  lib,
  /new CustomEvent\("cave:navigate-mode", \{ detail: \{ mode: "grimoire" \} \}\)/,
  "navigation rides the Workspace's cave:navigate-mode bridge",
);
assert.match(lib, /window\.history\.replaceState/, "the hash is written before the mode switch");

assert.match(reader, /openGrimoireDoc\("memory", row\.contentPath/, "memory reader links its file to the Grimoire");
assert.match(reader, /row\.contentPath \?/, "reader only offers the link when the file path resolved");
assert.match(inspector, /openGrimoireDoc\("memory", path\)/, "chat inspector's memory file view links to the Grimoire");
assert.match(inspector, /aria-label="Open in Memories"/, "inspector link is labelled");

console.log("grimoire-link.test: ok");

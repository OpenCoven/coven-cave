// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./memory-graph-3d.tsx", import.meta.url), "utf8");

// ───────── G3: Compact top overlay ─────────

assert.doesNotMatch(
  source,
  /Agent memory map/,
  "Redundant 'Agent memory map' uppercase label must be removed (surface header already says it)",
);

// New one-line overlay should still surface the familiar + memory count.
assert.match(
  source,
  /familiars\.get\(selectedFamiliarId\)\?\.display_name/,
  "Top overlay must still show the familiar display name",
);

assert.match(
  source,
  /graph\.metrics\.visibleCovenEntries === 1 \? "memory" : "memories"/,
  "Top overlay must pluralize 'memory' vs 'memories' for one-vs-many",
);

// ───────── G4: Compact bottom legend ─────────

assert.doesNotMatch(
  source,
  /memory card/,
  "Legend label 'memory card' should be shortened to 'memory'",
);

assert.doesNotMatch(
  source,
  /tracked source/,
  "Legend label 'tracked source' should be shortened to 'source'",
);

assert.doesNotMatch(
  source,
  /older stack/,
  "Legend label 'older stack' should be shortened to 'stack'",
);

// Smaller swatches now (h-1.5 w-2 vs h-2 w-3).
assert.match(
  source,
  /h-1\.5 w-2 rounded-sm bg-\[#8E3DFF\]/,
  "Legend swatches must use smaller h-1.5 w-2 dimensions",
);

console.log("memory-graph-3d-overlay.test.ts: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// ───────── Task 4: placeholder + pill ─────────

// Placeholder uses the locked familiar's display name when present.
assert.match(
  source,
  /selectedFamiliar\.display_name\}'s memory/,
  "Placeholder must include `${selectedFamiliar.display_name}'s memory` template",
);

// Generic fallback still present.
assert.match(
  source,
  /"Search memory\.\.\."/,
  "Generic placeholder fallback 'Search memory...' must remain",
);

// The standalone <span aria-label="Locked to familiar"> must be gone.
assert.doesNotMatch(
  source,
  /aria-label="Locked to familiar"/,
  "Redundant locked-familiar pill must be removed",
);

console.log("agents-memory-view-rail.test.ts: ok");

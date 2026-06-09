// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./agents-memory-view.tsx", import.meta.url), "utf8");

// ───────── Task 7: inline stats row ─────────

assert.match(
  source,
  /data-testid="memory-stats-inline"/,
  "Inline stats row must be marked with data-testid='memory-stats-inline'",
);

assert.doesNotMatch(
  source,
  /grid gap-2 sm:grid-cols-2 lg:grid-cols-4/,
  "Old four-card stats grid must be removed",
);

for (const label of ["Agent memories", "Coven origin", "External harnesses", "Runtime memory"]) {
  assert.ok(source.includes(label), `Inline stats row must keep label: ${label}`);
}

console.log("agents-memory-view-full-tab.test.ts: ok");

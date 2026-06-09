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

// ───────── Task 6: unified rail empty state ─────────

assert.match(
  source,
  /No memories yet for/,
  "Rail must render a unified empty state title when both sections are empty",
);

assert.match(
  source,
  /Familiar memories are saved during chats/,
  "Shared empty state must explain what familiar memories are",
);

assert.match(
  source,
  /\{compact\s*&&\s*loaded\s*&&\s*visibleCoven\.length\s*===\s*0\s*&&\s*visibleFiles\.length\s*===\s*0\s*\?/,
  "Shared empty state must only render in compact mode when both lists are empty after load",
);

// ───────── Task 5: vertical stack / balanced columns ─────────

assert.match(
  source,
  /compact\s*\?\s*"flex flex-col gap-4 overflow-y-auto p-4"/,
  "List-mode container must stack vertically when compact",
);

assert.match(
  source,
  /xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)\]/,
  "List-mode container (non-compact) must use a balanced 1fr/1fr grid",
);

assert.doesNotMatch(
  source,
  /xl:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(320px,0\.75fr\)\]/,
  "Old asymmetric 1.25/0.75 grid must be removed",
);

console.log("agents-memory-view-rail.test.ts: ok");

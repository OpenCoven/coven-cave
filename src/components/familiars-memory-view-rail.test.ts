import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");
const memoryCss = await readFile(new URL("../styles/familiars-memory.css", import.meta.url), "utf8");

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
  /"Search memory…"/,
  "Generic placeholder uses the canonical ellipsis",
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
  /const listPresentation = memoryListPresentation\(\{[\s\S]*?canonicalState: canonicalState\.state,[\s\S]*?filesState: filesState\.state,[\s\S]*?rowCount: unifiedRows\.length,[\s\S]*?\}\);[\s\S]*?\{listPresentation === "empty" \?/,
  "Shared empty state renders only after both independent feeds settle successfully with no rows",
);

// ───────── Task 5: vertical stack / balanced columns ─────────

assert.match(
  source,
  /compact\s*\?\s*"fm-content--compact flex flex-col overflow-y-auto"/,
  "List-mode container must stack vertically when compact",
);
assert.match(memoryCss, /\.fm-content--compact \{[\s\S]*?gap: var\(--space-4\);[\s\S]*?padding: var\(--space-4\);/);

assert.match(
  memoryCss,
  /\.fm-content--split \{[\s\S]*?grid-template-columns: var\(--fm-list-width\) minmax\(0, 1\.28fr\);/,
  "List-mode container (non-compact) must use the dedicated asymmetric list/reader grid",
);

assert.doesNotMatch(
  source,
  /xl:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(320px,0\.75fr\)\]/,
  "Old asymmetric 1.25/0.75 grid must be removed",
);

// ───────── Task 10: sticky rail footer ─────────
// (cave-kdkg) RailMemoryList was removed as dead code — never imported. The
// .rail-memory__open-full pin stays because inspector-pane's memory tab still
// uses the class for its "Open full memory" footer button.

const cssSource = await readFile(new URL("../styles/globals/desktop-chrome.css", import.meta.url), "utf8");

assert.match(
  cssSource,
  /\.rail-memory__open-full\s*\{[^}]*flex-shrink:\s*0/,
  "rail-memory__open-full must be pinned (flex-shrink: 0)",
);

assert.doesNotMatch(
  source,
  /RailMemoryList/,
  "RailMemoryList stays deleted (was dead code — no importers)",
);

console.log("familiars-memory-view-rail.test.ts: ok");

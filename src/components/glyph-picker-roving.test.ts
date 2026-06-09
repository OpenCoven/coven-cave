// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./familiar-glyph-picker-panel.tsx", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /import\s+\{[^}]*useRovingTabIndex[^}]*\}\s+from\s+["']@\/lib\/use-roving-tabindex["']/,
  "imports useRovingTabIndex",
);

// Horizontal orientation explicitly — 1D rove across all glyphs.
assert.match(
  source,
  /useRovingTabIndex\([\s\S]*?orientation:\s*["']horizontal["']/,
  "uses horizontal orientation (1D rove)",
);

// scrollIntoView is called to keep the focused glyph visible.
assert.match(
  source,
  /scrollIntoView\(\s*\{[\s\S]*?block:\s*["']nearest["']/,
  "calls scrollIntoView({block:'nearest'}) on focus change",
);

// Container has a listbox/grid/toolbar role.
assert.match(
  source,
  /role="(listbox|grid|toolbar)"/,
  "grid container has an accessible role",
);

// Glyph buttons carry the data attr used as the rove selector.
assert.match(
  source,
  /data-glyph-button="true"/,
  "glyph buttons carry data-glyph-button attribute",
);

// Glyph buttons use role=option with aria-selected.
assert.match(source, /role="option"/, "glyph buttons use role=option");
assert.match(source, /aria-selected=/, "glyph buttons expose aria-selected");

console.log("glyph-picker-roving.test.ts OK");

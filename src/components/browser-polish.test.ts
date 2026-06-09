// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pane = await readFile(new URL("./browser-pane.tsx", import.meta.url), "utf8");

// ───────── Task 1: Keyboard hint footer + [ shortcut ─────────
assert.match(
  pane,
  /⌘K tabs · ⌘\[ back · ⌘\] forward · ⌘R reload · \[ pin rail/,
  "Footer hint string must list the keyboard shortcuts",
);
assert.match(
  pane,
  /if \(e\.key !== "\["\) return;/,
  "[ keyboard handler must filter on e.key === '['",
);
assert.match(
  pane,
  /setRailPinned\(\(v\) => !v\)/,
  "[ handler must call setRailPinned((v) => !v)",
);
assert.match(
  pane,
  /paneRef\.current\?\.contains\(e\.target as Node\)/,
  "[ handler must be scoped to focus inside the pane",
);

// ───────── Task 2: Tab label legibility ─────────
assert.match(
  pane,
  /\{railExpanded \? \(\s*<span className="w-\[44px\] truncate text-center text-\[10px\] leading-tight">\{title\}<\/span>\s*\) : null\}/,
  "Tab label gated on railExpanded + text-[10px]",
);
assert.doesNotMatch(
  pane,
  /<span className="w-\[44px\] truncate text-center text-\[9px\] leading-tight">/,
  "Old text-[9px] label must be removed",
);

console.log("browser-polish.test.ts: ok");

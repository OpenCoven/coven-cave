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

console.log("browser-polish.test.ts: ok");

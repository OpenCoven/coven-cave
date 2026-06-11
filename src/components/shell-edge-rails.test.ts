// @ts-nocheck
// Closed side panels must stay discoverable and read as pressable:
//   - a collapsed nav leaves a left-edge reopen tab mirroring the
//     right-edge agent trigger rail (which already persists when the
//     companion rail is closed)
//   - edge-rail toggles render a visible button chip instead of an
//     invisible-until-hover icon
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync(new URL("./shell.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const projectSidebar = readFileSync(new URL("./chat-project-sidebar.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  shell,
  /agent-trigger-rail agent-trigger-rail--left/,
  "shell renders a left edge rail mirroring the right agent rail",
);
assert.match(
  shell,
  /!isMobile && !navOpen[\s\S]*?agent-trigger-rail--left/,
  "left edge rail only appears when the nav panel is collapsed on desktop",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?aria-label="Show navigation"/,
  "left edge rail toggle is labelled for screen readers",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?navRef\.current\?\.expand\(\)/,
  "left edge rail toggle expands the nav panel",
);

assert.match(
  css,
  /\.agent-trigger-rail--left \{[^}]*border-right: 1px solid var\(--border-hairline\)/,
  "left rail variant flips the hairline to its right edge",
);
assert.match(css, /\.edge-rail-chip \{/, "edge-rail chip class exists");
assert.doesNotMatch(
  css,
  /\.agent-trigger-rail__toggle \{[^}]*opacity: 0/,
  "edge-rail toggles must be visible without hovering",
);
assert.match(
  css,
  /button:active > \.edge-rail-chip/,
  "edge-rail chip has a pressed state",
);

assert.match(
  workspace,
  /edge-rail-chip[\s\S]{0,80}ph:cat/,
  "right agent rail toggle renders its icon inside the pressable chip",
);
assert.match(
  projectSidebar,
  /edge-rail-chip[\s\S]{0,120}ph:sidebar-simple/,
  "collapsed projects sidebar reopen tab uses the pressable chip",
);

console.log("shell-edge-rails.test.ts OK");

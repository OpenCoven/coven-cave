// @ts-nocheck
// Closed side panels must stay discoverable and read as pressable:
//   - the nav has a persistent left-edge collapse/expand tab mirroring the
//     right-edge agent trigger rail
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
  /!isMobile \? \([\s\S]*?agent-trigger-rail--left/,
  "left edge rail appears persistently on desktop",
);
assert.doesNotMatch(
  shell,
  /!isMobile && !navOpen[\s\S]*?agent-trigger-rail--left/,
  "left edge rail must not disappear while navigation is open",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?aria-label=\{navOpen \? "Hide navigation" : "Show navigation"\}/,
  "left edge rail toggle label reflects nav state",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?aria-expanded=\{navOpen\}/,
  "left edge rail exposes nav expanded state",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?navRef\.current\?\.collapse\(\)[\s\S]*?navRef\.current\?\.expand\(\)/,
  "left edge rail toggle collapses and expands the nav panel",
);
assert.match(
  shell,
  /agent-trigger-rail--left[\s\S]*?navOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/,
  "left edge rail icon reflects nav state",
);

assert.match(
  css,
  /\.agent-trigger-rail--left \{[^}]*border-right: 1px solid var\(--border-hairline\)/,
  "left rail variant flips the hairline to its right edge",
);
assert.match(
  css,
  /\.agent-trigger-rail \{[^}]*width: 26px;[^}]*flex: 0 0 26px;/,
  "edge trigger rails should be wide enough to read as intentional controls",
);
assert.match(
  css,
  /\.agent-trigger-rail::before \{[^}]*width: 1px;[^}]*background: color-mix\(in oklch, var\(--accent\) 52%, transparent\)/,
  "edge trigger rails should carry a subtle accent guide line",
);
assert.match(css, /\.edge-rail-chip \{/, "edge-rail chip class exists");
assert.match(
  css,
  /\.edge-rail-chip \{[^}]*width: 20px;[^}]*box-shadow:/,
  "edge-rail chip should be visibly pressable without feeling bulky",
);
assert.match(
  css,
  /\.agent-trigger-rail__toggle\[aria-expanded="true"\] > \.edge-rail-chip/,
  "expanded side-panel triggers should have an active chip treatment",
);
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

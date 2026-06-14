// @ts-nocheck
// Closed side panels must stay discoverable and read as pressable:
//   - when the nav is collapsed, a left-edge rail (mirroring the right-edge
//     agent trigger rail) is the floating reopen affordance; while the nav is
//     open the in-panel top toggle owns collapsing, so the rail stays hidden
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
  /familiar-trigger-rail familiar-trigger-rail--left/,
  "shell renders a left edge rail mirroring the right agent rail",
);
assert.match(
  shell,
  /!isMobile && !navOpen \? \([\s\S]*?familiar-trigger-rail--left/,
  "left edge rail appears on desktop once the nav is collapsed",
);
assert.match(
  shell,
  /familiar-trigger-rail--left[\s\S]*?aria-label=\{navOpen \? "Hide navigation" : "Show navigation"\}/,
  "left edge rail toggle label reflects nav state",
);
assert.match(
  shell,
  /familiar-trigger-rail--left[\s\S]*?aria-expanded=\{navOpen\}/,
  "left edge rail exposes nav expanded state",
);
assert.match(
  shell,
  /familiar-trigger-rail--left[\s\S]*?navRef\.current\?\.collapse\(\)[\s\S]*?navRef\.current\?\.expand\(\)/,
  "left edge rail toggle collapses and expands the nav panel",
);
assert.match(
  shell,
  /familiar-trigger-rail--left[\s\S]*?navOpen \? "ph:sidebar-simple-fill" : "ph:sidebar-simple"/,
  "left edge rail icon reflects nav state",
);

assert.match(
  css,
  /\.familiar-trigger-rail--left \{[^}]*border-right: 1px solid var\(--border-hairline\)/,
  "left rail variant flips the hairline to its right edge",
);
assert.match(
  css,
  /\.familiar-trigger-rail \{[^}]*width: 26px;[^}]*flex: 0 0 26px;/,
  "edge trigger rails should be wide enough to read as intentional controls",
);
assert.match(
  css,
  /\.familiar-trigger-rail::before \{[^}]*width: 1px;[^}]*background: color-mix\(in oklch, var\(--accent\) 52%, transparent\)/,
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
  /\.familiar-trigger-rail__toggle\[aria-expanded="true"\] > \.edge-rail-chip/,
  "expanded side-panel triggers should have an active chip treatment",
);
assert.doesNotMatch(
  css,
  /\.familiar-trigger-rail__toggle \{[^}]*opacity: 0/,
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
// The right rail is Salem-only — the browser globe tab was retired; the
// Browser surface is still reachable via the nav (⌘7).
assert.doesNotMatch(
  workspace,
  /familiar-trigger-rail__toggle[\s\S]{0,160}ph:globe/,
  "right agent rail no longer exposes the browser globe tab",
);
assert.match(
  css,
  /\.familiar-trigger-rail--stacked \{[^}]*justify-content: stretch;/,
  "right edge stacked tabs stretch to fill the rail height",
);
assert.match(
  css,
  /\.familiar-trigger-rail--stacked \.familiar-trigger-rail__toggle \{[^}]*flex: 1 1 0;/,
  "stacked rail toggles each fill half the rail (50/50 split)",
);
assert.match(
  projectSidebar,
  /edge-rail-chip[\s\S]{0,120}ph:sidebar-simple/,
  "collapsed projects sidebar reopen tab uses the pressable chip",
);

console.log("shell-edge-rails.test.ts OK");

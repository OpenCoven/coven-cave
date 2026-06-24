// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(
  new URL("../styles/home-composer.css", import.meta.url),
  "utf8",
);
const globals = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

// ───── Connector cards lay out 3-up and don't overflow their column ─────
// The cards replaced the suggestion chips; they grid 3-up on desktop and stack
// to a single column on narrow viewports so titles/subtitles never clip.
const connectorsMatch = css.match(/\.home-composer-connectors\s*\{([^}]*)\}/);
assert.ok(connectorsMatch, ".home-composer-connectors grid rule must exist");
assert.match(
  connectorsMatch[1],
  /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/,
  ".home-composer-connectors is a 3-up grid with min-width:0 tracks (cards can shrink)",
);

const connectorMatch = css.match(/\.hc-connector\s*\{([^}]*)\}/);
assert.ok(connectorMatch, ".hc-connector rule must exist");
assert.match(
  connectorMatch[1],
  /min-width:\s*0;/,
  ".hc-connector has min-width: 0 so the card can shrink inside its grid track",
);

assert.match(
  css,
  /@media \(max-width: 640px\)\s*\{[\s\S]*?\.home-composer-connectors\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
  "connector cards collapse to a single column under 640px",
);

// ───── Phone composer controls are thumb-sized ─────
assert.match(
  css,
  /@media \(max-width: 520px\)\s*\{[\s\S]*?\.hc-action-bar\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?\.hc-familiar-selector\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-familiar-select\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-send-btn\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-dest-pills\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer action bar wraps into thumb-sized familiar/send/destination controls",
);

assert.match(
  css,
  /@media \(max-width: 640px\)\s*\{[\s\S]*?\.hc-connector\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "stacked connector cards should meet the shared touch target",
);

// ───── Keyboard hint hides on touch ─────
// Touch devices have no physical keyboard — hide the desktop-only legend.
assert.match(
  css,
  /@media \(pointer: coarse\)\s*\{[\s\S]*?\.hc-keyboard-hint\s*\{[\s\S]*?display:\s*none;/,
  "@media (pointer: coarse) hides .hc-keyboard-hint",
);

// ───── Data-panel outer wrapper hide on mobile ─────
// react-resizable-panels wraps each <Panel> in `<div data-panel id="..">`
// whose inline `flex: N 1 0px` claims layout space even when the inner
// .shell-*-panel has position:fixed (drawer pattern). Without this rule the
// outer nav wrapper kept its 17%/14% allotment and pushed the detail panel
// ~64–68px right of the viewport on phones.
assert.match(
  globals,
  /\[data-panel="true"\]#nav,\s*\[data-panel="true"\]#list,\s*\[data-panel="true"\]#agent\s*\{\s*flex:\s*0\s+0\s+0\s*!important;/,
  "phone breakpoint zeroes the nav/list/agent outer-wrapper flex",
);
assert.match(
  globals,
  /\.shell-detail-panel,\s*\[data-panel="true"\]#detail\s*\{\s*flex:\s*1\s+1\s+100%\s*!important;/,
  "phone breakpoint promotes the detail outer wrapper to flex: 1 1 100%",
);

console.log("home-composer-mobile-gaps.test.ts: ok");

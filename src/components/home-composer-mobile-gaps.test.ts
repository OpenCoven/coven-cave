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

// ───── Suggestion chips ellipsis cleanly inside their max-width ─────
// Without these, long chip titles ("Continue: Task context: Title: …") spill
// past the suggestion-row edge and clip at the viewport on phones.
const chipMatch = css.match(/\.hc-suggestion\s*\{([^}]*)\}/);
assert.ok(chipMatch, ".hc-suggestion rule must exist");
assert.match(
  chipMatch[1],
  /max-width:\s*min\(100%, 360px\);/,
  ".hc-suggestion caps chip width at 360px",
);
assert.match(
  chipMatch[1],
  /min-width:\s*0;/,
  ".hc-suggestion has min-width: 0 so flex children can shrink for ellipsis",
);

assert.match(
  css,
  /\.hc-suggestion > span\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  ".hc-suggestion > span ellipsis chain (min-width: 0 + overflow + text-overflow + nowrap)",
);

// ───── Phone composer controls are thumb-sized ─────
assert.match(
  css,
  /@media \(max-width: 520px\)\s*\{[\s\S]*?\.hc-action-bar\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?\.hc-familiar-selector\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-familiar-select\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-send-btn\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-dest-pills\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer action bar wraps into thumb-sized familiar/send/destination controls",
);

assert.match(
  css,
  /@media \(max-width: 520px\)\s*\{[\s\S]*?\.hc-suggestion\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone suggestion chips should meet the shared touch target",
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

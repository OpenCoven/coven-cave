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

// ───── RSS widget rows ellipsis cleanly and scroll within a bounded card ─────
// The live RSS widget replaced the connector cards. Its rows must clamp long
// titles (so they never overflow the card) and the list must cap its height and
// scroll rather than pushing the page.
const titleMatch = css.match(/\.home-rss__item-title\s*\{([^}]*)\}/);
assert.ok(titleMatch, ".home-rss__item-title rule must exist");
assert.match(
  titleMatch[1],
  /-webkit-line-clamp:\s*2;/,
  ".home-rss__item-title clamps to 2 lines so long headlines don't overflow",
);

const listMatch = css.match(/\.home-rss__list\s*\{([^}]*)\}/);
assert.ok(listMatch, ".home-rss__list rule must exist");
assert.match(
  listMatch[1],
  /max-height:\s*\d+px;/,
  ".home-rss__list caps its height",
);
assert.match(
  listMatch[1],
  /overflow-y:\s*auto;/,
  ".home-rss__list scrolls instead of pushing the page",
);

// On phones the filter chips hide (no room) and the list shrinks.
assert.match(
  css,
  /@media \(max-width: 640px\)\s*\{[\s\S]*?\.home-rss__chips\s*\{[\s\S]*?display:\s*none;/,
  "RSS filter chips hide under 640px",
);

// ───── Phone composer controls are thumb-sized ─────
assert.match(
  css,
  /@media \(max-width: 520px\)\s*\{[\s\S]*?\.hc-action-bar\s*\{[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?\.hc-familiar-selector\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-familiar-select\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-send-btn\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-dest-pills\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer action bar wraps into thumb-sized familiar/send/destination controls",
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

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

// ───── Home feed rows ellipsis cleanly and scroll within a bounded card ─────
// The home content feed (Tweets · Repos) replaced the RSS widget. Its row
// descriptions must clamp (so they never overflow the card) and each tab's list
// must cap its height and scroll rather than pushing the page.
const descMatch = css.match(/\.home-feed__rowdesc\s*\{([^}]*)\}/);
assert.ok(descMatch, ".home-feed__rowdesc rule must exist");
assert.match(
  descMatch[1],
  /-webkit-line-clamp:\s*2;/,
  ".home-feed__rowdesc clamps to 2 lines so long descriptions don't overflow",
);

const listMatch = css.match(/\.home-feed__list\s*\{([^}]*)\}/);
assert.ok(listMatch, ".home-feed__list rule must exist");
assert.match(
  listMatch[1],
  /max-height:\s*\d+px;/,
  ".home-feed__list caps its height",
);
assert.match(
  listMatch[1],
  /overflow-y:\s*auto;/,
  ".home-feed__list scrolls instead of pushing the page",
);

// On phones the feed list shrinks its capped height.
assert.match(
  css,
  /@media \(max-width: 640px\)\s*\{[\s\S]*?\.home-feed__list\s*\{[\s\S]*?max-height:\s*\d+px;/,
  "home feed list caps its height under 640px",
);

// ───── Phone composer controls are thumb-sized ─────
assert.match(
  css,
  /@container \(max-width: 620px\)\s*\{[\s\S]*?\.hc-action-bar\s*\{[\s\S]*?align-items:\s*stretch;[\s\S]*?\.hc-control-group--who,\s*\.hc-control-group--run\s*\{[\s\S]*?display:\s*grid;[\s\S]*?\.hc-familiar-selector\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-home-select-value\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-dest-pills\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.hc-dest-pill\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);[\s\S]*?\.hc-send-btn\s*\{[\s\S]*?min-height:\s*var\(--touch-target\);/,
  "phone composer action bar uses thumb-sized custom selectors, send, and two-destination controls",
);


// The keyboard shortcut legend was removed from the home composer entirely.
assert.doesNotMatch(css, /\.hc-keyboard-hint\b/, ".hc-keyboard-hint CSS stays removed");

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

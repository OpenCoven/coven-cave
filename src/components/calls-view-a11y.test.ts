// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./calls-view.tsx", import.meta.url), "utf8");

// ── The Floor / Delegations is a real tablist ────────────────────────────────
// Was: two plain <button>s with a visual-only active class — no tab semantics,
// no keyboard arrow navigation, no tab↔panel association.
assert.match(src, /role="tablist"\s+aria-label="Calls view"/, "tab bar is a labelled tablist");
assert.match(
  src,
  /role="tab"\s+id=\{tabBtnId\(id\)\}\s+aria-selected=\{tab === id\}\s+aria-controls=\{tabPanelId\(id\)\}\s+tabIndex=\{tab === id \? 0 : -1\}/,
  "each tab announces selection, controls its panel, and roves the tab stop",
);
assert.match(src, /role="tabpanel"\s+id=\{tabPanelId\("floor"\)\}\s+aria-labelledby=\{tabBtnId\("floor"\)\}/, "the Floor panel is a labelled tabpanel");
assert.match(src, /role="tabpanel"\s+id=\{tabPanelId\("delegations"\)\}\s+aria-labelledby=\{tabBtnId\("delegations"\)\}/, "the Delegations panel is a labelled tabpanel");
assert.match(
  src,
  /onTablistKeyDown[\s\S]*?ArrowRight[\s\S]*?ArrowLeft[\s\S]*?"Home"[\s\S]*?"End"/,
  "the tablist supports Arrow/Home/End keyboard navigation",
);

// ── Delegations polling pauses when hidden + guards stale/unmounted writes ────
// Was: setInterval(load, 10_000) that kept fetching in a backgrounded tab, and
// load() with no request-id guard (setState-after-unmount risk).
assert.match(
  src,
  /setInterval\(\(\) => \{ if \(!document\.hidden\) void load\(\); \}, 10_000\)/,
  "polling skips the fetch while the tab is hidden",
);
assert.match(src, /addEventListener\("visibilitychange", onVisible\)/, "refetches when the tab becomes visible again");
assert.match(src, /removeEventListener\("visibilitychange", onVisible\)/, "the visibility listener is cleaned up");
assert.match(src, /const seq = \(loadSeqRef\.current \+= 1\)/, "each load takes a sequence number");
assert.match(src, /if \(seq !== loadSeqRef\.current\) return;/, "stale or post-unmount responses are dropped before setState");
assert.match(src, /loadSeqRef\.current = -1;/, "unmount parks the seq so in-flight loads are ignored");

// ── Selected trace row announces itself; count badge is honest ───────────────
assert.match(src, /aria-current=\{selectedTraceId === trace\.id \? "true" : undefined\}/, "the selected trace row is aria-current, not just tinted");
assert.match(
  src,
  /traces\.length > TRACE_TIMELINE_LIMIT \? `\$\{TRACE_TIMELINE_LIMIT\} of \$\{traces\.length\}`/,
  "the count badge reports the capped count honestly when more traces exist than render",
);
assert.match(src, /traces\.slice\(0, TRACE_TIMELINE_LIMIT\)/, "the timeline cap and the badge share one constant");

console.log("calls-view-a11y.test.ts: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// 1. :root[data-mode="light"] block exists with foreground/background.
const lightBlock = css.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.ok(lightBlock.length > 0, ":root[data-mode=light] block exists");
assert.match(lightBlock, /--background\s*:/, "light overrides --background");
assert.match(lightBlock, /--foreground\s*:/, "light overrides --foreground");
assert.match(lightBlock, /--accent-presence-foreground\s*:/, "light defines --accent-presence-foreground");

// 2. Border vars derive from --foreground via color-mix.
assert.match(
  css,
  /--border\s*:\s*color-mix\(in oklch, var\(--foreground\)/,
  "--border derives from --foreground",
);
assert.match(
  css,
  /--border-strong\s*:\s*color-mix\(in oklch, var\(--foreground\)/,
  "--border-strong derives from --foreground",
);

// 3. The old "the app runs dark-only" assumption comment is gone or rephrased.
assert.doesNotMatch(
  css,
  /the app runs dark-only/i,
  "removed the dark-only assertion",
);

// 4. data-theme="midnight" / "orchid" / "sky" blocks are removed
//    (replaced by new theme ids in a later task — Task 4).
//    For this task we just verify the default Coven structure is intact.
//    Anchored to the first :root { … } block (no attribute selector) so the
//    assertion can't drift into another theme's background.
const covenRootBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.match(covenRootBlock, /--background\s*:\s*oklch\(0\.13 0\.022 293\)/, "coven dark background");
assert.match(
  covenRootBlock,
  /--accent-presence-foreground\s*:\s*var\(--primary-foreground\)/,
  "coven dark defines a filled-accent foreground token",
);

console.log("globals.css.test.ts (task 3) OK");

// Task 4 assertions: every non-default theme has dark + light blocks —
// including the tweakcn ports and the a11y additions (contrast/beacon/
// solstice), which the original loop of 9 never covered.
const otherThemes = [
  "tide", "grove", "ember", "bloom", "dusk", "mist", "hex", "bane", "slate",
  "ghosty", "claymorphism", "claude", "pastel-dreams", "meatseeks", "trucker",
  "contrast", "beacon", "solstice",
];
for (const id of otherThemes) {
  const darkRe = new RegExp(`\\[data-theme="${id}"\\]\\s*\\{`);
  const lightRe = new RegExp(`\\[data-theme="${id}"\\]\\[data-mode="light"\\]\\s*\\{`);
  assert.match(css, darkRe, `${id} dark block exists`);
  assert.match(css, lightRe, `${id} light block exists`);
}

// Old preset ids no longer present as CSS selectors.
for (const old of ["midnight", "orchid", "sky"]) {
  const re = new RegExp(`\\[data-theme="${old}"\\]`);
  assert.doesNotMatch(css, re, `old preset ${old} removed`);
}

console.log("globals.css.test.ts (task 4) OK");

// --- Foundations PR tokens ------------------------------------------------

// (a) Light-mode --ring-focus derives from --accent-presence, not a hex literal.
const lightBlockRaw = css.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.match(
  lightBlockRaw,
  /--ring-focus\s*:\s*color-mix\(in oklch,\s*var\(--accent-presence\)/,
  "light --ring-focus must derive from --accent-presence (no hex)",
);
assert.doesNotMatch(
  lightBlockRaw,
  /--ring-focus\s*:\s*color-mix\(in oklch,\s*#/,
  "light --ring-focus must not hardcode a hex literal",
);

// (b) Disabled opacity token exists on :root.
assert.match(
  css,
  /--opacity-disabled\s*:\s*0\.4/,
  "--opacity-disabled token defined on :root",
);

// (c) Scrollbar tokens exist on :root.
assert.match(css, /--scrollbar-thumb\s*:/, "--scrollbar-thumb token defined on :root");
assert.match(css, /--scrollbar-track\s*:/, "--scrollbar-track token defined on :root");

// (d) Salem scrollbar consumes the token, not raw rgba.
assert.doesNotMatch(
  css,
  /scrollbar-color:\s*rgba\(124,\s*77,\s*255,\s*0\.3\)/,
  "salem must not use the hardcoded purple rgba scrollbar (use var(--scrollbar-thumb))",
);

// (e) Global ::selection rule exists and uses --accent-presence.
assert.match(
  css,
  /::selection\s*\{[\s\S]*?background:\s*color-mix\(in oklch,\s*var\(--accent-presence\)/,
  "::selection rule must exist and derive from --accent-presence",
);

console.log("globals.css.test.ts (foundations) OK");

// Salem surfaces should inherit shared Cave tokens instead of hardcoded purple
// literals, so theme/background tuning reaches the sidepanel consistently.
const salemBlock = css.match(/\.salem-panel[\s\S]*?\/\* Foundations PR/)?.[0] ?? "";
assert.match(salemBlock, /var\(--bg-panel\)/, "salem panel should derive surfaces from --bg-panel");
assert.match(salemBlock, /var\(--accent-presence\)/, "salem glow/accent should derive from --accent-presence");
assert.doesNotMatch(salemBlock, /rgba\(124,\s*77,\s*255/, "salem surfaces should not hardcode old purple rgba");
assert.doesNotMatch(salemBlock, /#(?:d1c4e9|e8e0f0|c9a7ff|d26bff|a855f7|a89ac0)\b/i, "salem surfaces should not hardcode old purple hex colors");

console.log("globals.css.test.ts (salem tokens) OK");

// The mode-transition wrapper must never RETAIN a transform after its
// entrance animation: fill-mode `both` kept the final keyframe's transform
// (even identity), turning every .cave-mode-fade into the containing block
// for position:fixed descendants — fixed overlays inside surfaces resolved
// against the mode area instead of the viewport and forced portal-to-body
// workarounds (#537, #1984, github-view card, cave-nv3). Bead cave-cco.
const modeFadeRule = css.match(/\.cave-mode-fade\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.match(
  modeFadeRule,
  /animation:\s*cave-mode-in\s+120ms\s+ease-out\s+backwards/,
  ".cave-mode-fade must use fill-mode backwards (nothing retained after the entrance)",
);
assert.doesNotMatch(
  modeFadeRule,
  /\bboth\b|\bforwards\b/,
  ".cave-mode-fade must not retain end-state animation styles (containing-block trap, cave-cco)",
);

// The chat/code sidebar responds to its own panel width, not the viewport —
// at narrow drag widths the per-row project tile yields its slot to the title.
assert.match(
  css,
  /\.cnav\s*\{[\s\S]*?container-type:\s*inline-size;[\s\S]*?container-name:\s*cnav;/,
  ".cnav is an inline-size query container",
);
assert.match(
  css,
  /@container cnav \(max-width: 212px\)\s*\{[\s\S]*?\.cnav__thread-proj\s*\{\s*display:\s*none;/,
  "narrow cnav panels drop the per-row project tile so titles keep room",
);

console.log("globals.css.test.ts (mode-fade containing block) OK");

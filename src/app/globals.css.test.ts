// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

// 1. :root[data-mode="light"] block exists with foreground/background.
const lightBlock = css.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\}/)?.[1] ?? "";
assert.ok(lightBlock.length > 0, ":root[data-mode=light] block exists");
assert.match(lightBlock, /--background\s*:/, "light overrides --background");
assert.match(lightBlock, /--foreground\s*:/, "light overrides --foreground");

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
assert.match(css, /:root\s*\{[\s\S]*?--background\s*:\s*oklch\(0\.07/, "coven dark background");

console.log("globals.css.test.ts (task 3) OK");

// Task 4 assertions: the 7 non-default themes each have dark + light blocks.
const otherThemes = ["tide", "grove", "ember", "bloom", "dusk", "mist", "slate"];
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
// literals, so theme/background tuning reaches the rail and perch consistently.
const salemBlock = css.match(/\.salem-perch[\s\S]*?\/\* Foundations PR/)?.[0] ?? "";
assert.match(salemBlock, /var\(--bg-panel\)/, "salem panel should derive surfaces from --bg-panel");
assert.match(salemBlock, /var\(--accent-presence\)/, "salem glow/accent should derive from --accent-presence");
assert.doesNotMatch(salemBlock, /rgba\(124,\s*77,\s*255/, "salem surfaces should not hardcode old purple rgba");
assert.doesNotMatch(salemBlock, /#(?:d1c4e9|e8e0f0|c9a7ff|d26bff|a855f7|a89ac0)\b/i, "salem surfaces should not hardcode old purple hex colors");

console.log("globals.css.test.ts (salem tokens) OK");

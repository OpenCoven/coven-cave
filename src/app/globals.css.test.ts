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

// @ts-nocheck
//
// iOS Safari auto-zooms when a focused input/textarea has font-size
// < 16px. Phase 1 established a global `input, textarea, select {
// font-size: max(16px, 1em) }` rule and removed every per-class
// font-size override that would have outranked it. This smoke test
// guards that regression vector — if a future change adds a small
// font-size to an input/textarea selector, this fails before it
// reaches a device.
//
// Strategy: walk the CSS files we know carry input/textarea selectors
// and assert that no rule whose selector mentions input/textarea/the
// known composer/search/drawer classes sets a font-size below 16px.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  ["globals.css", new URL("./globals.css", import.meta.url)],
  ["board.css", new URL("../styles/board.css", import.meta.url)],
  ["cave-chat.css", new URL("../styles/cave-chat.css", import.meta.url)],
  ["home-composer.css", new URL("../styles/home-composer.css", import.meta.url)],
];

const INPUT_SELECTORS = [
  "input",
  "textarea",
  "select",
  ".board-search-input",
  ".board-drawer-field-input",
  ".board-drawer-field-textarea",
  ".board-drawer-field-select",
  ".vault-add-input",
  ".cave-composer-input",
  ".hc-textarea",
  ".library-list-add-input",
];

// The global 16px rule is the anchor — verify it exists in globals.css.
const globals = readFileSync(files[0][1], "utf8");
assert.match(
  globals,
  /input,\s*textarea,\s*select\s*\{[\s\S]{0,80}font-size:\s*max\(16px,/,
  "globals.css declares the global `input, textarea, select { font-size: max(16px, 1em) }` rule",
);

// Walk each file and inspect every rule that targets a known input
// selector. If a rule sets `font-size: <Npx>` where N < 16, fail.
const PROBLEMATIC = /font-size\s*:\s*(\d+(?:\.\d+)?)px/g;

// iOS Safari focus-zoom only affects touch (coarse-pointer) devices, so a
// <16px size scoped to `@media (pointer: fine)` is desktop-only and safe.
// Strip those blocks (brace-balanced) before scanning so legitimate desktop
// sizing doesn't false-positive. Every other context — including mobile
// `@media (max-width: …)` — is still scanned and enforced.
function stripDesktopOnlyMedia(css) {
  const marker = "@media (pointer: fine)";
  let out = "";
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf(marker, i);
    if (idx === -1) { out += css.slice(i); break; }
    out += css.slice(i, idx);
    let j = css.indexOf("{", idx);
    if (j === -1) { out += css.slice(idx); break; }
    let depth = 1;
    j++;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  return out;
}

for (const [label, url] of files) {
  const css = stripDesktopOnlyMedia(readFileSync(url, "utf8"));
  // Walk top-level rule blocks. Naive splitter — close enough for the
  // hand-authored CSS in this repo (no nested rules outside of @media).
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRegex.exec(css)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    const touchesInput = INPUT_SELECTORS.some((sel) =>
      selector.split(",").some((part) => part.trim() === sel || part.trim().endsWith(` ${sel}`) || part.trim().endsWith(`.${sel.replace(/^\./, "")}`)),
    );
    if (!touchesInput) continue;
    // Skip rules inside @supports / @media — only `font-size: max(...)`
    // and `font-size: var(...)` are accepted at this point.
    let m;
    PROBLEMATIC.lastIndex = 0;
    while ((m = PROBLEMATIC.exec(body)) !== null) {
      const px = Number(m[1]);
      assert.ok(
        px >= 16,
        `[${label}] selector \`${selector}\` sets font-size: ${px}px — iOS Safari will auto-zoom on focus (must be >= 16px). Use \`text-base\` Tailwind, the global max(16px, 1em) rule, or font-size: 16px.`,
      );
    }
  }
}

console.log("composer-zoom-smoke.test.ts OK");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");

// 1. Script defaults theme to "coven" and mode to "dark".
assert.match(source, /\|\|\s*"coven"/, "theme defaults to coven");
assert.match(source, /\|\|\s*"dark"/, "mode defaults to dark");

// 2. Script writes BOTH data-theme and data-mode.
assert.match(source, /setAttribute\(\s*"data-theme"/, "sets data-theme");
assert.match(source, /setAttribute\(\s*"data-mode"/, "sets data-mode");

// 3. Rename map covers all 4 legacy ids and writes through localStorage.
for (const legacy of ["mood-c", "sky", "orchid", "midnight"]) {
  assert.ok(source.includes(`"${legacy}"`), `rename map contains ${legacy}`);
}
assert.ok(source.includes("setItem"), "writes renamed id back to localStorage");

// 4. Custom theme path applies the mode-matching group.
assert.match(
  source,
  /cssVars\.light|cssVars\[\s*["']light["']\s*\]/,
  "custom path references light group",
);
assert.match(
  source,
  /cssVars\.dark|cssVars\[\s*["']dark["']\s*\]/,
  "custom path references dark group",
);

// 5. Reads keys via the COVEN_*_KEY constants (or matches their values).
assert.ok(
  source.includes("coven-theme") && source.includes("coven-mode"),
  "references both storage keys",
);

console.log("theme-script.test.ts OK");

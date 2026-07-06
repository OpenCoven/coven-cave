// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");
const bootScript = readFileSync(new URL("../../public/scripts/theme-init.js", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /import Script from "next\/script"/,
  "ThemeScript must render a plain server script, not next/script",
);
assert.match(
  source,
  /<script id="theme-init" src="\/scripts\/theme-init.js" \/>/,
  "ThemeScript renders a server document script that loads the external theme init file",
);

// 1. Script defaults theme to "coven" and mode to "dark".
assert.match(bootScript, /\|\|\s*"coven"/, "theme defaults to coven");
assert.match(bootScript, /\|\|\s*"dark"/, "mode defaults to dark");

// 2. Script writes BOTH data-theme and data-mode.
assert.match(bootScript, /setAttribute\(\s*"data-theme"/, "sets data-theme");
assert.match(bootScript, /setAttribute\(\s*"data-mode"/, "sets data-mode");

// 3. Rename map covers all 4 legacy ids and writes through localStorage.
for (const legacy of ["mood-c", "sky", "orchid", "midnight"]) {
  assert.ok(bootScript.includes(`"${legacy}"`), `rename map contains ${legacy}`);
}
assert.ok(bootScript.includes("setItem"), "writes renamed id back to localStorage");

// 4. The pre-hydration allowlist accepts every preset theme plus custom.
for (const id of [
  "coven",
  "tide",
  "grove",
  "ember",
  "bloom",
  "dusk",
  "mist",
  "hex",
  "bane",
  "slate",
  "ghosty",
  "claymorphism",
  "claude",
  "pastel-dreams",
  "meatseeks",
  "trucker",
  "custom",
]) {
  assert.ok(bootScript.includes(`"${id}"`), `valid theme allowlist contains ${id}`);
}

// 5. Custom theme path applies the mode-matching group.
assert.match(
  bootScript,
  /cssVars\.light|cssVars\[\s*["']light["']\s*\]/,
  "custom path references light group",
);
assert.match(
  bootScript,
  /cssVars\.dark|cssVars\[\s*["']dark["']\s*\]/,
  "custom path references dark group",
);

// 6. Reads keys via the COVEN_*_KEY constants (or matches their values).
assert.ok(
  bootScript.includes("coven-theme") && bootScript.includes("coven-mode"),
  "references both storage keys",
);

console.log("theme-script.test.ts OK");

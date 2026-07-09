// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SERIF_FALLBACK, SANS_FALLBACK, MONO_FALLBACK } from "../lib/font-catalog.ts";

const src = readFileSync(new URL("../../public/scripts/theme-init.js", import.meta.url), "utf8");

// Coven canonical defaults (DESIGN.md §4): EB Garamond + Inter + JetBrains Mono.
assert.match(src, /cave:font:serif/, "boot reads cave:font:serif");
assert.match(src, /cave:font:sans/, "boot reads cave:font:sans");
assert.match(src, /cave:font:mono/, "boot reads cave:font:mono");
assert.match(src, /"eb-garamond"/, "boot skips the serif default (Coven canon)");
assert.match(src, /"inter"/, "boot skips the sans default (Coven canon)");
assert.match(src, /"jetbrains-mono"/, "boot skips the mono default (Coven canon)");
assert.match(src, /setProperty\(\s*["']--font-serif["']/, "boot sets --font-serif");
assert.match(src, /setProperty\(\s*["']--font-sans["']/, "boot sets --font-sans");
assert.match(src, /setProperty\(\s*["']--font-mono["']/, "boot sets --font-mono");
assert.match(src, /\^\[a-z0-9-\]\+\$/, "boot validates id is kebab-case");
assert.match(src, /APPROVED_FONT_PAIRS/, "boot gates saved fonts through approved font pairs");
assert.match(src, /coven-canon/, "boot includes the canonical pair id");
assert.match(src, /editorial-witch/, "boot includes curated pair ids");
assert.match(src, /fontPairId/, "boot derives a pair id from saved slot ids");
assert.ok(src.includes(JSON.stringify(SERIF_FALLBACK)), "inlined serif fallback matches catalog SERIF_FALLBACK");
assert.ok(src.includes(JSON.stringify(SANS_FALLBACK)), "inlined sans fallback matches catalog SANS_FALLBACK");
assert.ok(src.includes(JSON.stringify(MONO_FALLBACK)), "inlined mono fallback matches catalog MONO_FALLBACK");

console.log("font-boot.test.ts OK");

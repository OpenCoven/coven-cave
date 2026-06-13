// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SANS_FALLBACK, MONO_FALLBACK } from "../lib/font-catalog.ts";

const src = readFileSync(new URL("./theme-script.tsx", import.meta.url), "utf8");

assert.match(src, /cave:font:sans/, "boot reads cave:font:sans");
assert.match(src, /cave:font:mono/, "boot reads cave:font:mono");
assert.match(src, /"geist"/, "boot skips the sans default");
assert.match(src, /"jetbrains-mono"/, "boot skips the mono default");
assert.match(src, /setProperty\(\s*["']--font-sans["']/, "boot sets --font-sans");
assert.match(src, /setProperty\(\s*["']--font-mono["']/, "boot sets --font-mono");
assert.match(src, /\^\[a-z0-9-\]\+\$/, "boot validates id is kebab-case");
assert.ok(src.includes(SANS_FALLBACK), "inlined sans fallback matches catalog SANS_FALLBACK");
assert.ok(src.includes(MONO_FALLBACK), "inlined mono fallback matches catalog MONO_FALLBACK");

console.log("font-boot.test.ts OK");

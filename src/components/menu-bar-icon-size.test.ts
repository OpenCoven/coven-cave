// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// Top-bar action + search glyphs match the sidepanel toggle (var(--icon-sm))
// so the whole top chrome reads at one consistent icon size.
assert.match(css, /\.menu-bar__task > svg\s*\{[\s\S]*?width:\s*var\(--icon-sm\)[\s\S]*?height:\s*var\(--icon-sm\)/, "task icon matches sidepanel toggle (var(--icon-sm))");
assert.match(css, /\.menu-bar__search-icon\s*\{[\s\S]*?width:\s*var\(--icon-sm\)[\s\S]*?height:\s*var\(--icon-sm\)/, "search icon matches sidepanel toggle (var(--icon-sm))");
// Sanity-check the reference: the sidepanel toggle glyph is sized var(--icon-sm)
// in code (CAVE_ICON_SIZE.shellToggle); keep this match in sync if that changes.
const iconLib = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
assert.match(iconLib, /shellToggle:\s*"var\(--icon-sm\)"/, "sidepanel toggle glyph is var(--icon-sm)");
console.log("menu-bar-icon-size.test.ts passed");

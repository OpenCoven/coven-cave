// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// One compact top-chrome glyph size, var(--icon-sm) (14px) — shared by the
// menu-bar action icons, the search glyph, and the sidepanel toggle.
assert.match(css, /\.menu-bar__task > svg\s*\{[\s\S]*?width:\s*var\(--icon-sm\)[\s\S]*?height:\s*var\(--icon-sm\)/, "task icon is var(--icon-sm)");
assert.match(css, /\.menu-bar__search-icon\s*\{[\s\S]*?width:\s*var\(--icon-sm\)[\s\S]*?height:\s*var\(--icon-sm\)/, "search icon is var(--icon-sm)");
// Action buttons + search input use the design-token body size, not ad-hoc px.
assert.match(css, /\.menu-bar__new,\s*\n\.menu-bar__task\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/, "menu-bar buttons use var(--text-base)");
assert.match(css, /\.menu-bar__search-input\s*\{[\s\S]*?font-size:\s*var\(--text-base\)/, "search input uses var(--text-base)");
// The sidepanel/nav toggle glyph stays unified with the action icons.
const iconLib = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
assert.match(iconLib, /shellToggle:\s*"var\(--icon-sm\)"/, "sidepanel toggle glyph is var(--icon-sm)");
console.log("menu-bar-icon-size.test.ts passed");

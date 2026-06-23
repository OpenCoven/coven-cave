// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// One standard top-chrome glyph size, var(--icon-md) — the same as the familiar
// avatars (FamiliarAvatar "sm" / the labeled trigger img) — so icons, toggles,
// and avatars all read at 16px.
assert.match(css, /\.menu-bar__task > svg\s*\{[\s\S]*?width:\s*var\(--icon-md\)[\s\S]*?height:\s*var\(--icon-md\)/, "task icon is var(--icon-md) (avatar size)");
assert.match(css, /\.menu-bar__search-icon\s*\{[\s\S]*?width:\s*var\(--icon-md\)[\s\S]*?height:\s*var\(--icon-md\)/, "search icon is var(--icon-md) (avatar size)");
// The sidepanel/nav toggle glyph and the familiar avatar share the same token.
const iconLib = readFileSync(new URL("../lib/icon.tsx", import.meta.url), "utf8");
assert.match(iconLib, /shellToggle:\s*"var\(--icon-md\)"/, "sidepanel toggle glyph is var(--icon-md)");
const avatar = readFileSync(new URL("./familiar-avatar.tsx", import.meta.url), "utf8");
assert.match(avatar, /sm:\s*16/, "familiar avatar 'sm' is 16px (= var(--icon-md))");
console.log("menu-bar-icon-size.test.ts passed");

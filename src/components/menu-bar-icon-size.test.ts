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
// Avatar tiles match the top-bar button/search height so the strip lines up.
assert.match(css, /\.menu-bar \.familiar-quickswitch__btn\s*\{[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px/, "menu-bar avatar tiles match the button height (28px)");
// ── Seamless ultra-minimal title bar (cave-r1f5) ─────────────────────────────
// The top strip shares the app canvas — no band color, no border seam — and
// its controls are quiet monochrome: ghost search, borderless icon chips.
assert.match(css, /\.shell-top \{[\s\S]*?background:\s*var\(--bg-base\)[\s\S]*?border-bottom:\s*0/, "shell-top is seamless (canvas background, no border seam)");
assert.match(css, /\.top-bar \{[\s\S]*?background:\s*var\(--bg-base\)[\s\S]*?border-bottom:\s*0/, "mobile top-bar matches the seamless treatment");
assert.match(css, /\.menu-bar__search \{[\s\S]*?border:\s*1px solid transparent[\s\S]*?background:\s*transparent/, "search is a ghost at rest (pill materializes on hover/focus)");
assert.match(css, /\.menu-bar__task-label \{\s*\n\s*display:\s*none/, "task labels are CSS-demoted — the bar shows icons only");
assert.match(css, /\.menu-bar__task-label--live \{\s*\n\s*display:\s*inline/, "…except live enrich progress, which is information, not chrome");
console.log("menu-bar-icon-size.test.ts passed");

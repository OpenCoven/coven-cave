// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// Top-bar action icons scale with their label (em), matching .menu-bar__search-icon.
assert.match(css, /\.menu-bar__task > svg\s*\{[\s\S]*?width:\s*1\.35em[\s\S]*?height:\s*1\.35em/, "task icon is 1.35em (matched to text, not dainty)");
// The search-row glyph scales with its row text the same way.
assert.match(css, /\.menu-bar__search-icon\s*\{[\s\S]*?width:\s*1\.35em[\s\S]*?height:\s*1\.35em/, "search icon is 1.35em");
console.log("menu-bar-icon-size.test.ts passed");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
// Top-bar action icons scale with their label (em), matching .menu-bar__search-icon.
assert.match(css, /\.menu-bar__task > svg\s*\{[\s\S]*?width:\s*1\.15em[\s\S]*?height:\s*1\.15em/, "task icon is 1.15em (balanced with text)");
console.log("menu-bar-icon-size.test.ts passed");

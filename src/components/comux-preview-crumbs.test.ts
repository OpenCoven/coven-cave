// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const comux = readFileSync(new URL("./comux-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(comux, /comux-preview-crumbs/, "preview path is a breadcrumb");
assert.match(comux, /comux-preview-crumb-sep/, "breadcrumb separators");
assert.match(comux, /const \[copiedPath, setCopiedPath\] = useState\(false\)/, "copy-path state");
assert.match(comux, /void copyText\(previewPath\)/, "copy-path copies the file path");
assert.match(comux, /aria-label="Copy file path"/, "copy-path button labeled");
assert.match(comux, /name=\{copiedPath \? "ph:check" : "ph:copy"\}/, "copy-path icon reflects state");
assert.match(css, /\.comux-preview-crumb-sep/, "breadcrumb separator styled");
console.log("comux-preview-crumbs.test.ts passed");

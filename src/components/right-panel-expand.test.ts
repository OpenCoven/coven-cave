// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");

assert.match(src, /allowExpand\??:\s*boolean/, "RightPanel takes allowExpand");
assert.match(src, /expanded\??:\s*boolean/, "RightPanel takes expanded");
assert.match(src, /onToggleExpand\??:\s*\(\)\s*=>\s*void/, "RightPanel takes onToggleExpand");
assert.match(src, /ph:arrows-out-simple/, "maximize icon present");
assert.match(src, /ph:arrows-in-simple/, "restore icon present");
assert.match(src, /aria-label="Expand panel"/, "maximize labelled");
assert.match(src, /aria-label="Restore panel"/, "restore labelled");
assert.match(src, /right-panel--expanded/, "expanded overlay class on the aside");
assert.match(src, /onSetPanel\("changes"\)/, "Changes is selectable as a tab when expanded");
assert.match(src, /rightExpanded/, "ChatSurface tracks rightExpanded");
assert.match(src, /chat-right-expanded/, "expanded overlay container");

console.log("right-panel-expand.test.ts: ok");

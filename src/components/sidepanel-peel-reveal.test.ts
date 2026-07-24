// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(
  new URL("../styles/globals/shell-navigation.css", import.meta.url),
  "utf8",
);

// Plain mode (no HTML-in-canvas, or reduced motion) must be layout-invisible.
assert.match(
  css,
  /\.shell-peel-reveal--plain,\s*\.shell-peel-reveal--plain > \.shell-peel-scroll \{\s*display: contents;/,
  "plain peel wrappers are display: contents",
);

// Live mode reproduces .shell-detail's scroll contract (the vendored content
// wrapper is overflow: hidden, so scrolling moves inside the sheet).
assert.match(
  css,
  /\.shell-peel-reveal--live \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?position: relative;/,
  "live peel wrapper is a positioned flex child",
);
assert.match(
  css,
  /\.shell-peel-reveal--live \.shell-peel-scroll \{[\s\S]*?height: 100%;[\s\S]*?overflow-y: auto;[\s\S]*?flex-direction: column;/,
  "live peel scroll host reproduces the detail scroll contract",
);

// The revealed under-layer backing uses tokens and matches the 232px peek.
assert.match(
  css,
  /\.shell-peel-under \{[\s\S]*?width: 232px;[\s\S]*?background: var\(--bg-raised\);[\s\S]*?border-right: 1px solid var\(--border-hairline\);/,
  "under layer is an opaque token-backed 232px sheet",
);

console.log("sidepanel-peel-reveal.test.ts: ok");

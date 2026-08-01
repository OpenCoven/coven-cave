// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const navigation = readFileSync(new URL("../styles/globals/shell-navigation.css", import.meta.url), "utf8");

assert.match(
  navigation,
  /\/\* Inset-shell layout:[\s\S]*?@media \(min-width: 1024px\) \{[\s\S]*?\.shell-nav-panel > \.shell-nav--peek \{[\s\S]*?border: 1px solid var\(--border-hairline\);[\s\S]*?border-radius: var\(--radius-panel\);[\s\S]*?box-shadow:[\s\S]*?var\(--shadow-color\);[\s\S]*?overflow-x: hidden;/,
  "the hover-peek sidebar keeps its token-driven floating silhouette on desktop",
);

assert.match(
  navigation,
  /\.shell-nav \{[\s\S]*?overflow-y: auto;/,
  "the shared sidebar remains vertically scrollable",
);

assert.match(
  navigation,
  /\.shell-nav-panel > \.shell-nav:not\(\.shell-nav--rail, \.shell-nav--peek\) \{[\s\S]*?flex: 1 1 auto;[\s\S]*?width: 100%;/,
  "expanded desktop navigation stays flush inside its existing panel allocation",
);

const detailRule = navigation.match(/\.shell-detail \{([\s\S]*?)\n\}/)?.[1] ?? "";
assert.doesNotMatch(
  detailRule,
  /border-(?:start-start|end-start)-radius|margin-inline-start/,
  "detail canvas no longer competes with the sidebar silhouette",
);
assert.match(
  navigation,
  /\.shell-detail-panel \{[\s\S]*?background: var\(--bg-panel\);[\s\S]*?\}/,
  "detail wrapper uses the panel-toned inset gutter",
);

assert.doesNotMatch(
  navigation,
  /\.shell-nav--rail \{[^}]*?(?:margin|border-radius|box-shadow):/,
  "collapsed icon rail does not become a second floating card",
);

console.log("sidebar-floating-edge.test.ts: ok");

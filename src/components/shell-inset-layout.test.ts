// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shellCss = readFileSync(
  new URL("../styles/globals/shell-navigation.css", import.meta.url),
  "utf8",
);
const responsiveCss = readFileSync(
  new URL("../styles/globals/shell-responsive.css", import.meta.url),
  "utf8",
);

assert.match(
  shellCss,
  /\.shell-body\s*\{[^}]*background:\s*var\(--bg-panel\);/,
  "the sidebar and inset gutter should share the shell floor",
);
assert.match(
  shellCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.shell-detail-panel\s*\{[^}]*padding:\s*var\(--space-2\);[^}]*background:\s*var\(--bg-panel\);/,
  "desktop detail should reserve an even tokenized inset around the main content",
);
assert.match(
  shellCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.shell-detail\s*\{[^}]*border:\s*1px solid var\(--border-hairline\);[^}]*border-radius:\s*var\(--radius-panel\);[^}]*box-shadow:/,
  "desktop main content should read as a rounded elevated panel",
);
assert.doesNotMatch(
  shellCss,
  /\.shell-nav-panel > \.shell-nav:not\(\.shell-nav--rail\)\s*\{[^}]*margin:/,
  "expanded navigation should sit on the shell floor instead of floating as a competing card",
);
assert.match(
  responsiveCss,
  /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.shell-detail-panel\s*\{[^}]*padding:\s*0;[^}]*background:\s*var\(--bg-base\);/,
  "mobile should remove the desktop inset gutter",
);
assert.match(
  responsiveCss,
  /@media \(max-width: 1023px\)\s*\{[\s\S]*?\.shell-detail\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/,
  "mobile detail should remain full-bleed without desktop card chrome",
);

// Migrated from sidebar-floating-edge.test.ts (deleted in this commit): that
// file pinned the pre-inversion design and failed on main for every open PR
// after "Adopt inset shell layout for detail content" (a212c9cca) changed the
// CSS without it. Everything else it asserted is either obsolete or already
// covered above; these two are neither, so they move here rather than being
// lost with the file.
assert.match(
  shellCss,
  /\.shell-nav \{[\s\S]*?overflow-y: auto;/,
  "the shared sidebar remains vertically scrollable",
);
assert.doesNotMatch(
  shellCss,
  /\.shell-nav--rail \{[^}]*?(?:margin|border-radius|box-shadow):/,
  "collapsed icon rail does not become a second floating card",
);

console.log("shell-inset-layout.test.ts: ok");

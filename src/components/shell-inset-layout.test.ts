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

// Carried over from sidebar-floating-edge.test.ts, which this file replaced.
// That test encoded the older "Dia-style floating sidebar edge" contract, which
// the inset layout deliberately reversed — its central assertion is the exact
// negation of the doesNotMatch above, so the two could never pass together. Most
// of it went with the design, but these two claims are orthogonal to whether the
// sidebar floats or sits flush, still hold, and were covered nowhere else. They
// are kept so retiring the obsolete file is not a silent loss of coverage.
// Whitespace-tolerant on purpose. These came over with exact-spacing regexes,
// which is a real hazard for the negative one below: if a reformat turned
// `.shell-nav--rail {` into `.shell-nav--rail{`, the pattern would stop matching
// and doesNotMatch would pass vacuously — the guard would go quiet exactly when
// it still looked green. Asserting on semantics rather than spacing keeps a
// formatting change from silently retiring the check.
assert.match(
  shellCss,
  /\.shell-nav\s*\{[\s\S]*?overflow-y:\s*auto;/,
  "the shared sidebar remains vertically scrollable",
);
assert.doesNotMatch(
  shellCss,
  /\.shell-nav--rail\s*\{[^}]*?(?:margin|border-radius|box-shadow)\s*:/,
  "collapsed icon rail does not become a second floating card",
);

console.log("shell-inset-layout.test.ts: ok");

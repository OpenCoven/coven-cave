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
const foundationsCss = readFileSync(
  new URL("../styles/globals/foundations.css", import.meta.url),
  "utf8",
);
const backdropCss = readFileSync(
  new URL("../styles/backdrop.css", import.meta.url),
  "utf8",
);

assert.match(
  shellCss,
  /\.shell-body\s*\{[^}]*background:\s*var\(--bg-panel\);/,
  "the nav pane's ground stays --bg-panel — the rail's shade is that ground plus .shell-nav's translucent paint, and moving it would move the rail",
);
// The gutter is the frame, so it reads the rail's own rendered shade rather
// than the bare ground beneath the rail. Pinned because the two used to be the
// same token, which made the mismatch invisible in review.
assert.match(
  foundationsCss,
  /--shell-floor:\s*color-mix\(in oklch, var\(--bg-raised\) 88%, var\(--bg-panel\)\);/,
  "the frame token should be the flat equivalent of .shell-nav's 88% --bg-raised over --bg-panel",
);
assert.match(
  shellCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?\.shell-detail-panel\s*\{[^}]*padding:\s*var\(--space-2\);[^}]*background:\s*var\(--shell-floor\);/,
  "desktop detail should reserve an even tokenized inset around the main content, painted in the frame color",
);
// With a backdrop up, the pane goes transparent so the image shows through the
// content — which also handed the gutter to the fixed z-0 layer. The band is
// repainted above it; without these the frame silently bleeds again.
assert.match(
  backdropCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?html\[data-backdrop-on\] \.shell-detail-panel::before\s*\{[\s\S]*?background-image:[\s\S]*?linear-gradient\(var\(--shell-floor\) 0 0\)/,
  "a backdrop-on gutter should be repainted in the frame color above the backdrop layer",
);
assert.match(
  backdropCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?html\[data-backdrop-on\] \.shell-detail-panel::before\s*\{[\s\S]*?background-size:\s*\n?\s*100% var\(--space-2\),\s*\n?\s*var\(--space-2\) 100%,\s*\n?\s*100% var\(--space-2\),\s*\n?\s*var\(--space-2\) 100%;/,
  "the repaint must be four strips the width of the gutter, never a fill over the content box",
);
assert.match(
  backdropCss,
  /html\[data-backdrop-on\] \.shell-detail\s*\{\s*box-shadow:\s*\n?\s*0 0 0 var\(--space-2\) var\(--shell-floor\),/,
  "the content's rounded corners need the same color spread behind them, or the image shows in the four wedges the strips cannot reach",
);
// The pane must stay transparent even though it is positioned for the strips:
// positioning lifts it over the z-0 layer, so any opaque paint here covers the
// image across the whole box, hero included.
assert.match(
  backdropCss,
  /@media \(min-width: 1024px\)\s*\{[\s\S]*?html\[data-backdrop-on\] \.shell-detail-panel\s*\{[^}]*position:\s*relative;[^}]*background:\s*transparent;/,
  "the positioned detail pane must paint nothing itself — the strips own the gutter",
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
// The collapsed icon rail must not grow a card silhouette of its own.
//
// This guard used to be a regex for `.shell-nav--rail { … }` and could never
// fire: shell-navigation.css has no such rule. Every occurrence of the class is
// either a `:not(.shell-nav--rail)` exclusion or a descendant selector like
// `.shell-nav--rail .code-sidebar__rail`, so the pattern matched nothing and
// doesNotMatch passed vacuously. Rail rules could have added border-radius and
// the test would have stayed green (cave-djfpx).
//
// What matters is the SUBJECT of the selector — the element the rule actually
// styles. `:not(.shell-nav--rail)` names the rail to exclude it, and a
// descendant rule styles a child, not the rail; neither makes the rail a card.
function railSubjectRules(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const [, selectorList, body] of withoutComments.matchAll(pattern)) {
    // Strip `:not(...)` from the WHOLE list before splitting on commas.
    // `.shell-nav:not(.shell-nav--rail, .shell-nav--peek)` carries a comma
    // INSIDE the parentheses, so splitting first tears it in half and leaves
    // the fragment `.shell-nav:not(.shell-nav--rail`, whose subject still
    // contains the class — an exclusion rule then reads as a rail-subject one.
    // That passes today only because the rule happens not to set margin,
    // border-radius or box-shadow; the day the expanded nav gains one, the
    // guard fires on the wrong rule.
    const targetsRail = selectorList
      .replace(/:not\([^)]*\)/g, "")
      .split(",")
      .map((selector) => selector.trim())
      .some((selector) => {
        const subject = selector.split(/[\s>+~]+/).filter(Boolean).at(-1) ?? "";
        return subject.includes(".shell-nav--rail");
      });
    if (targetsRail) rules.push(body);
  }
  return rules;
}

const CARD_DECLARATION = /(?:^|;)\s*(?:margin|border-radius|box-shadow)\s*:/;

// Positive control FIRST. A guard that cannot fail is worse than no guard,
// because it reads as coverage — which is exactly how the previous version
// survived. If this stops matching, the extractor broke and every assertion
// below it is meaningless.
const railProbe = railSubjectRules(`
  @media (min-width: 1024px) {
    .shell-nav-panel > .shell-nav--rail { box-shadow: 0 1px 2px black; }
  }
  .shell-nav-panel > .shell-nav:not(.shell-nav--rail) { border-radius: 8px; }
  .shell-nav--rail .code-sidebar__rail { border-radius: 8px; }
  .shell-nav-panel > .shell-nav:not(.shell-nav--rail, .shell-nav--peek) { border-radius: 8px; }
`);
assert.equal(
  railProbe.length,
  1,
  "extractor selects rail-subject rules inside at-rules without selecting exclusions or descendants",
);
assert.match(railProbe[0]!, CARD_DECLARATION, "extractor reaches the declarations");

for (const body of railSubjectRules(shellCss)) {
  assert.doesNotMatch(
    body,
    CARD_DECLARATION,
    "collapsed icon rail does not become a second floating card",
  );
}

console.log("shell-inset-layout.test.ts: ok");

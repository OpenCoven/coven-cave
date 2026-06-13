// @ts-nocheck
// Cross-check: the catalog (data) vs the runtime declarations (src/app/fonts.ts)
// + the root layout wiring. font-catalog.ts on its own can list cssVars that
// nothing declares — this test fails if a catalog entry has no matching
// `next/font/google` instance, or if the layout stops applying them to <html>.
// Source is read as text (not imported): next/font only resolves under the
// Next build, so importing fonts.ts in the node test runner would throw.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FONT_OPTIONS } from "./font-catalog.ts";

const fontsSrc = readFileSync(new URL("../app/fonts.ts", import.meta.url), "utf8");
const layoutSrc = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

// 1. Every catalog cssVar is declared as a next/font variable in fonts.ts.
for (const o of FONT_OPTIONS) {
  assert.ok(
    fontsSrc.includes(`variable: "${o.cssVar}"`),
    `fonts.ts must declare a next/font instance with variable: "${o.cssVar}" for "${o.id}"`,
  );
}

// 2. fonts.ts exports the joined class string the layout consumes.
assert.match(
  fontsSrc,
  /export const fontVariables\s*=/,
  "fonts.ts must export `fontVariables`",
);

// 3. The root layout imports fontVariables and spreads it onto <html>, so the
//    declared `.variable` classes actually reach the DOM.
assert.match(
  layoutSrc,
  /import\s*\{\s*fontVariables\s*\}\s*from\s*["']\.\/fonts["']/,
  "layout.tsx must import { fontVariables } from ./fonts",
);
const htmlTag = layoutSrc.match(/<html[\s\S]*?>/);
assert.ok(htmlTag, "layout.tsx must render an <html> element");
assert.match(
  htmlTag[0],
  /\$\{fontVariables\}/,
  "layout.tsx must apply ${fontVariables} to the <html> className",
);

// 4. Guard against the regression we just fixed: no per-font next/font import
//    should linger in layout.tsx — fonts.ts is the single source of truth.
assert.doesNotMatch(
  layoutSrc,
  /from\s+["']next\/font\/google["']/,
  "layout.tsx must not declare fonts directly; they live in src/app/fonts.ts",
);

console.log("font-wiring.test.ts OK");

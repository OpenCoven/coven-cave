// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ───── Shell enforces symmetric min/max on the side panels ─────
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

const navPanelMatch = shell.match(
  /<Panel\s+id="nav"[\s\S]*?<\/Panel>/,
);
assert.ok(navPanelMatch, "nav Panel block must exist in shell.tsx");
assert.match(
  navPanelMatch[0],
  /minSize="16%"/,
  "nav panel minSize is 16%",
);
assert.match(
  navPanelMatch[0],
  /maxSize="28%"/,
  "nav panel maxSize is 28%",
);

const agentPanelMatch = shell.match(
  /<Panel\s+id="agent"[\s\S]*?<\/Panel>/,
);
assert.ok(agentPanelMatch, "agent Panel block must exist in shell.tsx");
assert.match(
  agentPanelMatch[0],
  /minSize="16%"/,
  "agent panel minSize is 16% (symmetric with nav)",
);
assert.match(
  agentPanelMatch[0],
  /maxSize="28%"/,
  "agent panel maxSize is 28% (symmetric with nav)",
);

// ───── Home composer is detail-panel centered for true equidistance ─────
const css = await readFile(
  new URL("../styles/home-composer.css", import.meta.url),
  "utf8",
);

const rootMatch = css.match(/\.home-composer-root\s*\{([^}]*)\}/);
assert.ok(rootMatch, ".home-composer-root rule must exist");

// No transform/asymmetry hack — the composer is just centered inside its
// own panel. With symmetric panel min/max enforced by the Shell, that
// naturally yields equal gaps to both side-panel edges.
assert.doesNotMatch(
  rootMatch[1],
  /transform:/,
  ".home-composer-root must not apply transform (equidistance comes from detail-panel centering)",
);
assert.doesNotMatch(
  rootMatch[1],
  /--hc-asymmetry/,
  ".home-composer-root must not reference --hc-asymmetry (legacy from viewport-centering attempt)",
);

// Card wrap and suggestions cap at 880px with no asymmetry math.
assert.match(
  css,
  /\.home-composer-card-wrap\s*\{[\s\S]*?max-width:\s*880px;/,
  ".home-composer-card-wrap caps at 880px",
);
assert.match(
  css,
  /\.home-composer-suggestions\s*\{[\s\S]*?max-width:\s*880px;/,
  ".home-composer-suggestions caps at 880px",
);

// ───── Mobile polish ─────
const globals = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

// Top-bar collapses search to icon-only on phones (< 640px) so bell + cog
// remain visible.
assert.match(
  globals,
  /@media \(max-width: 639px\)\s*\{[\s\S]*?\.top-bar__search\s*\{[\s\S]*?min-width:\s*0;/,
  "@media (max-width: 639px) resets .top-bar__search min-width",
);
assert.match(
  globals,
  /@media \(max-width: 639px\)\s*\{[\s\S]*?\.top-bar__search > span,[\s\S]*?\.top-bar__search kbd\s*\{[\s\S]*?display:\s*none;/,
  "phone breakpoint hides the search label + kbd hint",
);

// Phone (max-width: 767px) hides the side panels by targeting BOTH the
// className-bearing inner wrapper AND the `<div data-panel id="..">` outer
// wrapper that react-resizable-panels controls via inline flex-basis.
assert.match(
  globals,
  /\[data-panel="true"\]#nav,\s*\[data-panel="true"\]#list,\s*\[data-panel="true"\]#agent\s*\{\s*display:\s*none\s*!important/,
  "phone breakpoint hides Panel outer wrappers (data-panel id targeting)",
);

// Touch devices hide the keyboard hint strip.
assert.match(
  css,
  /@media \(pointer: coarse\)\s*\{[\s\S]*?\.hc-keyboard-hint\s*\{[\s\S]*?display:\s*none;/,
  "@media (pointer: coarse) hides .hc-keyboard-hint",
);

// Suggestion chips truncate their label cleanly inside the chip's max-width.
assert.match(
  css,
  /\.hc-suggestion\s*\{[\s\S]*?max-width:\s*min\(100%, 360px\);/,
  ".hc-suggestion caps width at 360px",
);
assert.match(
  css,
  /\.hc-suggestion > span\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/,
  ".hc-suggestion > span uses text-overflow: ellipsis + nowrap",
);

// Phone-portrait composer is anchored toward the top instead of dead-center.
assert.match(
  css,
  /@media \(max-width: 639px\)\s*\{[\s\S]*?\.home-composer-root\s*\{[\s\S]*?justify-content:\s*flex-start;[\s\S]*?padding-top:\s*clamp\(/,
  "phone breakpoint anchors .home-composer-root to flex-start with padding-top clamp",
);

console.log("home-composer-centering.test.ts: ok");

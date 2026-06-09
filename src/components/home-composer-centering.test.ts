// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ───── Shell exposes panel pixel widths as CSS variables ─────
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

assert.match(
  shell,
  /const \[navWidthPx, setNavWidthPx\] = useState\(0\);/,
  "Shell tracks navWidthPx state",
);
assert.match(
  shell,
  /const \[agentWidthPx, setAgentWidthPx\] = useState\(0\);/,
  "Shell tracks agentWidthPx state",
);
assert.match(
  shell,
  /setNavWidthPx\(size\.inPixels \?\? 0\)/,
  "Nav panel onResize updates navWidthPx via size.inPixels",
);
assert.match(
  shell,
  /setAgentWidthPx\(size\.inPixels \?\? 0\)/,
  "Agent panel onResize updates agentWidthPx via size.inPixels",
);
assert.match(
  shell,
  /"--shell-nav-px": `\$\{Math\.round\(navWidthPx\)\}px`/,
  "Shell exposes --shell-nav-px on .shell-frame",
);
assert.match(
  shell,
  /"--shell-agent-px": `\$\{Math\.round\(agentWidthPx\)\}px`/,
  "Shell exposes --shell-agent-px on .shell-frame",
);
assert.match(
  shell,
  /style=\{shellFrameStyle\}/,
  ".shell-frame receives the custom-property style object",
);

// ───── Home composer reads the variables and centers on viewport ─────
const css = await readFile(
  new URL("../styles/home-composer.css", import.meta.url),
  "utf8",
);

// --hc-asymmetry: abs(nav - agent) — the cards are narrowed by this so the
// composer can translate all the way to viewport center without overflowing
// under a side panel.
assert.match(
  css,
  /--hc-asymmetry:\s*max\(\s*calc\(var\(--shell-nav-px, 0px\) - var\(--shell-agent-px, 0px\)\),\s*calc\(var\(--shell-agent-px, 0px\) - var\(--shell-nav-px, 0px\)\)\s*\)/,
  "--hc-asymmetry computed as abs(nav - agent)",
);

// --hc-max-shift includes the asymmetry/2 term so the clamp upper bound
// grows with the asymmetry once the cards have been narrowed.
assert.match(
  css,
  /--hc-max-shift:\s*max\([\s\S]*?calc\(var\(--hc-asymmetry\) \/ 2\)[\s\S]*?\)/,
  "--hc-max-shift includes asymmetry/2",
);

// --hc-ideal-shift = (agent - nav) / 2
assert.match(
  css,
  /--hc-ideal-shift:\s*calc\(\s*\(var\(--shell-agent-px, 0px\) - var\(--shell-nav-px, 0px\)\) \/ 2\s*\)/,
  "--hc-ideal-shift = (agent - nav) / 2",
);

// transform uses clamp(-max, ideal, max) so the shift is bounded.
assert.match(
  css,
  /transform:\s*translateX\(\s*clamp\(\s*calc\(-1 \* var\(--hc-max-shift\)\),\s*var\(--hc-ideal-shift\),\s*var\(--hc-max-shift\)\s*\)\s*\)/,
  "transform: translateX(clamp(-max, ideal, max))",
);

// Composer card wrap + suggestions use the widened 1200px max-width minus
// --hc-asymmetry so they don't overflow when the layout is asymmetric.
assert.match(
  css,
  /\.home-composer-card-wrap\s*\{[\s\S]*?max-width:\s*min\(1200px,\s*calc\(100% - var\(--hc-asymmetry, 0px\)\)\)/,
  ".home-composer-card-wrap uses 1200px asymmetry-aware max-width",
);
assert.match(
  css,
  /\.home-composer-suggestions\s*\{[\s\S]*?max-width:\s*min\(1200px,\s*calc\(100% - var\(--hc-asymmetry, 0px\)\)\)/,
  ".home-composer-suggestions uses 1200px asymmetry-aware max-width",
);

// The card itself inherits the constraint from its wrap — must NOT subtract
// --hc-asymmetry a second time (that bug was caught during development).
const cardRuleMatch = css.match(/\.home-composer-card\s*\{([^}]*)\}/);
assert.ok(cardRuleMatch, ".home-composer-card rule must exist");
assert.doesNotMatch(
  cardRuleMatch[1],
  /var\(--hc-asymmetry/,
  ".home-composer-card body must not reference --hc-asymmetry (would double-subtract)",
);
assert.match(
  cardRuleMatch[1],
  /max-width:\s*100%/,
  ".home-composer-card body uses max-width: 100% (inherits from wrap)",
);

// Old narrow max-width is gone.
assert.doesNotMatch(
  css,
  /\.home-composer-card-wrap\s*\{[\s\S]*?max-width:\s*760px/,
  "old 760px max-width on .home-composer-card-wrap removed",
);
assert.doesNotMatch(
  css,
  /\.home-composer-suggestions\s*\{[\s\S]*?max-width:\s*760px/,
  "old 760px max-width on .home-composer-suggestions removed",
);

// ───── globals.css lets the detail panel overflow when it's home mode ─────
const globals = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
assert.match(
  globals,
  /\.shell-detail-panel:has\(> \.shell-detail > \.cave-mode-fade > \.home-composer-root\)\s*\{\s*overflow:\s*visible\s*!important/,
  "globals.css opens .shell-detail-panel overflow when it contains the home composer",
);

console.log("home-composer-centering.test.ts: ok");

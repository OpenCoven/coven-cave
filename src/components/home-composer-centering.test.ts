// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ───── Shell measures the detail panel's real viewport gaps ─────
//
// The Home composer centers on the VIEWPORT, not on the asymmetric
// .shell-detail panel. Two requirements drove the current design (both were
// real bugs, caught with a Playwright probe at 1512×945):
//
//   1. "Centered at start" — the old implementation fed the CSS vars from
//      react-resizable-panels' onResize callbacks, which land AFTER first
//      paint. The home content painted ~nav/2 (≈123px) off-center, then slid
//      into place ~1s later. The Shell must therefore measure synchronously
//      before paint (useLayoutEffect) so the first painted frame is centered.
//
//   2. "Centered, period" — the old vars only carried the nav/agent PANEL
//      widths, ignoring separators and the right-edge agent-trigger rail
//      (≈22px), leaving a permanent ~11px bias. The Shell must therefore
//      expose the detail panel's actual left/right gaps (everything between
//      the detail box and the viewport edges), not a partial reconstruction.
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

assert.match(
  shell,
  /useLayoutEffect/,
  "Shell measures with useLayoutEffect (before paint, not after)",
);
assert.match(
  shell,
  /const \[detailGaps, setDetailGaps\] = useState/,
  "Shell tracks detailGaps state ({ left, right })",
);
assert.match(
  shell,
  /getBoundingClientRect\(\)/,
  "Shell reads the detail element's bounding rect",
);
assert.match(
  shell,
  /window\.innerWidth - rect\.right/,
  "right gap derived from viewport width minus detail right edge",
);
assert.match(
  shell,
  /new ResizeObserver\(measure\)/,
  "Shell keeps gaps fresh with its own ResizeObserver",
);
assert.match(
  shell,
  /"--shell-left-gap-px": `\$\{detailGaps\.left\}px`/,
  "Shell exposes --shell-left-gap-px on .shell-frame",
);
assert.match(
  shell,
  /"--shell-right-gap-px": `\$\{detailGaps\.right\}px`/,
  "Shell exposes --shell-right-gap-px on .shell-frame",
);
assert.match(
  shell,
  /style=\{shellFrameStyle\}/,
  ".shell-frame receives the custom-property style object",
);

// The old panel-width plumbing must be gone — it was both late (post-paint)
// and incomplete (panels only, no rails/separators).
assert.doesNotMatch(shell, /navWidthPx|agentWidthPx/, "old panel-width state removed");
assert.doesNotMatch(shell, /--shell-nav-px|--shell-agent-px/, "old panel-width vars removed");

// Startup settle gate: the panel library applies its persisted layout one
// frame after first paint, so the gap correction lands a frame late. The
// Shell marks the frame [data-settled] only after startup, and the CSS keys
// the centering transition off that — the startup correction snaps
// invisibly instead of gliding across the screen on every launch.
assert.match(
  shell,
  /const \[settled, setSettled\] = useState\(false\)/,
  "Shell tracks startup settled state",
);
assert.match(
  shell,
  /data-settled=\{settled \? "" : undefined\}/,
  ".shell-frame exposes [data-settled] after startup",
);

// ───── Home composer reads the variables and centers on viewport ─────
const css = await readFile(
  new URL("../styles/home-composer.css", import.meta.url),
  "utf8",
);

// --hc-asymmetry: abs(left - right) — the cards are narrowed by this so the
// composer can translate all the way to viewport center without overflowing
// under a side panel.
assert.match(
  css,
  /--hc-asymmetry:\s*max\(\s*calc\(var\(--shell-left-gap-px, 0px\) - var\(--shell-right-gap-px, 0px\)\),\s*calc\(var\(--shell-right-gap-px, 0px\) - var\(--shell-left-gap-px, 0px\)\)\s*\)/,
  "--hc-asymmetry computed as abs(left - right)",
);

// --hc-max-shift includes the asymmetry/2 term so the clamp upper bound
// grows with the asymmetry once the cards have been narrowed.
assert.match(
  css,
  /--hc-max-shift:\s*max\([\s\S]*?calc\(var\(--hc-asymmetry\) \/ 2\)[\s\S]*?\)/,
  "--hc-max-shift includes asymmetry/2",
);

// --hc-ideal-shift = (right - left) / 2
assert.match(
  css,
  /--hc-ideal-shift:\s*calc\(\s*\(var\(--shell-right-gap-px, 0px\) - var\(--shell-left-gap-px, 0px\)\) \/ 2\s*\)/,
  "--hc-ideal-shift = (right - left) / 2",
);

// transform uses clamp(-max, ideal, max) so the shift is bounded.
assert.match(
  css,
  /transform:\s*translateX\(\s*clamp\(\s*calc\(-1 \* var\(--hc-max-shift\)\),\s*var\(--hc-ideal-shift\),\s*var\(--hc-max-shift\)\s*\)\s*\)/,
  "transform: translateX(clamp(-max, ideal, max))",
);

// Centering transition only runs after startup has settled.
const rootRuleMatch = css.match(/\.home-composer-root\s*\{[\s\S]*?\n\}/);
assert.ok(rootRuleMatch, ".home-composer-root rule must exist");
assert.match(
  rootRuleMatch[0],
  /transition:\s*none/,
  ".home-composer-root has no transition at startup",
);
assert.match(
  css,
  /\.shell-frame\[data-settled\] \.home-composer-root\s*\{\s*transition:\s*transform 120ms ease-out;\s*\}/,
  "centering transition enabled only under .shell-frame[data-settled]",
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

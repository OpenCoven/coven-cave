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

assert.match(
  shell,
  /const homeCenteringActive = navOpen && agentOpen/,
  "Home viewport-centering only activates when nav and agent panels are both open",
);
assert.match(
  shell,
  /const homeCenterShift = homeCenteringActive\s*\?\s*Math\.round\(\(detailGaps\.right - detailGaps\.left\) \/ 2\)\s*:\s*0/,
  "Home center shift is zero for one-sided panel layouts",
);
assert.match(
  shell,
  /"--shell-home-center-shift-px": `\$\{homeCenterShift\}px`/,
  "Shell exposes --shell-home-center-shift-px on .shell-frame",
);

// The viewport-centering shift is an IDEAL the CSS hard-bounds to the detail
// panel's own slack. The asymmetry-narrowing plumbing is gone: it squeezed the
// composer to a clipped sliver and shifted it under an open side panel (notably
// the native browser webview on the right edge).
assert.doesNotMatch(
  shell,
  /homeCenterAsymmetry|--shell-home-asymmetry-px/,
  "old asymmetry-narrowing plumbing removed from Shell",
);
assert.doesNotMatch(
  css,
  /--hc-asymmetry/,
  "old --hc-asymmetry narrowing removed from CSS",
);

// --hc-max-shift is bounded to the slack around the 1200px content cap only, so
// the composer can never overflow the detail panel into an open side panel.
// When a side panel is wide enough that the detail panel is under 1200px, the
// slack is zero and the composer centers in the detail panel at full width.
assert.match(
  css,
  /--hc-max-shift:\s*max\(0px,\s*calc\(\(100% - 1200px\) \/ 2\)\)/,
  "--hc-max-shift is bounded to the 1200px-cap slack only (no panel overflow)",
);

// --hc-ideal-shift is zero in one-sided layouts and (right - left) / 2 when
// Shell marks viewport-centering active.
assert.match(
  css,
  /--hc-ideal-shift:\s*var\(--shell-home-center-shift-px, 0px\)/,
  "--hc-ideal-shift uses the shell-provided active shift",
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

// Composer card wrap + suggestions cap at 1200px but otherwise fill the detail
// panel's available width, so a wide side panel yields a full-width centered
// composer rather than a narrowed sliver.
assert.match(
  css,
  /\.home-composer-card-wrap\s*\{[\s\S]*?max-width:\s*min\(1200px,\s*100%\)/,
  ".home-composer-card-wrap caps at 1200px and fills available width",
);
assert.match(
  css,
  /\.home-composer-suggestions\s*\{[\s\S]*?max-width:\s*min\(1200px,\s*100%\)/,
  ".home-composer-suggestions caps at 1200px and fills available width",
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

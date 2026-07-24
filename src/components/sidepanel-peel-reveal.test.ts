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
  /\.shell-peel-reveal--live \{[^}]*?flex: 1;[^}]*?min-height: 0;[^}]*?position: relative;/,
  "live peel wrapper is a positioned flex child",
);
assert.match(
  css,
  /\.shell-peel-reveal--live \.shell-peel-scroll \{[^}]*?height: 100%;[^}]*?overflow-y: auto;[^}]*?flex-direction: column;/,
  "live peel scroll host reproduces the detail scroll contract",
);

// The revealed under-layer backing uses tokens and matches the 232px peek.
assert.match(
  css,
  /\.shell-peel-under \{[^}]*?width: 232px;[^}]*?background: var\(--bg-raised\);[^}]*?border-right: 1px solid var\(--border-hairline\);/,
  "under layer is an opaque token-backed 232px sheet",
);

const wrapper = readFileSync(
  new URL("./shell-peel-reveal.tsx", import.meta.url),
  "utf8",
);
const vendored = readFileSync(
  new URL("./canvasui/Peel.tsx", import.meta.url),
  "utf8",
);

// The ~22 KB vendored WebGL file loads lazily and never renders on the server.
assert.match(
  wrapper,
  /const Peel = dynamic\(\(\) => import\("@\/components\/canvasui\/Peel"\), \{ ssr: false \}\)/,
  "vendored Peel is dynamically imported with ssr: false",
);

// Enhancement gates: local capability probe (false on the server) + reduced motion.
assert.match(
  wrapper,
  /useSyncExternalStore\(emptySubscribe, probeHtmlInCanvas, \(\) => false\)/,
  "capability probe returns false as the server snapshot",
);
assert.match(
  wrapper,
  /const enhanced = supported && !reducedMotion;/,
  "reduced motion disables the enhancement entirely",
);

// Permanent mount: `active` swaps geometry options, never mounts/unmounts Peel,
// so toggling the nav can't re-parent (and remount) the detail tree.
assert.match(
  wrapper,
  /OFF_OPTIONS = \{ reveal: 0, zone: 0 \}/,
  "inactive geometry collapses to zero via options",
);
assert.match(
  wrapper,
  /\{\.\.\.\(active \? LIVE_OPTIONS : OFF_OPTIONS\)\}/,
  "active drives options, not mounting",
);

// The revealed sidebar clone is decorative: hidden from AT and uninteractive.
assert.match(
  wrapper,
  /<div className="shell-peel-under" aria-hidden inert>/,
  "under layer is aria-hidden and inert",
);

// WebGL context loss re-mounts the vendored component, capped (cave-kbh1).
assert.match(wrapper, /key=\{glEpoch\}/, "epoch key re-mounts on context loss");
assert.match(
  wrapper,
  /MAX_CONTEXT_RESTARTS = 3/,
  "context-loss restarts are capped",
);

// Plain path renders the stable display:contents wrappers.
assert.match(
  wrapper,
  /className="shell-peel-reveal shell-peel-reveal--plain"/,
  "plain path renders the contents wrapper",
);

// Vendored file keeps its provenance and stays the module the wrapper imports.
assert.match(
  vendored,
  /Vendored from Canvas UI — https:\/\/canvasui\.dev\/docs\/components\/peel/,
  "vendored Peel carries the provenance header",
);
assert.match(vendored, /peel-react\.json/, "provenance cites the registry item");
assert.match(vendored, /export default Peel;/, "vendored Peel default-exports");

console.log("sidepanel-peel-reveal.test.ts: ok");

// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./calls-view.tsx", import.meta.url), "utf8");
const graph3dSource = await readFile(new URL("./trace-graph-3d.tsx", import.meta.url), "utf8");
const packageJson = await readFile(new URL("../../package.json", import.meta.url), "utf8");

assert.match(
  source,
  /buildDelegationGraph\(\{/,
  "Calls view should build a provenance-aware graph model instead of rendering raw aggregate edges",
);

assert.match(
  source,
  /Include inferred/,
  "Delegations graph should expose an Include inferred control",
);

assert.match(
  source,
  /data-testid="calls-attention-strip"/,
  "Delegations view should expose an attention strip above the graph",
);

assert.match(
  source,
  /function CallsToolbar/,
  "Delegations controls should be grouped in a dedicated toolbar component",
);

assert.match(
  source,
  /Busiest route/,
  "Delegations attention/inspector should surface the busiest route without requiring selection",
);

assert.match(
  source,
  /Latest trace/,
  "Delegations attention/inspector should surface latest trace context without requiring selection",
);

assert.match(
  source,
  /<TraceGraph3D[\s\S]*graph=\{graph\}/,
  "Delegations view should render the 3D trace graph as the primary graph surface",
);

assert.match(
  source,
  /fetch\("\/api\/coven-memory"/,
  "Delegations view should load coven memory counts for familiar nodes",
);

assert.match(
  source,
  /memoryCounts=\{memoryCounts\}/,
  "Delegations view should pass memory counts into the 3D trace graph",
);

assert.match(
  graph3dSource,
  /import \* as THREE from "three"/,
  "3D trace graph should use Three.js for the graph scene",
);

assert.match(
  graph3dSource,
  /from "three\/addons\/controls\/OrbitControls\.js"/,
  "3D trace graph should use Three.js OrbitControls instead of custom camera controls",
);

assert.match(
  graph3dSource,
  /data-testid="trace-graph-3d-canvas"/,
  "3D trace graph should expose a stable canvas test id for visual verification",
);

assert.match(
  graph3dSource,
  /aria-label="3D delegation trace graph"/,
  "3D trace graph canvas should have an accessible label",
);

assert.match(
  graph3dSource,
  /role="application"/,
  "3D trace graph should expose an interactive canvas role",
);

assert.match(
  graph3dSource,
  /tabIndex=\{0\}/,
  "3D trace graph canvas should be keyboard focusable",
);

assert.match(
  graph3dSource,
  /aria-live="polite"/,
  "3D trace graph should expose a DOM status mirror outside WebGL",
);

assert.match(
  graph3dSource,
  /Focus selected/,
  "3D trace graph should include a focus control for selected traces",
);

assert.match(
  graph3dSource,
  /Reset view/,
  "3D trace graph should include a reset view control",
);

assert.match(
  graph3dSource,
  /prefers-reduced-motion/,
  "3D trace graph should respect reduced motion preferences",
);

assert.match(
  graph3dSource,
  /ConeGeometry/,
  "3D trace graph should render directional arrowheads for route direction",
);

assert.match(
  graph3dSource,
  /LineDashedMaterial/,
  "3D trace graph should preserve inferred-route dashed styling",
);

assert.match(
  graph3dSource,
  /memoryCounts\?: Map<string, number>/,
  "3D trace graph should accept optional memory counts",
);

assert.match(
  graph3dSource,
  /0xf59e0b/,
  "3D trace graph should render amber memory presence rings",
);

assert.match(
  graph3dSource,
  /> memory<\/span>/,
  "3D trace graph legend should explain memory presence",
);

assert.doesNotMatch(
  graph3dSource,
  /selectedKey\]/,
  "3D trace graph should not rebuild the renderer on every selection change",
);

assert.match(
  packageJson,
  /"three":/,
  "Cave should declare Three.js as a dependency for the 3D trace graph",
);

// ── Trace timeline: honest count + no silent truncation ──────────────────────
// The list caps rendered rows for perf; the header badge and a footer note must
// stay honest about traces beyond the cap rather than claiming "N visible" while
// silently dropping the rest.
assert.match(source, /const MAX_VISIBLE_TRACES = \d+/, "trace list cap is a named constant");
assert.match(source, /const shown = traces\.slice\(0, MAX_VISIBLE_TRACES\)/, "renders the capped slice via `shown`");
// The list must render `shown`, never the full set, so the badge/footer counts
// can't drift from what's actually on screen.
assert.doesNotMatch(source, /traces\.slice\(0, 30\)/, "no inline magic-number slice (use MAX_VISIBLE_TRACES)");
assert.match(
  source,
  /hiddenCount > 0 \? `\$\{shown\.length\} of \$\{traces\.length\}`/,
  'header badge shows "<shown> of <total>" when traces are hidden',
);
assert.match(
  source,
  /hiddenCount > 0 &&[\s\S]{0,200}Showing the newest \{shown\.length\} of \{traces\.length\}/,
  "a footer note discloses how many older traces are hidden",
);

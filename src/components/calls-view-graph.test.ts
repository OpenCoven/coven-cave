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
  /<TraceGraph3D[\s\S]*graph=\{graph\}/,
  "Delegations view should render the 3D trace graph as the primary graph surface",
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

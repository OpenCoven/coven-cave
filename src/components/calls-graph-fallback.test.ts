// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const callsView = readFileSync(new URL("./calls-view.tsx", import.meta.url), "utf8");
const fallback = readFileSync(new URL("./trace-graph-fallback.tsx", import.meta.url), "utf8");

// The 2D delegation list is now the ONLY graph surface (the Three.js 3D scene
// and its WebGL error boundary were removed). It renders unconditionally — no
// mobile branch, no boundary wrapper, no 3D child.
assert.match(
  callsView,
  /<TraceGraphFallback[\s\S]*?graph=\{graph\}[\s\S]*?edgeKey=\{edgeKey\}[\s\S]*?\/>/,
  "calls view renders the 2D delegation list directly as the graph surface",
);
assert.doesNotMatch(callsView, /WebGLErrorBoundary/, "no WebGL error boundary remains");
assert.doesNotMatch(callsView, /TraceGraph3D/, "no 3D graph remains");

// The fallback preserves the delegation data + selection round-trip.
assert.match(fallback, /onSelect\(\{ kind: "edge", key \}\)/, "fallback rows select the same edge keys as the graph");
assert.match(
  fallback,
  /familiarName\(familiars, edge\.caller\)[\s\S]*familiarName\(familiars, edge\.callee\)/,
  "fallback shows caller → callee for every edge",
);
assert.match(fallback, /var\(--touch-target\)/, "fallback rows meet the shared touch target");
// reason is now optional (no 3D to "fall back" from); default header is neutral.
assert.match(fallback, /reason\?: "mobile" \| "webgl"/, "reason is optional now that the 2D view is primary");

console.log("calls-graph-fallback.test.ts: ok");

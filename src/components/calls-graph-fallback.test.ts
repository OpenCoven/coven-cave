// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const callsView = readFileSync(new URL("./calls-view.tsx", import.meta.url), "utf8");
const fallback = readFileSync(new URL("./trace-graph-fallback.tsx", import.meta.url), "utf8");
const boundary = readFileSync(new URL("./webgl-error-boundary.tsx", import.meta.url), "utf8");

// On mobile the 2D list renders directly — Three.js never instantiates.
assert.match(callsView, /const isMobile = useIsMobile\(\)/, "calls view observes the mobile breakpoint");
assert.match(
  callsView,
  /isMobile \? \(\s*<TraceGraphFallback[\s\S]*?reason="mobile"/,
  "mobile renders the 2D delegation list instead of the 3D graph",
);

// On desktop the 3D graph is wrapped in an error boundary whose fallback is the
// same 2D list, so a WebGL context failure degrades to the list (not a blank box).
assert.match(
  callsView,
  /<WebGLErrorBoundary[\s\S]*?fallback=\{[\s\S]*?<TraceGraphFallback[\s\S]*?reason="webgl"[\s\S]*?\}[\s\S]*?>\s*<TraceGraph3D/,
  "desktop wraps the 3D graph in WebGLErrorBoundary with the 2D list as fallback",
);

// The boundary is a real class boundary that can recover when data reloads.
assert.match(boundary, /getDerivedStateFromError/, "boundary catches render errors");
assert.match(boundary, /prev\.resetKey !== this\.props\.resetKey/, "boundary resets on new data so failures don't latch");

// The fallback preserves the delegation data + selection round-trip.
assert.match(fallback, /onSelect\(\{ kind: "edge", key \}\)/, "fallback rows select the same edge keys as the graph");
assert.match(fallback, /familiarName\(familiars, edge\.caller\)[\s\S]*familiarName\(familiars, edge\.callee\)/,
  "fallback shows caller → callee for every edge");
assert.match(fallback, /var\(--touch-target\)/, "fallback rows meet the shared touch target");

console.log("calls-graph-fallback.test.ts: ok");

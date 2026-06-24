// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const callsView = readFileSync(new URL("./calls-view.tsx", import.meta.url), "utf8");
const fallback = readFileSync(new URL("./trace-graph-fallback.tsx", import.meta.url), "utf8");

// The Three.js 3D delegation graph was removed to drop the heavy `three`
// dependency. The Delegations tab renders the dependency-free 2D list directly.
assert.match(callsView, /<TraceGraphFallback/, "delegations tab renders the 2D delegation list");
assert.doesNotMatch(
  callsView,
  /TraceGraph3D|WebGLErrorBoundary|from "three"|next\/dynamic/,
  "no 3D graph / three / dynamic-import remains in calls-view",
);

// The 2D list preserves the delegation data + selection round-trip.
assert.match(fallback, /onSelect\(\{ kind: "edge", key \}\)/, "fallback rows select the same edge keys as the graph");
assert.match(
  fallback,
  /familiarName\(familiars, edge\.caller\)[\s\S]*familiarName\(familiars, edge\.callee\)/,
  "fallback shows caller → callee for every edge",
);
assert.match(fallback, /var\(--touch-target\)/, "fallback rows meet the shared touch target");

console.log("calls-graph-fallback.test.ts: ok");

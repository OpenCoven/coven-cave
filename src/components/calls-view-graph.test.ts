// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./calls-view.tsx", import.meta.url), "utf8");
const packageJson = await readFile(new URL("../../package.json", import.meta.url), "utf8");

// The delegations view still builds a provenance-aware graph model + toolbar
// and surfaces attention context without a selection — unchanged by dropping 3D.
assert.match(
  source,
  /buildDelegationGraph\(\{/,
  "Calls view should build a provenance-aware graph model instead of rendering raw aggregate edges",
);
assert.match(source, /Include inferred/, "Delegations graph should expose an Include inferred control");
assert.match(source, /data-testid="calls-attention-strip"/, "Delegations view should expose an attention strip above the graph");
assert.match(source, /function CallsToolbar/, "Delegations controls should be grouped in a dedicated toolbar component");
assert.match(source, /Busiest route/, "Delegations inspector should surface the busiest route without requiring selection");
assert.match(source, /Latest trace/, "Delegations inspector should surface latest trace context without requiring selection");

// The graph surface is the dependency-free 2D delegation view. The heavy
// Three.js WebGL scene was removed, so none of its scaffolding should remain.
assert.match(
  source,
  /<TraceGraphFallback[\s\S]*graph=\{graph\}/,
  "Delegations view should render the 2D TraceGraphFallback as the graph surface",
);
assert.doesNotMatch(source, /TraceGraph3D/, "3D trace graph must be gone");
assert.doesNotMatch(source, /WebGLErrorBoundary/, "the WebGL error boundary (3D-only) must be gone");
assert.doesNotMatch(source, /from "three"/, "calls view must not import three");
assert.doesNotMatch(source, /useIsMobile/, "the 3D-vs-2D mobile branch is gone — the 2D view always renders");
assert.doesNotMatch(source, /memoryCounts/, "memory-count rings were a 3D-only concept and must be gone");

// Three.js must no longer be declared at runtime or type-check time.
assert.doesNotMatch(packageJson, /"three":/, "three must be removed from dependencies");
assert.doesNotMatch(packageJson, /"@types\/three":/, "three types must be removed from devDependencies");

// Trace timeline: honest count + no silent truncation. The list caps rendered
// rows for perf; the header badge and a footer note must stay honest about
// traces beyond the cap rather than silently dropping them.
assert.match(source, /const MAX_VISIBLE_TRACES = \d+/, "trace list cap is a named constant");
assert.match(source, /const shown = traces\.slice\(0, MAX_VISIBLE_TRACES\)/, "renders the capped slice via `shown`");
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

console.log("calls-view-graph.test.ts: ok");

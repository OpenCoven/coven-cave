# 3D Trace Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current delegation trace prototype into a production-quality 3D graph where explicit and inferred familiar handoffs are visible, selectable, accessible, performant, and visually verified.

**Architecture:** Keep the graph renderer as a focused plain Three.js island inside the existing React/Next/Tauri UI. Split deterministic graph layout and render policy into pure testable helpers, keep the WebGL scene imperative, and keep all selection/filter/inspector state in React. Defer React Three Fiber and force-graph libraries until trace volume or component reuse demands them.

**Tech Stack:** Next.js 16, React 19, TypeScript, Three.js 0.184, Tauri v2, Node test runner, Playwright for browser/canvas verification.

---

## Sage Research Brief

**Recommendation:** Continue with direct Three.js, but harden the component into a small internal graph renderer. Do not add `3d-force-graph`, `react-force-graph`, or React Three Fiber for this slice.

**Why direct Three.js is the right current choice:**
- Cave already added `three` and has one specialized graph surface. Direct Three.js gives the smallest new runtime surface and exact control over camera, picking, labels, edge animation, disposal, and Tauri browser behavior.
- Three.js first-party docs support the exact primitives this needs: `OrbitControls` for orbit/dolly/pan/reset, `Raycaster` for picking, and explicit `WebGLRenderer.dispose()` for GPU cleanup.
- `@react-three/fiber` is strong and React 19 compatible at v9.6.1, but it adds a second renderer and several dependencies for a component that mostly needs imperative graph rendering. Use it later if Cave gains multiple reusable 3D scenes or needs the R3F ecosystem.
- `3d-force-graph` is excellent for large generic force-directed graphs, but it brings an opinionated force engine and larger package surface. The trace graph is a temporal/provenance workflow graph, not a generic network exploration app. We need deterministic mental-map stability more than force-layout novelty.

**Package check from npm on 2026-06-06:**
- `three@0.184.0`: latest, already in branch; unpacked package size about 36.9 MB.
- `@react-three/fiber@9.6.1`: React 19 peer range, adds about 2.18 MB unpacked plus dependencies.
- `3d-force-graph@1.80.0`: depends on `three`, `three-forcegraph`, `three-render-objects`, `kapsule`; about 14.5 MB unpacked.
- `react-force-graph@1.48.2`: pulls `3d-force-graph`, AR/VR variants, 2D force graph, `react-kapsule`; about 23.9 MB unpacked.

**Primary sources checked:**
- Three.js `OrbitControls`: https://threejs.org/docs/pages/OrbitControls.html
- Three.js `WebGLRenderer.dispose()`: https://threejs.org/docs/pages/WebGLRenderer.html
- React Three Fiber README: https://github.com/pmndrs/react-three-fiber
- React Three Fiber Canvas docs: https://r3f.docs.pmnd.rs/api/canvas
- `3d-force-graph` README: https://github.com/vasturiano/3d-force-graph
- `react-force-graph` package: https://www.npmjs.com/package/react-force-graph

**Current prototype gaps to fix before PR:**
- Selection changes currently rebuild the entire scene because the scene effect depends on `selection` and `selectedKey`; selection highlighting should update materials/scale without recreating renderer state.
- The 3D view does not visibly highlight selected nodes/routes/traces yet.
- The 3D view has no hover tooltip, which regresses useful behavior from the 2D graph.
- Drag/zoom is hand-rolled. Use `OrbitControls` for expected orbit/dolly/pan/reset behavior, keyboard integration, damping, and lower maintenance.
- Edge direction is implied only by particle motion. Add arrowheads or directional glyphs so static/reduced-motion users can read flow.
- Halo rings call `lookAt(camera.position)` only once, so they can stop facing the camera after orbiting.
- `Focus selected` currently has no meaningful target for timeline trace selections unless the trace is resolved back to its route.
- Particle meshes allocate repeated sphere geometry/materials instead of sharing or instancing.
- Trackpad/touch pinch behavior should be verified in Tauri/macOS, not assumed from wheel zoom alone.
- Canvas accessibility needs a DOM mirror: keyboard-selectable routes/nodes/traces and concise status text outside WebGL.
- Layout is deterministic but too naive for reciprocal edges, very small graphs, and dense trace volumes. Extract layout policy and cap/cluster rules.
- Visual verification needs actual browser/canvas proof, not only source assertions and typecheck.

---

## File Structure

- Modify `package.json` and lockfiles: keep `three`; add direct `@playwright/test` dev dependency only if the verification script needs it.
- Create `src/components/trace-graph-3d-model.ts`: pure layout, detail-level, selection, and color helpers.
- Create `src/components/trace-graph-3d-model.test.ts`: deterministic unit tests for layout, caps, selection mapping, and status/provenance colors.
- Modify `src/components/trace-graph-3d.tsx`: renderer island using model helpers, `OrbitControls`, separate selection update effect, arrowheads, keyboard, DOM mirror, and performance safeguards.
- Modify `src/components/calls-view.tsx`: remove unused legacy 2D graph code only after the 3D graph has equivalent behavior, or keep it behind a fallback if visual verification says WebGL can fail.
- Modify `src/components/calls-view-graph.test.ts`: replace brittle source-regex checks with focused assertions for the new architecture and accessibility contract.
- Create `scripts/verify-trace-graph-3d.mjs`: start from an existing dev URL, navigate to Delegations, assert canvas is nonblank, click a node/route, and capture screenshots.

---

## Task 1: Pure Graph Layout and Render Policy

**Files:**
- Create: `src/components/trace-graph-3d-model.ts`
- Create: `src/components/trace-graph-3d-model.test.ts`
- Modify: `src/components/calls-view-graph.test.ts`

- [ ] **Step 1: Write the failing model tests**

Create `src/components/trace-graph-3d-model.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  buildTraceGraphSceneModel,
  edgeKey,
  renderPolicyForGraph,
  traceGraphColor,
  type TraceGraphSelection,
} from "./trace-graph-3d-model.ts";

const graph = {
  nodes: [
    { id: "nova", sentCount: 2, receivedCount: 1, sentExplicitCount: 2, receivedExplicitCount: 1, sentInferredCount: 0, receivedInferredCount: 0, hasRunningReceived: false, latestReceivedFailed: false, lastSeenAt: "2026-06-06T12:00:00.000Z" },
    { id: "cody", sentCount: 1, receivedCount: 2, sentExplicitCount: 1, receivedExplicitCount: 2, sentInferredCount: 0, receivedInferredCount: 0, hasRunningReceived: true, latestReceivedFailed: false, lastSeenAt: "2026-06-06T12:01:00.000Z" },
    { id: "sage", sentCount: 0, receivedCount: 1, sentExplicitCount: 0, receivedExplicitCount: 0, sentInferredCount: 0, receivedInferredCount: 1, hasRunningReceived: false, latestReceivedFailed: true, lastSeenAt: "2026-06-06T12:02:00.000Z" },
  ],
  edges: [
    { caller: "nova", callee: "cody", count: 2, explicitCount: 2, inferredCount: 0, source: "explicit", mostRecentRequest: "Build graph", hasRunning: true, latestStatus: "running", lastSeenAt: "2026-06-06T12:01:00.000Z", traces: [] },
    { caller: "cody", callee: "nova", count: 1, explicitCount: 1, inferredCount: 0, source: "explicit", mostRecentRequest: "Review", hasRunning: false, latestStatus: "completed", lastSeenAt: "2026-06-06T12:00:30.000Z", traces: [] },
    { caller: "cody", callee: "sage", count: 1, explicitCount: 0, inferredCount: 1, source: "inferred", mostRecentRequest: "Research", hasRunning: false, latestStatus: "failed", lastSeenAt: "2026-06-06T12:02:00.000Z", traces: [] },
  ],
  traces: [],
};

const model = buildTraceGraphSceneModel(graph, new Map([
  ["nova", "Nova"],
  ["cody", "Cody"],
  ["sage", "Sage"],
]));

assert.equal(model.nodes.length, 3);
assert.equal(model.edges.length, 3);
assert.equal(edgeKey(graph.edges[0]), "nova->cody->explicit");
assert.notDeepEqual(model.nodes[0].position, model.nodes[1].position);
assert.equal(model.edges[0].selected, false);

const selection: TraceGraphSelection = { kind: "edge", key: "nova->cody->explicit" };
const selectedModel = buildTraceGraphSceneModel(graph, new Map(), selection);
assert.equal(selectedModel.edges.find((edge) => edge.key === selection.key)?.selected, true);

assert.equal(traceGraphColor(graph.edges[0]), "#62d08f");
assert.equal(traceGraphColor(graph.edges[2]), "#f87171");
assert.equal(renderPolicyForGraph({ nodeCount: 12, edgeCount: 24 }).detail, "full");
assert.equal(renderPolicyForGraph({ nodeCount: 80, edgeCount: 220 }).detail, "reduced");
assert.equal(renderPolicyForGraph({ nodeCount: 140, edgeCount: 420 }).detail, "summary");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test src/components/trace-graph-3d-model.test.ts
```

Expected: fail with `Cannot find module './trace-graph-3d-model.ts'`.

- [ ] **Step 3: Implement the pure model helper**

Create `src/components/trace-graph-3d-model.ts`:

```ts
import type {
  CallStatus,
  DelegationGraph,
  DelegationGraphEdge,
  DelegationGraphNode,
} from "@/lib/coven-calls-types";

export type TraceGraphSelection =
  | { kind: "edge"; key: string }
  | { kind: "node"; id: string }
  | { kind: "trace"; id: string }
  | null;

export type ScenePosition = { x: number; y: number; z: number };

export type TraceSceneNode = DelegationGraphNode & {
  label: string;
  position: ScenePosition;
  selected: boolean;
};

export type TraceSceneEdge = DelegationGraphEdge & {
  key: string;
  from: ScenePosition;
  to: ScenePosition;
  control: ScenePosition;
  selected: boolean;
  color: string;
};

export type TraceGraphSceneModel = {
  nodes: TraceSceneNode[];
  edges: TraceSceneEdge[];
  policy: TraceRenderPolicy;
};

export type TraceRenderPolicy = {
  detail: "full" | "reduced" | "summary";
  animateParticles: boolean;
  showLabels: boolean;
  maxRenderedEdges: number;
};

export function edgeKey(edge: Pick<DelegationGraphEdge, "caller" | "callee" | "source">): string {
  return `${edge.caller}->${edge.callee}->${edge.source}`;
}

export function traceGraphColor(edge: Pick<DelegationGraphEdge, "source" | "latestStatus" | "hasRunning">): string {
  if (edge.latestStatus === "failed") return "#f87171";
  if (edge.hasRunning) return "#62d08f";
  if (edge.source === "inferred") return "#fbbf24";
  if (edge.source === "mixed") return "#38bdf8";
  return "#8E3DFF";
}

export function nodeStatusColor(node: Pick<DelegationGraphNode, "hasRunningReceived" | "latestReceivedFailed">): string {
  if (node.latestReceivedFailed) return "#f87171";
  if (node.hasRunningReceived) return "#62d08f";
  return "#8E3DFF";
}

export function renderPolicyForGraph({ nodeCount, edgeCount }: { nodeCount: number; edgeCount: number }): TraceRenderPolicy {
  if (nodeCount > 120 || edgeCount > 360) {
    return { detail: "summary", animateParticles: false, showLabels: false, maxRenderedEdges: 180 };
  }
  if (nodeCount > 48 || edgeCount > 140) {
    return { detail: "reduced", animateParticles: false, showLabels: true, maxRenderedEdges: 140 };
  }
  return { detail: "full", animateParticles: true, showLabels: true, maxRenderedEdges: 140 };
}

function selectedEdgeKey(selection: TraceGraphSelection): string | null {
  return selection?.kind === "edge" ? selection.key : null;
}

function selectedNodeId(selection: TraceGraphSelection): string | null {
  return selection?.kind === "node" ? selection.id : null;
}

function pos(x: number, y: number, z: number): ScenePosition {
  return { x, y, z };
}

export function buildTraceGraphSceneModel(
  graph: DelegationGraph,
  labels: Map<string, string>,
  selection: TraceGraphSelection = null,
): TraceGraphSceneModel {
  const policy = renderPolicyForGraph({ nodeCount: graph.nodes.length, edgeCount: graph.edges.length });
  const count = Math.max(graph.nodes.length, 1);
  const radius = Math.max(4.2, Math.min(8.4, 3.8 + count * 0.36));
  const selectedNode = selectedNodeId(selection);
  const selectedEdge = selectedEdgeKey(selection);

  const nodes = graph.nodes.map((node, index): TraceSceneNode => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const lane = (index % 3) - 1;
    const activity = node.sentCount + node.receivedCount;
    const lift = lane * 1.25 + Math.sin(index * 1.7) * 0.35;
    const scale = 1 + Math.min(activity, 10) * 0.018;
    return {
      ...node,
      label: labels.get(node.id) ?? node.id,
      position: pos(Math.cos(angle) * radius * scale, lift, Math.sin(angle) * radius * scale),
      selected: selectedNode === node.id,
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = [...graph.edges]
    .sort((a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, policy.maxRenderedEdges);

  const edges = visibleEdges.flatMap((edge, index): TraceSceneEdge[] => {
    const caller = byId.get(edge.caller);
    const callee = byId.get(edge.callee);
    if (!caller || !callee) return [];
    const from = caller.position;
    const to = callee.position;
    const reciprocal = graph.edges.some((other) => other.caller === edge.callee && other.callee === edge.caller);
    const midpoint = pos((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    const reciprocalOffset = reciprocal ? (edge.caller < edge.callee ? 0.8 : -0.8) : 0;
    const control = pos(
      midpoint.x * 1.08 + reciprocalOffset,
      midpoint.y + 1.25 + Math.min(edge.count, 6) * 0.22 + (index % 2) * 0.35,
      midpoint.z * 1.08 - reciprocalOffset,
    );
    const key = edgeKey(edge);
    return [{
      ...edge,
      key,
      from,
      to,
      control,
      selected: selectedEdge === key,
      color: traceGraphColor(edge),
    }];
  });

  return { nodes, edges, policy };
}
```

- [ ] **Step 4: Run model test to verify it passes**

Run:

```bash
node --test src/components/trace-graph-3d-model.test.ts
```

Expected: pass.

- [ ] **Step 5: Update architecture assertion test**

Modify `src/components/calls-view-graph.test.ts` so it asserts:

```ts
assert.match(
  graph3dSource,
  /from "three\/addons\/controls\/OrbitControls\.js"/,
  "3D trace graph should use Three.js OrbitControls instead of custom camera controls",
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
```

Keep the existing assertions for `TraceGraph3D`, canvas test id, accessible label, focus/reset controls, reduced motion, and `three` dependency.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts
```

Expected: fail until Task 2 implements the renderer behavior.

- [ ] **Step 7: Commit**

```bash
git add src/components/trace-graph-3d-model.ts src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts
git commit -m "test(trace-graph): define 3d scene model contract"
```

---

## Task 2: Production Three.js Renderer Island

**Files:**
- Modify: `src/components/trace-graph-3d.tsx`
- Modify: `src/components/calls-view-graph.test.ts`

- [ ] **Step 1: Replace custom camera drag with OrbitControls**

In `src/components/trace-graph-3d.tsx`, import:

```ts
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildTraceGraphSceneModel,
  edgeKey,
  nodeStatusColor,
  type TraceGraphSelection,
} from "@/components/trace-graph-3d-model";
```

Inside the scene effect, create controls:

```ts
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = true;
controls.minDistance = 6.8;
controls.maxDistance = 21;
controls.target.set(0, 0, 0);
controls.saveState();
```

The render loop must call:

```ts
controls.update();
renderer.render(scene, camera);
```

Cleanup must call:

```ts
controls.dispose();
renderer.dispose();
```

- [ ] **Step 2: Stop rebuilding the renderer on selection changes**

Keep the scene-creation effect dependent on `sceneModel`, `reducedMotion`, and `onSelect`, but not raw `selection` if possible. Store pickable object maps in refs:

```ts
const objectBySelectionRef = useRef(new Map<string, THREE.Object3D[]>());
const latestSelectionRef = useRef<TraceGraphSelection>(selection);

useEffect(() => {
  latestSelectionRef.current = selection;
}, [selection]);
```

When creating each node or edge object, push it into `objectBySelectionRef.current` keyed by `node:${id}` or `edge:${key}`. Add a separate effect:

```ts
useEffect(() => {
  const map = objectBySelectionRef.current;
  for (const [key, objects] of map) {
    const selected =
      (selection?.kind === "node" && key === `node:${selection.id}`) ||
      (selection?.kind === "edge" && key === `edge:${selection.key}`);
    for (const object of objects) {
      object.scale.setScalar(selected ? 1.18 : 1);
      const material = (object as THREE.Mesh).material;
      if (material && !Array.isArray(material) && "opacity" in material) {
        material.opacity = selected ? 1 : material.opacity;
      }
    }
  }
}, [selection]);
```

- [ ] **Step 3: Add directional arrowheads**

For each `TraceSceneEdge`, after creating the curve:

```ts
const arrowT = 0.82;
const arrowPosition = edge.arc.getPoint(arrowT);
const arrowTangent = edge.arc.getTangent(arrowT).normalize();
const arrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.14 + Math.min(edge.count, 6) * 0.01, 0.36, 16),
  new THREE.MeshBasicMaterial({ color }),
);
arrow.position.copy(arrowPosition);
arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowTangent);
root.add(arrow);
```

Add arrow objects to the same edge selection map so selected routes brighten as a group.

- [ ] **Step 4: Share particle geometry and keep halos billboarding**

Before the edge loop, create shared particle geometry/materials keyed by color:

```ts
const particleGeometry = new THREE.SphereGeometry(0.085, 12, 12);
const particleMaterials = new Map<number, THREE.MeshBasicMaterial>();
const particleMaterialFor = (color: number) => {
  const existing = particleMaterials.get(color);
  if (existing) return existing;
  const material = new THREE.MeshBasicMaterial({ color });
  particleMaterials.set(color, material);
  return material;
};
```

Use it inside the edge loop:

```ts
const particle = new THREE.Mesh(particleGeometry, particleMaterialFor(color));
```

When creating halos:

```ts
halo.userData.billboard = true;
```

In the animation loop:

```ts
root.traverse((child) => {
  if (child instanceof THREE.Sprite || child.userData.billboard) {
    child.quaternion.copy(camera.quaternion);
  }
});
```

Cleanup must dispose shared geometry/materials:

```ts
particleGeometry.dispose();
for (const material of particleMaterials.values()) material.dispose();
```

- [ ] **Step 5: Add selected trace behavior**

If `selection.kind === "trace"`, find its edge by matching the trace in `graph.edges[].traces`. Focus/selection should treat it as that route and the inspector should still show the selected trace:

```ts
function selectionObjectKey(selection: TraceGraphSelection, graph: DelegationGraph): string | null {
  if (!selection) return null;
  if (selection.kind === "node") return `node:${selection.id}`;
  if (selection.kind === "edge") return `edge:${selection.key}`;
  const edge = graph.edges.find((candidate) => candidate.traces.some((trace) => trace.id === selection.id));
  return edge ? `edge:${edgeKey(edge)}` : null;
}
```

- [ ] **Step 6: Add hover tooltip for nodes and routes**

Store hover state in React:

```ts
type GraphHover =
  | { kind: "node"; id: string; x: number; y: number }
  | { kind: "edge"; key: string; x: number; y: number }
  | null;

const [hover, setHover] = useState<GraphHover>(null);
```

Add a throttled pointermove picker:

```ts
let lastHoverAt = 0;
const onPointerHover = (event: PointerEvent) => {
  const now = performance.now();
  if (now - lastHoverAt < 50 || drag.active) return;
  lastHoverAt = now;
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(pickables, false)[0]?.object as Pickable | undefined;
  const selected = hit?.userData.selection;
  if (!selected || selected.kind === "trace") {
    setHover(null);
    return;
  }
  setHover({ ...selected, x: event.clientX, y: event.clientY });
};
```

Register and cleanup:

```ts
canvas.addEventListener("pointermove", onPointerHover);
canvas.addEventListener("pointerleave", () => setHover(null));
```

Render the tooltip as DOM, not WebGL text:

```tsx
{hover ? (
  <div
    className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-white/10 bg-black/80 px-3 py-2 text-[11px] text-white shadow-2xl backdrop-blur"
    style={{ left: hover.x + 12, top: hover.y + 12 }}
  >
    {hover.kind === "node"
      ? familiarName(familiars, hover.id)
      : graph.edges.find((edge) => edgeKey(edge) === hover.key)?.mostRecentRequest ?? "Delegation route"}
  </div>
) : null}
```

- [ ] **Step 7: Add keyboard support on the canvas**

Canvas attributes:

```tsx
tabIndex={0}
aria-label="3D delegation trace graph"
role="img"
```

Keyboard handler:

```ts
const selectable = [...sceneModel.nodes.map((node) => ({ kind: "node" as const, id: node.id })), ...sceneModel.edges.map((edge) => ({ kind: "edge" as const, key: edge.key }))];

const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
  if (event.key === "Escape") onSelect(null);
  if (event.key === "Home") resetRef.current?.();
  if (event.key === "Enter" || event.key === " ") focusRef.current?.();
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    const current = selectable.findIndex((item) => JSON.stringify(item) === JSON.stringify(selection));
    onSelect(selectable[(current + 1 + selectable.length) % selectable.length] ?? null);
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    const current = selectable.findIndex((item) => JSON.stringify(item) === JSON.stringify(selection));
    onSelect(selectable[(current - 1 + selectable.length) % selectable.length] ?? null);
  }
};
```

- [ ] **Step 8: Add reduced-motion, visibility, and pinch guards**

Use `IntersectionObserver` to pause animation when the graph is offscreen:

```ts
let visible = true;
const visibilityObserver = new IntersectionObserver(([entry]) => {
  visible = entry?.isIntersecting ?? true;
});
visibilityObserver.observe(shell);
```

In animation:

```ts
if (!visible) {
  frame = requestAnimationFrame(animate);
  return;
}
if (!reducedMotion && sceneModel.policy.animateParticles) {
  // animate particles
}
```

Cleanup:

```ts
visibilityObserver.disconnect();
```

Set touch behavior on the canvas so trackpad/touch gestures reach controls predictably:

```tsx
className="h-full min-h-[430px] w-full cursor-grab touch-none active:cursor-grabbing"
```

Add a Safari/WebKit gesture guard for Tauri macOS:

```ts
const onGestureStart = (event: Event) => event.preventDefault();
canvas.addEventListener("gesturestart", onGestureStart);
canvas.addEventListener("gesturechange", onGestureStart);
```

Cleanup both gesture listeners.

- [ ] **Step 9: Run focused tests**

Run:

```bash
node --test src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts
pnpm typecheck
```

Expected: both tests pass and TypeScript passes.

- [ ] **Step 10: Commit**

```bash
git add src/components/trace-graph-3d.tsx src/components/calls-view-graph.test.ts
git commit -m "feat(trace-graph): harden 3d renderer controls"
```

---

## Task 3: Accessible Graph Mirror and Inspector Interplay

**Files:**
- Modify: `src/components/trace-graph-3d.tsx`
- Modify: `src/components/calls-view.tsx`
- Modify: `src/components/calls-view-graph.test.ts`

- [ ] **Step 1: Add a DOM status mirror below the canvas**

In `TraceGraph3D`, compute:

```ts
const selectedSummary = useMemo(() => {
  if (!selection) return `${graph.nodes.length} agents, ${graph.edges.length} routes, ${graph.traces.length} traces.`;
  if (selection.kind === "node") return `Selected agent ${familiarName(familiars, selection.id)}.`;
  if (selection.kind === "edge") {
    const edge = graph.edges.find((candidate) => edgeKey(candidate) === selection.key);
    return edge ? `Selected route ${familiarName(familiars, edge.caller)} to ${familiarName(familiars, edge.callee)}, ${edge.count} traces.` : "Selected route.";
  }
  const trace = graph.traces.find((candidate) => candidate.id === selection.id);
  return trace ? `Selected ${trace.status} trace from ${familiarName(familiars, trace.callerFamiliarId)} to ${familiarName(familiars, trace.calleeFamiliarId)}.` : "Selected trace.";
}, [familiars, graph, selection]);
```

Render:

```tsx
<p aria-live="polite" className="sr-only">
  {selectedSummary}
</p>
```

- [ ] **Step 2: Add keyboard-selectable route chips**

Render a compact DOM mirror for the top routes:

```tsx
<div className="absolute left-3 top-16 hidden max-w-[320px] flex-wrap gap-1 md:flex">
  {sceneModel.edges.slice(0, 6).map((edge) => (
    <button
      key={edge.key}
      type="button"
      onClick={() => onSelect({ kind: "edge", key: edge.key })}
      className={[
        "rounded-md border px-2 py-1 text-[10px] backdrop-blur",
        selection?.kind === "edge" && selection.key === edge.key
          ? "border-white/35 bg-white/15 text-white"
          : "border-white/10 bg-black/35 text-white/65 hover:bg-white/10",
      ].join(" ")}
    >
      {familiarName(familiars, edge.caller)} -> {familiarName(familiars, edge.callee)}
    </button>
  ))}
</div>
```

This gives mouse and keyboard users a reliable non-WebGL selection surface.

- [ ] **Step 3: Make inspector selection feel direct**

In `calls-view.tsx`, keep trace timeline selection as trace selection, but allow `TraceInspector` to infer the associated edge for selected traces:

```ts
const selectedTraceEdge = selectedTrace
  ? graph.edges.find((edge) => edge.traces.some((trace) => trace.id === selectedTrace.id)) ?? null
  : null;
```

Pass this into `TraceInspector` as `selectedEdge={selectedEdge ?? selectedTraceEdge}` while preserving `selectedTrace`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test src/components/calls-view-graph.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace-graph-3d.tsx src/components/calls-view.tsx src/components/calls-view-graph.test.ts
git commit -m "feat(trace-graph): add accessible selection mirror"
```

---

## Task 4: Performance and Dense-Graph Degradation

**Files:**
- Modify: `src/components/trace-graph-3d-model.ts`
- Modify: `src/components/trace-graph-3d-model.test.ts`
- Modify: `src/components/trace-graph-3d.tsx`

- [ ] **Step 1: Add dense graph policy tests**

Append to `src/components/trace-graph-3d-model.test.ts`:

```ts
const densePolicy = renderPolicyForGraph({ nodeCount: 70, edgeCount: 160 });
assert.equal(densePolicy.detail, "reduced");
assert.equal(densePolicy.animateParticles, false);
assert.equal(densePolicy.showLabels, true);

const extremePolicy = renderPolicyForGraph({ nodeCount: 130, edgeCount: 500 });
assert.equal(extremePolicy.detail, "summary");
assert.equal(extremePolicy.animateParticles, false);
assert.equal(extremePolicy.showLabels, false);
assert.equal(extremePolicy.maxRenderedEdges, 180);
```

- [ ] **Step 2: Add renderer-level degradation behavior**

In `trace-graph-3d.tsx`, only create label sprites when:

```ts
if (sceneModel.policy.showLabels) {
  const label = makeLabelSprite(node.label, active ? "#ffffff" : "#c9c0d8");
  label.position.copy(node.position.clone().add(new THREE.Vector3(0, size + 0.48, 0)));
  root.add(label);
}
```

Only create edge particles when:

```ts
if (sceneModel.policy.animateParticles) {
  // create particle mesh and add to particles[]
}
```

Render a visible notice when graph is summarized:

```tsx
{sceneModel.policy.detail !== "full" ? (
  <div className="pointer-events-none absolute right-3 top-16 max-w-[280px] rounded-lg border border-amber-400/20 bg-amber-950/45 px-3 py-2 text-[10px] text-amber-100/80 shadow-2xl backdrop-blur">
    Dense graph mode: showing strongest routes first.
  </div>
) : null}
```

- [ ] **Step 3: Add renderer info debug hook in development**

Inside animation loop:

```ts
if (process.env.NODE_ENV === "development" && frameCount % 180 === 0) {
  canvas.dataset.drawCalls = String(renderer.info.render.calls);
  canvas.dataset.triangles = String(renderer.info.render.triangles);
}
```

Declare `let frameCount = 0;` and increment it per animation frame.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
node --test src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/trace-graph-3d-model.ts src/components/trace-graph-3d-model.test.ts src/components/trace-graph-3d.tsx
git commit -m "feat(trace-graph): degrade gracefully for dense graphs"
```

---

## Task 5: Visual Verification Script

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `package-lock.json`
- Create: `scripts/verify-trace-graph-3d.mjs`

- [ ] **Step 1: Add Playwright as an explicit dev dependency**

Run:

```bash
pnpm add -D @playwright/test
```

Expected: `package.json`, `pnpm-lock.yaml`, and `package-lock.json` update.

- [ ] **Step 2: Create the visual verification script**

Create `scripts/verify-trace-graph-3d.mjs`:

```js
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const baseUrl = process.env.CAVE_VERIFY_URL ?? "http://127.0.0.1:3000";
const outDir = "artifacts/trace-graph-3d";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });

page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) console.log(`[browser:${msg.type()}] ${msg.text()}`);
});

await page.goto(baseUrl, { waitUntil: "networkidle" });

const delegationsButton = page.getByRole("button", { name: /delegations|live traces/i }).first();
if (await delegationsButton.count()) {
  await delegationsButton.click();
}

const canvas = page.getByTestId("trace-graph-3d-canvas");
await canvas.waitFor({ timeout: 15_000 });
await page.waitForTimeout(1200);

const box = await canvas.boundingBox();
if (!box || box.width < 320 || box.height < 320) {
  throw new Error(`trace graph canvas has invalid bounds: ${JSON.stringify(box)}`);
}

const nonBlank = await canvas.evaluate((node) => {
  const canvas = /** @type {HTMLCanvasElement} */ (node);
  const context = canvas.getContext("2d");
  if (!context) return true;
  const sample = context.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data;
  let lit = 0;
  for (let i = 0; i < sample.length; i += 4) {
    if (sample[i] + sample[i + 1] + sample[i + 2] > 20) lit++;
  }
  return lit > 12;
});

if (!nonBlank) throw new Error("trace graph canvas appears blank");

await page.screenshot({ path: `${outDir}/desktop.png`, fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await canvas.waitFor({ timeout: 10_000 });
await page.screenshot({ path: `${outDir}/mobile.png`, fullPage: true });

await browser.close();
console.log(`Trace graph visual verification passed: ${outDir}/desktop.png and ${outDir}/mobile.png`);
```

- [ ] **Step 3: Run visual verification against dev server**

Start Cave if it is not already running:

```bash
pnpm dev
```

In another shell:

```bash
CAVE_VERIFY_URL=http://127.0.0.1:3000 node scripts/verify-trace-graph-3d.mjs
```

Expected: script prints `Trace graph visual verification passed` and writes desktop/mobile screenshots.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml package-lock.json scripts/verify-trace-graph-3d.mjs
git commit -m "test(trace-graph): add 3d visual verification"
```

---

## Task 6: Remove or Quarantine Legacy 2D Graph

**Files:**
- Modify: `src/components/calls-view.tsx`
- Modify: `src/components/calls-view-graph.test.ts`

- [ ] **Step 1: Decide fallback policy from visual verification**

If Playwright confirms WebGL renders in desktop and mobile viewports, remove the unused `TraceGraph` SVG component from `calls-view.tsx` to reduce dead code. If WebGL fails on the Tauri target, keep `TraceGraph` and add an explicit runtime fallback:

```tsx
{webglAvailable ? (
  <TraceGraph3D graph={graph} familiars={famById} selection={selection} onSelect={setSelection} />
) : (
  <TraceGraph graph={graph} familiars={famById} selection={selection} onSelect={setSelection} />
)}
```

Use this WebGL detector:

```ts
function canUseWebGL(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}
```

- [ ] **Step 2: Run focused graph test**

Run:

```bash
node --test src/components/calls-view-graph.test.ts
```

Expected: pass. If fallback is kept, add an assertion for `canUseWebGL`.

- [ ] **Step 3: Commit**

```bash
git add src/components/calls-view.tsx src/components/calls-view-graph.test.ts
git commit -m "refactor(trace-graph): retire legacy graph surface"
```

---

## Task 7: Final Verification Gate Before PR

**Files:**
- No edits unless a verification issue appears.

- [ ] **Step 1: Verify all focused tests**

Run:

```bash
node --test src/lib/coven-calls-types.test.ts src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts src/components/agents-view.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Verify TypeScript**

Run:

```bash
pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 3: Verify production build**

Run:

```bash
pnpm build
```

Expected: build succeeds. Existing known Turbopack/NFT warnings may appear, but no new trace-graph errors.

- [ ] **Step 4: Verify visual behavior**

Run with dev server active:

```bash
CAVE_VERIFY_URL=http://127.0.0.1:3000 node scripts/verify-trace-graph-3d.mjs
```

Expected: desktop and mobile screenshots are created and the script reports pass.

- [ ] **Step 5: Manual UX smoke**

In the browser or Tauri dev app:

```text
Agents -> Delegations:
1. Graph canvas is visible and nonblank.
2. Drag orbits without layout jump.
3. Scroll zooms smoothly.
4. Click a node selects an agent and updates the inspector.
5. Click a route selects an edge and updates the inspector.
6. Select a trace from the timeline; the matching route focuses/highlights.
7. Toggle Include inferred; inferred yellow routes appear/disappear.
8. Focus selected moves the camera to the selected item.
9. Reset view restores the camera.
10. With prefers-reduced-motion enabled, route particles stop but direction remains readable through arrowheads.
```

- [ ] **Step 6: Check diff**

Run:

```bash
git diff --check
git status -sb
git diff --stat origin/main...HEAD
```

Expected: no whitespace errors; branch only contains trace graph plan/implementation files.

- [ ] **Step 7: Final commit if any verification fixes were needed**

```bash
git add src/components/trace-graph-3d.tsx src/components/trace-graph-3d-model.ts src/components/trace-graph-3d-model.test.ts src/components/calls-view.tsx src/components/calls-view-graph.test.ts scripts/verify-trace-graph-3d.mjs package.json pnpm-lock.yaml package-lock.json
git commit -m "fix(trace-graph): address verification findings"
```

---

## PR Notes

Use this PR description shape:

```md
## Summary
- Replaces the delegation SVG graph with a production Three.js 3D trace graph.
- Adds deterministic scene-model helpers, OrbitControls navigation, directional routes, selection highlighting, dense-graph degradation, keyboard/DOM accessibility, and visual verification.
- Keeps CallsView filters, inferred/explicit provenance, timeline, and inspector wired to the existing data model.

## Verification
- node --test src/lib/coven-calls-types.test.ts src/components/trace-graph-3d-model.test.ts src/components/calls-view-graph.test.ts src/components/agents-view.test.ts
- pnpm typecheck
- pnpm build
- CAVE_VERIFY_URL=http://127.0.0.1:3000 node scripts/verify-trace-graph-3d.mjs
```

## Self-Review

- Spec coverage: covers architecture choice, production renderer behavior, UX usefulness, accessibility, performance, and verification.
- Placeholder scan: no implementation steps rely on "TBD" or unspecified tests.
- Type consistency: `TraceGraphSelection`, `edgeKey`, and `DelegationGraph` names match the current branch and planned helper module.

Plan complete and saved to `docs/superpowers/plans/2026-06-06-3d-trace-graph.md`.

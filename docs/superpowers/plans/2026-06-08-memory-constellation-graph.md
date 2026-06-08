# Memory Constellation Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3D memory constellation graph to the Memory tab in the Familiars/Agents page — familiar hubs on a ring, memory entry nodes orbiting each hub in a hemispherical shell, toggle between graph and list views.

**Architecture:** New dedicated `memory-graph-3d-model.ts` (data types + pure `buildMemoryGraphModel()`) and `memory-graph-3d.tsx` (Three.js viewer) — no generalization of the existing `trace-graph-3d.tsx`. Client-side graph construction in `AgentsMemoryView` from existing `/api/coven-memory` + `/api/memory` data. Toggle button (List ↔ Graph) in the Memory tab header; familiar hub click → filter list; memory entry node click → `onOpenMemoryFile(path)`.

**Tech Stack:** React, Three.js (`three`), `three/addons/controls/OrbitControls.js`, Tailwind, `@/lib/icon`, OKLCH brand palette (`--accent-presence: #9a8ecd`, hue 293)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/memory-graph-3d-model.ts` | **Create** | `MemoryGraph*` types, `buildMemoryGraphModel()`, layout math |
| `src/components/memory-graph-3d.tsx` | **Create** | Three.js viewer: hubs on ring, leaves on shells, orbit, tooltip, click callbacks |
| `src/components/agents-memory-view.tsx` | **Modify** | Import graph model + viewer, add List/Graph toggle state, wire callbacks |

Do **not** touch `trace-graph-3d.tsx` or `trace-graph-3d-model.ts`.

---

## Task 1: Data model + layout math

**Files:**
- Create: `src/lib/memory-graph-3d-model.ts`

**Overview:** Purely functional module — no React, no Three.js. Defines graph types and builds a fully-positioned scene model from raw API data.

### Layout rules

- **Hubs** on a flat ring at y=0: `ringRadius = Math.max(5, hubCount * 1.2)`, angle `i → (i/hubCount)*2π - π/2`
- **Leaves** on Fibonacci-sphere upper hemisphere shell around hub: `shellRadius = Math.max(1.6, Math.min(3.5, 1.4 + leafCount*0.12))`
- **Hub colors** deterministic by id: nova=293, cody=220, sage=155, kitty=20, echo=270, charm=330, astra=190; fallback `(id.charCodeAt(0)*47)%360`; format `oklch(0.65 0.18 <hue>)`
- **Workspace hub** for FileMemoryEntry items: color `oklch(0.58 0.04 293)`, label `"Memory Files"`
- **Age opacity**: <1d=1.0, 1-7d=0.75, older=0.5; query non-matches ×0.25
- **Filter**: when `familiarFilter !== "all"` → include all hubs but only that familiar's leaves; other hubs get `dimmed: true`

- [ ] **Step 1: Create `src/lib/memory-graph-3d-model.ts`**

Full file content (copy exactly):

```typescript
import type { Familiar } from "@/lib/types";

export type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

export type FileMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  size: number;
  modified: string;
};

export type ScenePos = { x: number; y: number; z: number };

export type MemoryHubNode = {
  kind: "hub";
  id: string;
  label: string;
  position: ScenePos;
  color: string;
  dimmed: boolean;
  entryCount: number;
};

export type MemoryLeafNode = {
  kind: "leaf";
  id: string;
  hubId: string;
  label: string;
  path: string;
  position: ScenePos;
  color: string;
  ageOpacity: number;
};

export type MemoryEdge = {
  hubId: string;
  leafId: string;
  from: ScenePos;
  to: ScenePos;
};

export type MemoryGraph = {
  hubs: MemoryHubNode[];
  leaves: MemoryLeafNode[];
  edges: MemoryEdge[];
};

const BRAND_HUES: Record<string, number> = {
  nova: 293, cody: 220, sage: 155, kitty: 20, echo: 270, charm: 330, astra: 190,
};

function hubColorStr(id: string): string {
  const hue = BRAND_HUES[id] ?? ((id.charCodeAt(0) * 47) % 360);
  return `oklch(0.65 0.18 ${hue})`;
}

function workspaceColorStr(): string {
  return `oklch(0.58 0.04 293)`;
}

function ageOpacityFor(iso: string | undefined): number {
  if (!iso) return 0.5;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 86_400_000) return 1.0;
  if (ms < 7 * 86_400_000) return 0.75;
  return 0.5;
}

function pos(x: number, y: number, z: number): ScenePos {
  return { x, y, z };
}

function hubPos(index: number, total: number, radius: number): ScenePos {
  const angle = total === 1 ? -Math.PI / 2 : (index / total) * Math.PI * 2 - Math.PI / 2;
  return pos(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

function fibLeafPositions(hubCenter: ScenePos, count: number, shellRadius: number): ScenePos[] {
  if (count === 0) return [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: count }, (_, i) => {
    const phi = Math.acos(1 - (i + 0.5) / count);
    const theta = goldenAngle * i;
    return pos(
      hubCenter.x + Math.sin(phi) * Math.cos(theta) * shellRadius,
      hubCenter.y + Math.cos(phi) * shellRadius,
      hubCenter.z + Math.sin(phi) * Math.sin(theta) * shellRadius,
    );
  });
}

type BuildInput = {
  familiars: Familiar[];
  covenEntries: CovenMemoryEntry[];
  fileEntries: FileMemoryEntry[];
  familiarFilter: string;
  query: string;
};

export function buildMemoryGraphModel({ familiars, covenEntries, fileEntries, familiarFilter, query }: BuildInput): MemoryGraph {
  const q = query.trim().toLowerCase();

  const covenByFamiliar = new Map<string, CovenMemoryEntry[]>();
  for (const e of covenEntries) {
    const arr = covenByFamiliar.get(e.familiar_id) ?? [];
    arr.push(e);
    covenByFamiliar.set(e.familiar_id, arr);
  }

  const activeFamiliars = familiars.filter((f) => covenByFamiliar.has(f.id));
  const hasWorkspace = fileEntries.length > 0;
  const hubCount = activeFamiliars.length + (hasWorkspace ? 1 : 0);
  const ringRadius = Math.max(5, hubCount * 1.2);

  const hubs: MemoryHubNode[] = [];
  const leaves: MemoryLeafNode[] = [];
  const edges: MemoryEdge[] = [];

  activeFamiliars.forEach((familiar, index) => {
    const familiarEntries = covenByFamiliar.get(familiar.id) ?? [];
    const hPos = hubPos(index, hubCount, ringRadius);
    const color = hubColorStr(familiar.id);
    const dimmed = familiarFilter !== "all" && familiarFilter !== familiar.id;

    hubs.push({ kind: "hub", id: familiar.id, label: familiar.display_name, position: hPos, color, dimmed, entryCount: familiarEntries.length });

    if (familiarFilter === "all" || familiarFilter === familiar.id) {
      const shellRadius = Math.max(1.6, Math.min(3.5, 1.4 + familiarEntries.length * 0.12));
      const positions = fibLeafPositions(hPos, familiarEntries.length, shellRadius);
      familiarEntries.forEach((entry, i) => {
        const matches = !q || [entry.title, entry.excerpt ?? "", entry.familiar_id, entry.path].some((v) => v.toLowerCase().includes(q));
        const opacity = ageOpacityFor(entry.updated_at) * (matches ? 1 : 0.25);
        const lPos = positions[i];
        leaves.push({ kind: "leaf", id: entry.id, hubId: familiar.id, label: entry.title, path: entry.path, position: lPos, color, ageOpacity: opacity });
        edges.push({ hubId: familiar.id, leafId: entry.id, from: hPos, to: lPos });
      });
    }
  });

  if (hasWorkspace) {
    const wsIndex = activeFamiliars.length;
    const hPos = hubPos(wsIndex, hubCount, ringRadius);
    const color = workspaceColorStr();
    const dimmed = familiarFilter !== "all";
    hubs.push({ kind: "hub", id: "workspace", label: "Memory Files", position: hPos, color, dimmed, entryCount: fileEntries.length });

    if (familiarFilter === "all") {
      const shellRadius = Math.max(1.6, Math.min(3.5, 1.4 + fileEntries.length * 0.12));
      const positions = fibLeafPositions(hPos, fileEntries.length, shellRadius);
      fileEntries.forEach((entry, i) => {
        const matches = !q || [entry.rootLabel, entry.relPath, entry.fullPath].some((v) => v.toLowerCase().includes(q));
        const opacity = ageOpacityFor(entry.modified) * (matches ? 1 : 0.25);
        const lPos = positions[i];
        leaves.push({ kind: "leaf", id: entry.fullPath, hubId: "workspace", label: entry.relPath, path: entry.fullPath, position: lPos, color: workspaceColorStr(), ageOpacity: opacity });
        edges.push({ hubId: "workspace", leafId: entry.fullPath, from: hPos, to: lPos });
      });
    }
  }

  return { hubs, leaves, edges };
}
```

- [ ] **Step 2: Verify no tsc errors on new file**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
npx tsc --noEmit --skipLibCheck 2>&1 | grep "memory-graph-3d-model"
```
Expected: no output

- [ ] **Step 3: Commit**
```bash
git add src/lib/memory-graph-3d-model.ts
git commit -m "feat: memory graph data model + deterministic layout (constellation)"
```

---

## Task 2: Three.js viewer component

**Files:**
- Create: `src/components/memory-graph-3d.tsx`

**Overview:** `"use client"` Three.js scene component. Pattern mirrors `trace-graph-3d.tsx` — same canvas setup, `OrbitControls`, raycaster pick loop, dispose-on-unmount. New: memory visual language (hub spheres + glow rings, leaf spheres, hub-to-leaf edge lines, label sprites, hover tooltip, keyboard fallback).

**Props:**
```ts
type Props = {
  graph: MemoryGraph;
  familiars: Map<string, Familiar>;        // for future tooltip enrichment
  onSelectHub: (hubId: string) => void;    // hub click → set familiar filter
  onOpenMemoryFile: (path: string) => void;// leaf click → open file
};
```

**Visual rules:**
- Hubs: `SphereGeometry(0.55, 24, 24)`, `MeshStandardMaterial`, opacity 0.95 (or 0.28 if dimmed), emissive glow
- Hub glow ring: `RingGeometry` rotated flat, opacity pulses in render loop via `Math.sin(frame*0.025)`
- Leaves: `SphereGeometry(0.2, 10, 10)`, opacity = `leaf.ageOpacity * 0.85`; InstancedMesh when leaves > 150
- Edges: `Line` + `LineBasicMaterial`, opacity 0.22 (or 0.08 if hub dimmed)
- Labels: canvas `Sprite` above hub, text `"#e5e0ff"` (or `"#666"` if dimmed), truncated at 22 chars
- Tooltip: React `<div>` overlay at pointer coords, shows `node.label`, hub/familiar name, path

- [ ] **Step 1: Create `src/components/memory-graph-3d.tsx`**

Full file content (copy exactly):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Familiar } from "@/lib/types";
import type { MemoryGraph, MemoryHubNode, MemoryLeafNode } from "@/lib/memory-graph-3d-model";

type Props = {
  graph: MemoryGraph;
  familiars: Map<string, Familiar>;
  onSelectHub: (hubId: string) => void;
  onOpenMemoryFile: (path: string) => void;
};

type HoverState =
  | { kind: "hub"; node: MemoryHubNode; x: number; y: number }
  | { kind: "leaf"; node: MemoryLeafNode; x: number; y: number }
  | null;

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 48);
  ctx.fillStyle = color;
  ctx.font = "bold 18px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.length > 22 ? text.slice(0, 22) + "…" : text, 128, 24);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.4, 0.48, 1);
  return sprite;
}

export function MemoryGraph3D({ graph, familiars, onSelectHub, onOpenMemoryFile }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const hoverRef = useRef<HoverState>(null);

  // Keep stable callback refs to avoid effect re-runs
  const onSelectHubRef = useRef(onSelectHub);
  const onOpenMemoryFileRef = useRef(onOpenMemoryFile);
  onSelectHubRef.current = onSelectHub;
  onOpenMemoryFileRef.current = onOpenMemoryFile;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 200);
    camera.position.set(0, 7, 18);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 60;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7);
    scene.add(dir);

    const pickMap = new Map<string, { kind: "hub"; node: MemoryHubNode } | { kind: "leaf"; node: MemoryLeafNode }>();

    // Edges
    for (const edge of graph.edges) {
      const hub = graph.hubs.find((h) => h.id === edge.hubId);
      if (!hub) continue;
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(edge.from.x, edge.from.y, edge.from.z),
        new THREE.Vector3(edge.to.x, edge.to.y, edge.to.z),
      ]);
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: new THREE.Color().setStyle(hub.color),
        transparent: true,
        opacity: hub.dimmed ? 0.08 : 0.22,
      })));
    }

    // Hub spheres + rings + labels
    for (const hub of graph.hubs) {
      const c = new THREE.Color().setStyle(hub.color);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 24, 24),
        new THREE.MeshStandardMaterial({ color: c, transparent: true, opacity: hub.dimmed ? 0.28 : 0.95, emissive: c, emissiveIntensity: hub.dimmed ? 0.05 : 0.28 }),
      );
      mesh.position.set(hub.position.x, hub.position.y, hub.position.z);
      scene.add(mesh);
      pickMap.set(mesh.uuid, { kind: "hub", node: hub });

      if (!hub.dimmed) {
        const rs = Math.max(1.0, Math.min(2.4, 1.0 + hub.entryCount * 0.04));
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.65, 0.65 + 0.08 * rs, 48),
          new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
        );
        ring.position.set(hub.position.x, hub.position.y, hub.position.z);
        ring.rotation.x = Math.PI / 2;
        scene.add(ring);
      }

      const sprite = makeLabelSprite(hub.label, hub.dimmed ? "#666" : "#e5e0ff");
      sprite.position.set(hub.position.x, hub.position.y + 0.85, hub.position.z);
      scene.add(sprite);
    }

    // Leaf nodes
    const leafGeo = new THREE.SphereGeometry(0.2, 10, 10);
    if (graph.leaves.length > 150) {
      const mat = new THREE.MeshStandardMaterial({ transparent: true });
      const im = new THREE.InstancedMesh(leafGeo, mat, graph.leaves.length);
      im.count = graph.leaves.length;
      const dummy = new THREE.Object3D();
      graph.leaves.forEach((leaf, i) => {
        dummy.position.set(leaf.position.x, leaf.position.y, leaf.position.z);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        im.setColorAt!(i, new THREE.Color().setStyle(leaf.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im);
    } else {
      for (const leaf of graph.leaves) {
        const c = new THREE.Color().setStyle(leaf.color);
        const mesh = new THREE.Mesh(leafGeo, new THREE.MeshStandardMaterial({
          color: c, transparent: true, opacity: leaf.ageOpacity * 0.85, emissive: c, emissiveIntensity: 0.08,
        }));
        mesh.position.set(leaf.position.x, leaf.position.y, leaf.position.z);
        scene.add(mesh);
        pickMap.set(mesh.uuid, { kind: "leaf", node: leaf });
      }
    }

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickables = scene.children.filter((c) => c instanceof THREE.Mesh && pickMap.has(c.uuid)) as THREE.Mesh[];

    function doPick(ev: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables);
      for (const h of hits) {
        const e = pickMap.get(h.object.uuid);
        if (e) return e;
      }
      return null;
    }

    const onMove = (ev: MouseEvent) => {
      const e = doPick(ev);
      hoverRef.current = e ? { ...e, x: ev.clientX, y: ev.clientY } as HoverState : null;
      setHover(hoverRef.current);
    };
    const onCl = (ev: MouseEvent) => {
      const e = doPick(ev);
      if (!e) return;
      if (e.kind === "hub") onSelectHubRef.current(e.node.id);
      else onOpenMemoryFileRef.current(e.node.path);
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("click", onCl);

    // Resize
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    // Render loop
    let animId: number;
    let frame = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      frame++;
      controls.update();
      scene.children.forEach((child) => {
        if (child instanceof THREE.Mesh && child.geometry instanceof THREE.RingGeometry && child.material instanceof THREE.MeshBasicMaterial) {
          (child.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(frame * 0.025) * 0.1;
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("click", onCl);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else (obj.material as THREE.Material).dispose();
        }
      });
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [graph]); // re-run when graph data changes

  const hubLabel = hover?.kind === "hub" ? hover.node.label : hover?.kind === "leaf" ? familiars.get(hover.node.hubId)?.display_name ?? hover.node.hubId : null;

  return (
    <div className="relative size-full min-h-0">
      <div ref={containerRef} className="size-full min-h-0 cursor-grab active:cursor-grabbing" />

      {/* Hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-elevated)] px-3 py-2 shadow-xl"
          style={{ left: hover.x + 14, top: hover.y - 10 }}
        >
          <div className="text-[12px] font-semibold text-[var(--text-primary)] line-clamp-2">{hover.node.label}</div>
          {hubLabel && hover.kind === "leaf" && (
            <div className="mt-0.5 text-[10px] text-[var(--accent-presence)]">{hubLabel}</div>
          )}
          {hover.kind === "hub" && (
            <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{hover.node.entryCount} {hover.node.entryCount === 1 ? "entry" : "entries"}</div>
          )}
          {hover.kind === "leaf" && (
            <div className="mt-1 truncate font-mono text-[9px] text-[var(--text-muted)]">{hover.node.path}</div>
          )}
          <div className="mt-1 text-[9px] text-[var(--text-muted)]">
            {hover.kind === "hub" ? "Click to filter" : "Click to open"}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no tsc errors**

```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
npx tsc --noEmit --skipLibCheck 2>&1 | grep "memory-graph-3d"
```
Expected: no output

- [ ] **Step 3: Commit**
```bash
git add src/components/memory-graph-3d.tsx
git commit -m "feat: MemoryGraph3D three.js viewer (constellation, hub ring, leaf shells)"
```

---

## Task 3: Wire into AgentsMemoryView

**Files:**
- Modify: `src/components/agents-memory-view.tsx`

**Overview:** Add `viewMode: "list" | "graph"` state, a List/Graph toggle button in the header bar, `useMemo` graph model construction, and conditional render of `<MemoryGraph3D>` vs. the existing card grid + file list.

**Exact changes:**

1. Add imports at top:
```tsx
import { useMemo, useState } from "react"; // already imported — no change needed for useMemo/useState
import { buildMemoryGraphModel } from "@/lib/memory-graph-3d-model";
import { MemoryGraph3D } from "@/components/memory-graph-3d";
```
(Note: `useMemo` and `useState` are already imported — just add the two new import lines)

2. Add `viewMode` state inside `AgentsMemoryView`:
```tsx
const [viewMode, setViewMode] = useState<"list" | "graph">("list");
```

3. Build graph model via `useMemo` (add after existing `useMemo` hooks):
```tsx
const memoryGraph = useMemo(
  () =>
    buildMemoryGraphModel({
      familiars,
      covenEntries,
      fileEntries,
      familiarFilter,
      query: q,
    }),
  [familiars, covenEntries, fileEntries, familiarFilter, q],
);

const familiarsMap = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
```

4. Replace the Refresh button row with a row that also has the List/Graph toggle:

Existing (from line ~150 in the header):
```tsx
<button type="button" onClick={() => void load()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]">
  <Icon name="ph:arrows-clockwise" width={12} />
  Refresh
</button>
```

Replace with:
```tsx
<div className="flex items-center gap-2">
  <div className="flex items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 p-0.5">
    <button
      type="button"
      onClick={() => setViewMode("list")}
      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors ${viewMode === "list" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
    >
      <Icon name="ph:list-bold" width={11} />
      List
    </button>
    <button
      type="button"
      onClick={() => setViewMode("graph")}
      className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors ${viewMode === "graph" ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
    >
      <Icon name="ph:graph-bold" width={11} />
      Graph
    </button>
  </div>
  <button type="button" onClick={() => void load()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] px-2.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]">
    <Icon name="ph:arrows-clockwise" width={12} />
    Refresh
  </button>
</div>
```

5. Replace the body section (the `<div className="grid min-h-0flex-1 gap-4 overflow-y-auto p-4...">`) with a conditional render:

Existing outer div (the grid body):
```tsx
<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
```

Replace that outer div and its entire content with:
```tsx
{viewMode === "graph" ? (
  <div className="min-h-0 flex-1" style={{ height: "100%", minHeight: 480 }}>
    <MemoryGraph3D
      graph={memoryGraph}
      familiars={familiarsMap}
      onSelectHub={(id) => setFamiliarFilter(id === "workspace" ? "all" : id)}
      onOpenMemoryFile={(path) => onOpenMemoryFile?.(path)}
    />
  </div>
) : (
  <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
    {/* ... existing card grid and file list sections unchanged ... */}
  </div>
)}
```

Keep the existing card grid and file list sections inside the `else` branch exactly as they are now — no other changes to that code.

- [ ] **Step 1: Add imports to `agents-memory-view.tsx`**

Add these two lines after the existing imports:
```tsx
import { buildMemoryGraphModel } from "@/lib/memory-graph-3d-model";
import { MemoryGraph3D } from "@/components/memory-graph-3d";
```

- [ ] **Step 2: Add `viewMode` state and `memoryGraph`/`familiarsMap` memos**

Inside the `AgentsMemoryView` function body, after existing `useState` declarations, add:
```tsx
const [viewMode, setViewMode] = useState<"list" | "graph">("list");
```

After existing `useMemo` declarations (after `familiarsWithMemory`), add:
```tsx
const memoryGraph = useMemo(
  () => buildMemoryGraphModel({ familiars, covenEntries, fileEntries, familiarFilter, query: q }),
  [familiars, covenEntries, fileEntries, familiarFilter, q],
);
const familiarsMap = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
```

Note: `familiarsMap` is a new memo — the existing `familiarById` memo is for internal card rendering and is separate. Keep `familiarById` as-is.

- [ ] **Step 3: Replace Refresh button with toggle + refresh row** (exact diff shown in step 4 above)

- [ ] **Step 4: Wrap body in viewMode conditional** (exact structure shown in step 5 above)

- [ ] **Step 5: Verify full tsc clean**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
npx tsc --noEmit --skipLibCheck 2>&1 | grep -E "memory|agents-memory"
```
Expected: no output

- [ ] **Step 6: Commit**
```bash
git add src/components/agents-memory-view.tsx
git commit -m "feat: add List/Graph toggle to Memory tab, wire MemoryGraph3D constellation"
```

---

## Task 4: Manual smoke test + push

- [ ] **Step 1: Start dev server**
```bash
cd ~/Documents/GitHub/OpenCoven/coven-cave
pnpm dev
```
Open http://localhost:3000 and navigate to Familiars → Memory tab.

- [ ] **Step 2: Verify list mode still works**
- Cards render, search filters, familiar dropdown filters — all as before
- No console errors

- [ ] **Step 3: Switch to Graph mode**
- Click the "Graph" toggle button
- 3D canvas appears and fills the tab body
- Familiar hub spheres visible on a ring
- Leaf nodes orbit each hub as small spheres
- Edge lines connect hub → leaves

- [ ] **Step 4: Verify interactions**
- Hover a hub → tooltip shows familiar name + entry count + "Click to filter"
- Click a hub → familiar filter dropdown updates to that familiar AND graph re-renders with only that hub's leaves
- Hover a leaf → tooltip shows title + familiar + path + "Click to open"
- Click a leaf → right panel inspector opens (memory file opens via `onOpenMemoryFile`)
- Orbit/zoom works (drag to rotate, scroll to zoom)

- [ ] **Step 5: Verify filter sync**
- Set familiar filter to e.g. "Cody" in the dropdown while in List mode → switch to Graph → Cody hub bright, others dimmed, only Cody leaves shown
- Switch back to List → card grid still filtered to Cody

- [ ] **Step 6: Push**
```bash
git push
```

---

## Self-Review

**Spec coverage check:**
- ✅ Familiar hub nodes on ring — Task 1 layout math
- ✅ Memory entry leaf nodes on shell — Task 1 Fibonacci layout  
- ✅ Hub→leaf edge lines — Task 2 THREE.Line
- ✅ Familiar hub click → filter list — Task 2 `onSelectHub` + Task 3 `setFamiliarFilter`
- ✅ Memory leaf click → open file — Task 2 `onOpenMemoryFile`
- ✅ List ↔ Graph toggle — Task 3 `viewMode` state + toggle buttons
- ✅ Filter syncs both views — `familiarFilter` shared state in `AgentsMemoryView`
- ✅ Hover tooltip — Task 2 React overlay
- ✅ `InstancedMesh` for >150 leaves — Task 2 conditional branch
- ✅ Workspace/unassigned files hub — Task 1 workspace hub
- ✅ No changes to `trace-graph-3d.tsx` — per architecture decision
- ✅ Dispose on unmount — Task 2 cleanup return

**Placeholder scan:** No TBD/TODO/fill-in placeholders found.

**Type consistency check:**
- `MemoryGraph`, `MemoryHubNode`, `MemoryLeafNode`, `MemoryEdge` defined in Task 1, imported in Tasks 2 and 3 ✅
- `buildMemoryGraphModel` defined in Task 1, imported in Task 3 ✅
- `MemoryGraph3D` component defined in Task 2, imported in Task 3 ✅
- `onSelectHub(hubId: string)` in Task 2 props, called with `hub.id` ✅
- `onOpenMemoryFile(path: string)` in Task 2 props, called with `leaf.path` ✅
- `familiarsMap: Map<string, Familiar>` built in Task 3, passed to `MemoryGraph3D` ✅

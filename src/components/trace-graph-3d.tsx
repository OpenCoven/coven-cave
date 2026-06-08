"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  DelegationGraph,
  DelegationGraphEdge,
  DelegationGraphNode,
} from "@/lib/coven-calls-types";
import type { Familiar } from "@/lib/types";
import { Icon } from "@/lib/icon";
import {
  buildTraceGraphSceneModel,
  edgeKey,
  nodeStatusColor,
  selectionObjectKey,
  type TraceGraphSelection,
} from "@/components/trace-graph-3d-model";

type Props = {
  graph: DelegationGraph;
  familiars: Map<string, Familiar>;
  selection: TraceGraphSelection;
  onSelect: (selection: TraceGraphSelection) => void;
  memoryCounts?: Map<string, number>;
};

type Pickable = THREE.Object3D & {
  userData: {
    baseOpacity?: number;
    selection?: TraceGraphSelection;
    edge?: DelegationGraphEdge;
    node?: DelegationGraphNode;
  };
};

type GraphHover =
  | { kind: "edge"; key: string; x: number; y: number }
  | { kind: "node"; id: string; x: number; y: number }
  | null;

const EDGE_COLORS: Record<DelegationGraphEdge["source"] | "running" | "failed", number> = {
  explicit: 0x8e3dff,
  inferred: 0xfbbf24,
  mixed: 0x38bdf8,
  running: 0x62d08f,
  failed: 0xf87171,
};

function familiarName(familiars: Map<string, Familiar>, id: string): string {
  return familiars.get(id)?.display_name ?? id;
}

function edgeColor(edge: DelegationGraphEdge): number {
  if (edge.latestStatus === "failed") return EDGE_COLORS.failed;
  if (edge.hasRunning) return EDGE_COLORS.running;
  return EDGE_COLORS[edge.source];
}

function selectionEquals(a: TraceGraphSelection, b: TraceGraphSelection): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "node" && b.kind === "node") return a.id === b.id;
  if (a.kind === "edge" && b.kind === "edge") return a.key === b.key;
  if (a.kind === "trace" && b.kind === "trace") return a.id === b.id;
  return false;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = 384;
  canvas.height = 96;
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(12, 12, 15, 0.70)";
    context.strokeStyle = "rgba(255, 255, 255, 0.14)";
    roundRect(context, 10, 18, 364, 54, 16);
    context.fill();
    context.stroke();
    context.font = "600 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillStyle = color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text.slice(0, 24), canvas.width / 2, 45);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.8, 0.7, 1);
  return sprite;
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Line | THREE.Sprite;
    const geometry = (mesh as THREE.Mesh).geometry;
    if (geometry) geometries.add(geometry);
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => materials.add(m));
    else if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function asVector(position: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y, position.z);
}

function materialList(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh | THREE.Line | THREE.Sprite).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

export function TraceGraph3D({ graph, familiars, selection, onSelect, memoryCounts }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const objectBySelectionRef = useRef(new Map<string, THREE.Object3D[]>());
  const latestSelectionRef = useRef<TraceGraphSelection>(selection);
  const focusRef = useRef<(() => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [hover, setHover] = useState<GraphHover>(null);
  const reducedMotion = useReducedMotion();
  const labels = useMemo(() => new Map(Array.from(familiars, ([id, familiar]) => [id, familiar.display_name ?? id])), [familiars]);
  const sceneModel = useMemo(
    () => buildTraceGraphSceneModel(graph, labels, memoryCounts),
    [graph, labels, memoryCounts],
  );
  const selectedObjectKey = selectionObjectKey(selection, graph);

  useEffect(() => {
    latestSelectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    const activeKey = selectionObjectKey(selection, graph);
    for (const [key, objects] of objectBySelectionRef.current) {
      const selected = key === activeKey;
      for (const object of objects) {
        object.userData.selected = selected;
        for (const material of materialList(object)) {
          if ("opacity" in material) {
            material.transparent = true;
            material.opacity = selected ? 1 : object.userData.baseOpacity ?? material.opacity;
          }
          if ("emissiveIntensity" in material) {
            (material as THREE.MeshStandardMaterial).emissiveIntensity = selected ? 0.74 : object.userData.active ? 0.32 : 0.16;
          }
        }
      }
    }
  }, [graph, selection]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || sceneModel.nodes.length === 0) return;
    canvas.dataset.effectStarted = "true";

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    canvas.dataset.rendererReady = "true";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06060a, 0.045);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 90);
    camera.position.set(0, 5.5, sceneModel.nodes.length <= 2 ? 9.5 : 13.5);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 5.8;
    controls.maxDistance = 22;
    controls.target.set(0, 0, 0);
    controls.saveState();

    const root = new THREE.Group();
    root.rotation.x = -0.22;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xd9c7ff, 2.6);
    key.position.set(3, 8, 8);
    scene.add(key);
    const fill = new THREE.PointLight(0x62d08f, 18, 22);
    fill.position.set(-7, 3, 4);
    scene.add(fill);

    const pickables: Pickable[] = [];
    const particles: Array<{ mesh: THREE.Mesh; arc: THREE.QuadraticBezierCurve3; offset: number; speed: number }> = [];
    const memoryHalos: Array<{ mesh: THREE.Mesh; baseScale: number; phase: number }> = [];
    const selectionMap = new Map<string, THREE.Object3D[]>();
    objectBySelectionRef.current = selectionMap;
    const maxEdgeCount = Math.max(...sceneModel.edges.map((edge) => edge.count), 1);

    const registerSelectable = (key: string, object: THREE.Object3D, baseOpacity?: number) => {
      object.userData.baseOpacity = baseOpacity;
      const objects = selectionMap.get(key) ?? [];
      objects.push(object);
      selectionMap.set(key, objects);
    };

    const grid = new THREE.GridHelper(16, 16, 0x2f2440, 0x15151f);
    grid.position.y = -2.45;
    root.add(grid);

    const particleGeometry = new THREE.SphereGeometry(0.085, 12, 12);
    const particleMaterials = new Map<number, THREE.MeshBasicMaterial>();
    const particleMaterialFor = (color: number) => {
      const existing = particleMaterials.get(color);
      if (existing) return existing;
      const material = new THREE.MeshBasicMaterial({ color });
      particleMaterials.set(color, material);
      return material;
    };

    for (const edge of sceneModel.edges) {
      const color = edgeColor(edge);
      const arc = new THREE.QuadraticBezierCurve3(asVector(edge.from), asVector(edge.control), asVector(edge.to));
      const points = arc.getPoints(64);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const baseOpacity = edge.source === "inferred" ? 0.58 : 0.82;
      const material = edge.source === "inferred"
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.32, gapSize: 0.18, transparent: true, opacity: baseOpacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: baseOpacity });
      const line = new THREE.Line(geometry, material);
      if (line instanceof THREE.Line && "computeLineDistances" in line) line.computeLineDistances();
      line.userData.selection = { kind: "edge", key: edge.key };
      line.userData.edge = edge;
      root.add(line);
      pickables.push(line as Pickable);
      registerSelectable(`edge:${edge.key}`, line, baseOpacity);

      const hitGeometry = new THREE.TubeGeometry(arc, 24, 0.08 + (edge.count / maxEdgeCount) * 0.05, 6, false);
      const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hit = new THREE.Mesh(hitGeometry, hitMaterial);
      hit.userData.selection = { kind: "edge", key: edge.key };
      hit.userData.edge = edge;
      root.add(hit);
      pickables.push(hit as Pickable);

      const arrowT = 0.82;
      const arrowPosition = arc.getPoint(arrowT);
      const arrowTangent = arc.getTangent(arrowT).normalize();
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.14 + Math.min(edge.count, 6) * 0.01, 0.36, 16),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
      );
      arrow.position.copy(arrowPosition);
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), arrowTangent);
      root.add(arrow);
      registerSelectable(`edge:${edge.key}`, arrow, 0.9);

      if (sceneModel.policy.animateParticles) {
        const particle = new THREE.Mesh(particleGeometry, particleMaterialFor(color));
        particle.position.copy(arc.getPoint(0.2));
        root.add(particle);
        registerSelectable(`edge:${edge.key}`, particle, 1);
        particles.push({
          mesh: particle,
          arc,
          offset: Math.random(),
          speed: edge.hasRunning ? 0.36 : 0.18,
        });
      }
    }

    for (const node of sceneModel.nodes) {
      const active = node.hasRunningReceived || node.latestReceivedFailed;
      const color = Number.parseInt(nodeStatusColor(node).slice(1), 16);
      const size = 0.34 + Math.min(node.sentCount + node.receivedCount, 10) * 0.025;
      const geometry = new THREE.SphereGeometry(size, 32, 24);
      const material = new THREE.MeshStandardMaterial({
        color: 0x17131f,
        emissive: color,
        emissiveIntensity: active ? 0.32 : 0.16,
        roughness: 0.42,
        metalness: 0.15,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(asVector(node.position));
      mesh.userData.selection = { kind: "node", id: node.id };
      mesh.userData.node = node;
      mesh.userData.active = active;
      root.add(mesh);
      pickables.push(mesh as Pickable);
      registerSelectable(`node:${node.id}`, mesh);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(size + 0.08, size + 0.13, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: active ? 0.5 : 0.28, side: THREE.DoubleSide }),
      );
      halo.position.copy(asVector(node.position));
      halo.userData.billboard = true;
      root.add(halo);
      registerSelectable(`node:${node.id}`, halo, active ? 0.5 : 0.28);

      if (node.memoryCount > 0) {
        const memHalo = new THREE.Mesh(
          new THREE.RingGeometry(size + 0.22, size + 0.28, 48),
          new THREE.MeshBasicMaterial({
            color: 0xf59e0b,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
          }),
        );
        memHalo.position.copy(asVector(node.position));
        memHalo.userData.billboard = true;
        root.add(memHalo);
        registerSelectable(`node:${node.id}`, memHalo, 0.45);
        memoryHalos.push({ mesh: memHalo, baseScale: 1, phase: node.id.length * 0.33 });

        if (node.memoryCount > 1 && sceneModel.policy.showLabels) {
          const badge = makeLabelSprite(`${node.memoryCount} mem`, "#f59e0b");
          badge.scale.set(1.2, 0.3, 1);
          badge.position.copy(asVector(node.position).add(new THREE.Vector3(size + 0.55, size + 0.1, 0)));
          root.add(badge);
          registerSelectable(`node:${node.id}`, badge, 1);
        }
      }

      if (sceneModel.policy.showLabels) {
        const label = makeLabelSprite(node.label, active ? "#ffffff" : "#c9c0d8");
        label.position.copy(asVector(node.position).add(new THREE.Vector3(0, size + 0.48, 0)));
        root.add(label);
        registerSelectable(`node:${node.id}`, label, 1);
      }
    }

    const resize = () => {
      const box = shell.getBoundingClientRect();
      const width = Math.max(320, Math.floor(box.width));
      const height = Math.max(360, Math.floor(box.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(shell);
    resize();

    let visible = true;
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    visibilityObserver.observe(shell);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, moved: false, x: 0, y: 0 };
    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const resetView = () => {
      controls.reset();
      root.rotation.set(-0.22, 0, 0);
      camera.position.set(0, 5.5, sceneModel.nodes.length <= 2 ? 9.5 : 13.5);
      camera.lookAt(0, 0, 0);
    };
    resetRef.current = resetView;
    focusRef.current = () => {
      const selectionKey = selectionObjectKey(latestSelectionRef.current, graph);
      if (!selectionKey) return resetView();
      const selectedNode = selectionKey.startsWith("node:")
        ? sceneModel.nodes.find((node) => `node:${node.id}` === selectionKey)
        : null;
      const selectedEdge = selectionKey.startsWith("edge:")
        ? sceneModel.edges.find((edge) => `edge:${edge.key}` === selectionKey)
        : null;
      const target = selectedNode ? asVector(selectedNode.position) : selectedEdge ? new THREE.QuadraticBezierCurve3(asVector(selectedEdge.from), asVector(selectedEdge.control), asVector(selectedEdge.to)).getPoint(0.5) : new THREE.Vector3(0, 0, 0);
      controls.target.copy(target);
      camera.position.copy(target.clone().add(new THREE.Vector3(0, 3.2, 7.5)));
      camera.lookAt(target);
      controls.update();
    };

    const hitTest = () => {
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(pickables, false)[0]?.object as Pickable | undefined;
    };
    const onPointerDown = (event: PointerEvent) => {
      drag.active = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = event.clientX;
      drag.y = event.clientY;
    };
    const onPointerHover = (event: PointerEvent) => {
      if (drag.active) return;
      setPointer(event);
      const selected = hitTest()?.userData.selection;
      if (!selected || selected.kind === "trace") {
        setHover(null);
        return;
      }
      setHover({ ...selected, x: event.clientX, y: event.clientY });
    };
    const onPointerUp = (event: PointerEvent) => {
      drag.active = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
      if (drag.moved) return;
      setPointer(event);
      onSelect(hitTest()?.userData.selection ?? null);
    };
    const onGesture = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointermove", onPointerHover);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", () => setHover(null));
    canvas.addEventListener("gesturestart", onGesture);
    canvas.addEventListener("gesturechange", onGesture);

    let frame = 0;
    let frameCount = 0;
    let previousFrameAt = performance.now();
    const startedAt = previousFrameAt;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      if (!visible) return;
      const now = performance.now();
      const elapsed = (now - startedAt) / 1000;
      const delta = (now - previousFrameAt) / 1000;
      previousFrameAt = now;
      controls.update();
      if (!reducedMotion && !drag.active) root.rotation.y += delta * 0.035;
      for (const particle of particles) {
        const t = reducedMotion ? particle.offset : (particle.offset + elapsed * particle.speed) % 1;
        particle.mesh.position.copy(particle.arc.getPoint(t));
      }
      for (const halo of memoryHalos) {
        const pulse = reducedMotion ? 0.5 : (Math.sin(elapsed * 1.8 + halo.phase) + 1) / 2;
        const scale = halo.baseScale + pulse * 0.06;
        halo.mesh.scale.setScalar(scale);
        for (const material of materialList(halo.mesh)) {
          material.opacity = 0.32 + pulse * 0.18;
        }
      }
      root.traverse((child) => {
        if (child instanceof THREE.Sprite || child.userData.billboard) child.quaternion.copy(camera.quaternion);
      });
      if (process.env.NODE_ENV === "development" && frameCount % 180 === 0) {
        canvas.dataset.drawCalls = String(renderer.info.render.calls);
        canvas.dataset.triangles = String(renderer.info.render.triangles);
      }
      frameCount += 1;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointermove", onPointerHover);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("gesturestart", onGesture);
      canvas.removeEventListener("gesturechange", onGesture);
      objectBySelectionRef.current = new Map();
      resetRef.current = null;
      focusRef.current = null;
      controls.dispose();
      disposeObject(root);
      particleGeometry.dispose();
      for (const material of particleMaterials.values()) material.dispose();
      renderer.dispose();
    };
  }, [familiars, graph, labels, onSelect, reducedMotion, sceneModel]);

  const selectable = useMemo<TraceGraphSelection[]>(() => [
    ...sceneModel.nodes.map((node) => ({ kind: "node" as const, id: node.id })),
    ...sceneModel.edges.map((edge) => ({ kind: "edge" as const, key: edge.key })),
  ], [sceneModel.edges, sceneModel.nodes]);

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

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") onSelect(null);
    if (event.key === "Home") resetRef.current?.();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      focusRef.current?.();
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      const current = selectable.findIndex((item) => selectionEquals(item, selection));
      onSelect(selectable[(current + 1 + selectable.length) % selectable.length] ?? null);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      const current = selectable.findIndex((item) => selectionEquals(item, selection));
      onSelect(selectable[(current - 1 + selectable.length) % selectable.length] ?? null);
    }
  };

  if (graph.nodes.length === 0) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center bg-[radial-gradient(circle_at_center,rgba(142,61,255,.12),transparent_58%)] text-sm text-[var(--text-muted)]">
        No delegation traces in this view.
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative min-h-[430px] flex-1 overflow-hidden bg-[oklch(0.11_0.022_293)]">
      <canvas
        ref={canvasRef}
        data-testid="trace-graph-3d-canvas"
        aria-label="3D delegation trace graph"
        role="application"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full min-h-[430px] w-full cursor-grab touch-none active:cursor-grabbing"
      />
      <p aria-live="polite" className="sr-only">{selectedSummary}</p>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="rounded-lg border border-white/10 bg-black/45 px-3 py-2 shadow-2xl backdrop-blur">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/55">3D trace graph</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/70">
            <span>{graph.nodes.length} agents</span>
            <span>{graph.edges.length} routes</span>
            <span>{graph.traces.length} traces</span>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-black/45 p-1 shadow-2xl backdrop-blur">
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-white/70 hover:bg-white/10 hover:text-white" onClick={() => focusRef.current?.()}>
            <Icon name="ph:cursor-click" width={12} />
            Focus selected
          </button>
          <button type="button" className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-white/70 hover:bg-white/10 hover:text-white" onClick={() => resetRef.current?.()}>
            <Icon name="ph:arrows-clockwise-bold" width={12} />
            Reset view
          </button>
        </div>
      </div>
      <div className="absolute left-3 top-16 hidden max-w-[360px] flex-wrap gap-1 md:flex">
        {sceneModel.edges.slice(0, 6).map((edge) => (
          <button
            key={edge.key}
            type="button"
            onClick={() => onSelect({ kind: "edge", key: edge.key })}
            className={[
              "rounded-md border px-2 py-1 text-[10px] backdrop-blur",
              selectedObjectKey === `edge:${edge.key}`
                ? "border-white/35 bg-white/15 text-white"
                : "border-white/10 bg-black/35 text-white/65 hover:bg-white/10",
            ].join(" ")}
          >
            {familiarName(familiars, edge.caller)} -&gt; {familiarName(familiars, edge.callee)}
          </button>
        ))}
      </div>
      {sceneModel.policy.detail !== "full" ? (
        <div className="pointer-events-none absolute right-3 top-16 max-w-[280px] rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_25%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_18%,transparent)] px-3 py-2 text-[10px] text-[var(--color-warning)] shadow-2xl backdrop-blur">
          Dense graph mode: showing strongest routes first.
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-[10px] text-white/65 shadow-2xl backdrop-blur">
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#8E3DFF]" /> explicit</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#fbbf24]" /> inferred</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#38bdf8]" /> mixed</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#62d08f]" /> running</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#f87171]" /> failed</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-[#f59e0b]" /> memory</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 right-3 hidden rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-[10px] text-white/55 shadow-2xl backdrop-blur md:block">
        Drag to orbit · pinch or scroll to zoom · click nodes or routes
      </div>
      {hover ? <GraphHoverTooltip hover={hover} graph={graph} familiars={familiars} memoryCounts={memoryCounts} /> : null}
    </div>
  );
}

function GraphHoverTooltip({
  hover,
  graph,
  familiars,
  memoryCounts,
}: {
  hover: NonNullable<GraphHover>;
  graph: DelegationGraph;
  familiars: Map<string, Familiar>;
  memoryCounts?: Map<string, number>;
}) {
  const title = hover.kind === "node"
    ? familiarName(familiars, hover.id)
    : (() => {
      const edge = graph.edges.find((candidate) => edgeKey(candidate) === hover.key);
      return edge ? `${familiarName(familiars, edge.caller)} -> ${familiarName(familiars, edge.callee)}` : "Delegation route";
    })();
  const detail = hover.kind === "node"
    ? graph.nodes.find((node) => node.id === hover.id)
    : graph.edges.find((edge) => edgeKey(edge) === hover.key);
  const memoryCount = hover.kind === "node" ? memoryCounts?.get(hover.id) ?? 0 : 0;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-[280px] rounded-lg border border-white/10 bg-black/85 px-3 py-2 text-[11px] text-white shadow-2xl backdrop-blur"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
    >
      <div className="font-semibold">{title}</div>
      {detail && "count" in detail ? (
        <div className="mt-1 text-white/65">{detail.count} traces · {detail.source} · {detail.latestStatus}</div>
      ) : detail ? (
        <div className="mt-1 text-white/65">
          {detail.sentCount} sent · {detail.receivedCount} received
          {memoryCount > 0 ? ` · ${memoryCount} memories` : ""}
        </div>
      ) : null}
    </div>
  );
}

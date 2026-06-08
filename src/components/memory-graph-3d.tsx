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
import { Icon } from "@/lib/icon";
import type { Familiar } from "@/lib/types";
import {
  buildMemoryGraphSceneModel,
  type MemoryGraph,
  type MemoryGraphSceneNode,
} from "@/lib/memory-graph-3d-model";

type Props = {
  graph: MemoryGraph;
  familiars: Map<string, Familiar>;
  selectedFamiliarId: string;
  onSelectFamiliar: (familiarId: string) => void;
  onOpenMemoryFile?: (path: string) => void;
};

type Pickable = THREE.Object3D & {
  userData: {
    node?: MemoryGraphSceneNode;
    nodes?: MemoryGraphSceneNode[];
    baseOpacity?: number;
  };
};

type Hover = { node: MemoryGraphSceneNode; x: number; y: number } | null;

function asVector(position: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y, position.z);
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

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function makeLabelSprite(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  canvas.width = 384;
  canvas.height = 96;
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(10, 10, 14, 0.72)";
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

function materialList(object: THREE.Object3D): THREE.Material[] {
  const material = (object as THREE.Mesh | THREE.Line | THREE.Sprite | THREE.InstancedMesh).material;
  if (!material) return [];
  return Array.isArray(material) ? material : [material];
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const geometry = (child as THREE.Mesh | THREE.Line | THREE.Sprite | THREE.InstancedMesh).geometry;
    if (geometry) geometries.add(geometry);
    materialList(child).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function colorFor(node: MemoryGraphSceneNode, selectedFamiliarId: string): THREE.Color {
  const color = new THREE.Color(node.color);
  const belongsToSelected =
    (node.kind === "hub" && node.familiarId === selectedFamiliarId) ||
    (node.kind !== "hub" && node.familiarId === selectedFamiliarId);
  if (belongsToSelected) return color;
  return color.lerp(new THREE.Color("#201927"), 0.42);
}

function nodeIsDimmed(node: MemoryGraphSceneNode, selectedFamiliarId: string): boolean {
  if (node.kind === "hub") return node.hubKind === "familiar" && node.familiarId !== selectedFamiliarId;
  return node.familiarId !== selectedFamiliarId;
}

function compactAge(iso: string | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function MemoryGraph3D({
  graph,
  familiars,
  selectedFamiliarId,
  onSelectFamiliar,
  onOpenMemoryFile,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const reducedMotion = useReducedMotion();
  const sceneModel = useMemo(() => buildMemoryGraphSceneModel(graph), [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || sceneModel.nodes.length === 0) return;

    canvas.dataset.effectStarted = "true";
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvas.dataset.rendererReady = "true";

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07070d, 0.042);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 90);
    camera.position.set(0.3, 4.5, sceneModel.nodes.length <= 4 ? 8.2 : 10.2);
    camera.lookAt(-0.45, 0.22, 0);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4.8;
    controls.maxDistance = 18;
    controls.target.set(-0.45, 0.22, 0);
    controls.saveState();

    const root = new THREE.Group();
    root.rotation.x = -0.18;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const key = new THREE.DirectionalLight(0xe2d6ff, 2.4);
    key.position.set(4, 8, 7);
    scene.add(key);
    const fill = new THREE.PointLight(0x38bdf8, 16, 24);
    fill.position.set(-6, 2, 5);
    scene.add(fill);

    const pickables: Pickable[] = [];
    const hubs = sceneModel.nodes.filter((node) => node.kind === "hub");
    const leaves = sceneModel.nodes.filter((node) => node.kind === "memory");
    const clusters = sceneModel.nodes.filter((node) => node.kind === "cluster");
    const grid = new THREE.GridHelper(12, 12, 0x2c2440, 0x151520);
    grid.position.y = -2.35;
    root.add(grid);

    for (const edge of sceneModel.edges) {
      const geometry = new THREE.BufferGeometry().setFromPoints([asVector(edge.from), asVector(edge.to)]);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(edge.color),
        transparent: true,
        opacity: edge.opacity,
      });
      root.add(new THREE.Line(geometry, material));
    }

    for (const hub of hubs) {
      const geometry = new THREE.BoxGeometry(1.18, 1.72, 0.28);
      const material = new THREE.MeshStandardMaterial({
        color: 0x17131f,
        emissive: colorFor(hub, selectedFamiliarId),
        emissiveIntensity: nodeIsDimmed(hub, selectedFamiliarId) ? 0.1 : 0.36,
        roughness: 0.42,
        metalness: 0.12,
      });
      const mesh = new THREE.Mesh(geometry, material) as Pickable;
      mesh.position.copy(asVector(hub.position));
      mesh.userData.node = hub;
      root.add(mesh);
      pickables.push(mesh);

      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(1.58 + Math.min(hub.memoryCount, 28) * 0.012, 2.1),
        new THREE.MeshBasicMaterial({
          color: colorFor(hub, selectedFamiliarId),
          transparent: true,
          opacity: nodeIsDimmed(hub, selectedFamiliarId) ? 0.08 : 0.18,
          side: THREE.DoubleSide,
        }),
      );
      halo.position.copy(asVector(hub.position).add(new THREE.Vector3(0, 0, -0.08)));
      halo.userData.billboard = true;
      root.add(halo);

      const label = makeLabelSprite(
        familiars.get(hub.familiarId ?? "")?.display_name ?? hub.label,
        nodeIsDimmed(hub, selectedFamiliarId) ? "#7d748c" : "#f7f1ff",
      );
      label.position.copy(asVector(hub.position).add(new THREE.Vector3(0, hub.radius + 0.55, 0)));
      root.add(label);
    }

    if (leaves.length > 0) {
      const geometry = new THREE.BoxGeometry(1.14, 0.44, 0.08);
      const material = new THREE.MeshBasicMaterial({
        color: 0x62d08f,
        transparent: true,
        opacity: 0.86,
      });
      const instanced = new THREE.InstancedMesh(geometry, material, leaves.length);
      const matrix = new THREE.Matrix4();
      leaves.forEach((node, index) => {
        const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.02 * Math.cos(index), 0.08 * Math.sin(index), 0.02 * Math.cos(index)));
        matrix.compose(
          asVector(node.position),
          tilt,
          new THREE.Vector3(1, 1, 1),
        );
        instanced.setMatrixAt(index, matrix);
      });
      instanced.instanceMatrix.needsUpdate = true;
      instanced.userData.nodes = leaves;
      root.add(instanced);
      pickables.push(instanced as Pickable);

      leaves.slice(0, 6).forEach((node) => {
        const label = makeLabelSprite(node.label, "#dffbea");
        label.scale.set(1.72, 0.42, 1);
        label.position.copy(asVector(node.position).add(new THREE.Vector3(0, 0.46, 0)));
        root.add(label);
      });
    }

    for (const cluster of clusters) {
      const color = colorFor(cluster, selectedFamiliarId);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.24, 0.16, 0.64),
        new THREE.MeshStandardMaterial({
          color: 0x1e1820,
          emissive: color,
          emissiveIntensity: nodeIsDimmed(cluster, selectedFamiliarId) ? 0.08 : 0.28,
          roughness: 0.48,
        }),
      ) as Pickable;
      mesh.position.copy(asVector(cluster.position));
      mesh.userData.node = cluster;
      root.add(mesh);
      pickables.push(mesh);

      const label = makeLabelSprite(cluster.label, nodeIsDimmed(cluster, selectedFamiliarId) ? "#8f7d59" : "#fbbf24");
      label.scale.set(1.25, 0.32, 1);
      label.position.copy(asVector(cluster.position).add(new THREE.Vector3(0, cluster.radius + 0.34, 0)));
      root.add(label);
    }

    const resize = () => {
      const box = shell.getBoundingClientRect();
      const width = Math.max(320, Math.floor(box.width));
      const height = Math.max(420, Math.floor(box.height));
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

    const resetView = () => {
      controls.reset();
      root.rotation.set(-0.18, 0, 0);
      camera.position.set(0.3, 4.5, sceneModel.nodes.length <= 4 ? 8.2 : 10.2);
      camera.lookAt(-0.45, 0.22, 0);
      controls.update();
    };
    resetRef.current = resetView;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const drag = { active: false, moved: false, x: 0, y: 0 };
    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const hitNode = (): MemoryGraphSceneNode | null => {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) return null;
      const object = hit.object as Pickable;
      if (object.userData.node) return object.userData.node;
      if (typeof hit.instanceId === "number") return object.userData.nodes?.[hit.instanceId] ?? null;
      return null;
    };
    const onPointerDown = (event: PointerEvent) => {
      drag.active = true;
      drag.moved = false;
      drag.x = event.clientX;
      drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag.active) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        drag.x = event.clientX;
        drag.y = event.clientY;
        return;
      }
      setPointer(event);
      const node = hitNode();
      setHover(node ? { node, x: event.clientX, y: event.clientY } : null);
    };
    const onPointerUp = (event: PointerEvent) => {
      drag.active = false;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
      if (drag.moved) return;
      setPointer(event);
      const node = hitNode();
      if (!node) {
        resetRef.current?.();
      } else if (node.kind === "hub") {
        if (node.familiarId) onSelectFamiliar(node.familiarId);
      } else if (node.kind === "memory") {
        onOpenMemoryFile?.(node.path);
      } else if (node.familiarId) {
        onSelectFamiliar(node.familiarId);
      } else {
        resetRef.current?.();
      }
    };
    const onPointerLeave = () => setHover(null);
    const onGesture = (event: Event) => event.preventDefault();
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("gesturestart", onGesture);
    canvas.addEventListener("gesturechange", onGesture);

    let frame = 0;
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
      if (!reducedMotion && !drag.active) root.rotation.y += delta * 0.025;
      root.traverse((child) => {
        if (child instanceof THREE.Sprite || child.userData.billboard) child.quaternion.copy(camera.quaternion);
        if (!reducedMotion && child.userData.billboard) {
          const pulse = (Math.sin(elapsed * 1.5) + 1) / 2;
          for (const material of materialList(child)) {
            if ("opacity" in material && typeof child.userData.baseOpacity === "number") {
              material.opacity = child.userData.baseOpacity + pulse * 0.08;
            }
          }
        }
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("gesturestart", onGesture);
      canvas.removeEventListener("gesturechange", onGesture);
      resetRef.current = null;
      controls.dispose();
      disposeObject(root);
      renderer.dispose();
    };
  }, [familiars, graph, onOpenMemoryFile, onSelectFamiliar, reducedMotion, sceneModel, selectedFamiliarId]);

  const selectedLabel = `Selected agent ${familiars.get(selectedFamiliarId)?.display_name ?? selectedFamiliarId}; ${graph.metrics.visibleCovenEntries} memories in view.`;

  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (event.key === "Escape") resetRef.current?.();
    if (event.key === "Home") resetRef.current?.();
  };

  if (sceneModel.nodes.length === 0) {
    return (
      <div className="grid min-h-[420px] flex-1 place-items-center bg-[oklch(0.11_0.022_293)] text-sm text-white/55">
        No memories for this agent.
      </div>
    );
  }

  return (
    <div ref={shellRef} className="relative min-h-[520px] flex-1 overflow-hidden bg-[oklch(0.105_0.024_286)]">
      <canvas
        ref={canvasRef}
        data-testid="memory-graph-3d-canvas"
        aria-label="3D familiar memory map"
        role="application"
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="h-full min-h-[520px] w-full cursor-grab touch-none active:cursor-grabbing"
      />
      <p aria-live="polite" className="sr-only">{selectedLabel}</p>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="rounded-lg border border-white/10 bg-black/45 px-3 py-2 shadow-2xl backdrop-blur">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-white/55">Agent memory map</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-white/70">
            <span>{familiars.get(selectedFamiliarId)?.display_name ?? selectedFamiliarId}</span>
            <span>{graph.metrics.visibleCovenEntries} memories</span>
          </div>
        </div>
        <button
          type="button"
          title="Reset view"
          onClick={() => resetRef.current?.()}
          className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-black/45 text-white/70 shadow-2xl backdrop-blur hover:bg-white/10 hover:text-white"
        >
          <Icon name="ph:arrows-clockwise-bold" width={14} />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-[10px] text-white/65 shadow-2xl backdrop-blur">
        <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-[#8E3DFF]" /> agent</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-[#62d08f]" /> memory card</span>
        <span className="inline-flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-[#f59e0b]" /> older stack</span>
      </div>
      {graph.metrics.hiddenEntries > 0 ? (
        <div className="pointer-events-none absolute right-3 top-16 max-w-[260px] rounded-lg border border-[color-mix(in_oklch,var(--color-warning)_25%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_18%,transparent)] px-3 py-2 text-[10px] text-[var(--color-warning)] shadow-2xl backdrop-blur">
          Dense memory: {graph.metrics.hiddenEntries} older entries are stacked.
        </div>
      ) : null}
      {hover ? <MemoryGraphTooltip hover={hover} familiars={familiars} /> : null}
    </div>
  );
}

function MemoryGraphTooltip({
  hover,
  familiars,
}: {
  hover: NonNullable<Hover>;
  familiars: Map<string, Familiar>;
}) {
  const { node } = hover;
  const familiarName = node.familiarId ? familiars.get(node.familiarId)?.display_name ?? node.familiarId : "Memory";
  const detail = node.kind === "hub"
    ? `${node.memoryCount} memories`
    : node.kind === "cluster"
      ? `${node.count} older memories`
      : `${familiarName} · ${compactAge(node.updatedAt)}`;

  return (
    <div
      className="pointer-events-none fixed z-50 max-w-[300px] rounded-lg border border-white/10 bg-black/85 px-3 py-2 text-[11px] text-white shadow-2xl backdrop-blur"
      style={{ left: hover.x + 12, top: hover.y + 12 }}
    >
      <div className="font-semibold">{node.label}</div>
      <div className="mt-1 text-white/65">{detail}</div>
      {node.kind === "memory" && node.excerpt ? (
        <div className="mt-2 line-clamp-3 text-white/55">{node.excerpt}</div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Icon } from "@/lib/icon";
import type { GraphifyGraph, GraphifyNode, GraphifyRunSnapshot } from "@/lib/library-types";
import {
  buildGraphSnapshotBTree,
  buildLibraryGraphSceneModel,
  diffGraphSnapshots,
  rangeGraphSnapshots,
} from "@/lib/library-graph-3d-model";

type Props = {
  graph: GraphifyGraph;
  snapshots?: GraphifyRunSnapshot[];
  targetPath: string;
  label: string;
  filter: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
};

type Pickable = THREE.Mesh & {
  userData: {
    node?: GraphifyNode;
    baseScale?: number;
  };
};

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh | THREE.Line | THREE.Sprite;
    const geometry = (mesh as THREE.Mesh).geometry;
    if (geometry) geometries.add(geometry);
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => materials.add(item));
    else if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    const map = (material as THREE.SpriteMaterial | THREE.MeshStandardMaterial).map;
    if (map) map.dispose();
    material.dispose();
  });
}

function vector(position: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(position.x, position.y, position.z);
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(8, 7, 12, 0.76)";
    context.strokeStyle = "rgba(255, 255, 255, 0.16)";
    context.lineWidth = 2;
    context.beginPath();
    context.roundRect(12, 24, 488, 70, 18);
    context.fill();
    context.stroke();
    context.font = "600 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.fillStyle = "#f4f0ff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text.length > 28 ? `${text.slice(0, 26)}...` : text, canvas.width / 2, 59);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.4, 0.85, 1);
  return sprite;
}

function statusClass(status: GraphifyRunSnapshot["status"]): string {
  if (status === "completed") return "border-[var(--accent-success)] bg-white/[0.04]";
  if (status === "failed") return "border-red-400/50 bg-red-400/10";
  return "border-[var(--accent-presence)] bg-white/[0.06]";
}

function shortTime(iso: string): string {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}

export function LibraryGraph3D({
  graph,
  snapshots = [],
  targetPath,
  label,
  filter,
  selectedNodeId,
  onSelectNode,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const nodeObjectRef = useRef(new Map<string, THREE.Object3D>());
  const resetCameraRef = useRef<(() => void) | null>(null);
  const focusSelectedRef = useRef<(() => void) | null>(null);
  const latestSelectedRef = useRef<string | null>(selectedNodeId);
  const hoveredRef = useRef<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
  const sceneModel = useMemo(() => buildLibraryGraphSceneModel(graph), [graph]);
  const snapshotTree = useMemo(() => buildGraphSnapshotBTree(snapshots), [snapshots]);
  const timeline = useMemo(() => rangeGraphSnapshots(snapshotTree, targetPath), [snapshotTree, targetPath]);
  const latestSnapshot = timeline[timeline.length - 1];
  const priorSnapshot = timeline[timeline.length - 2];
  const delta = diffGraphSnapshots(priorSnapshot, latestSnapshot);
  const filteredIds = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return new Set(graph.nodes.map((node) => node.id));
    return new Set(
      graph.nodes
        .filter((node) => [node.label, node.type ?? "", node.id].some((value) => String(value).toLowerCase().includes(query)))
        .map((node) => node.id),
    );
  }, [filter, graph.nodes]);

  useEffect(() => {
    latestSelectedRef.current = selectedNodeId;
  }, [selectedNodeId]);

  useEffect(() => {
    hoveredRef.current = hoveredId;
  }, [hoveredId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell || sceneModel.nodes.length === 0) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06060a, 0.034);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 120);
    const distance = sceneModel.policy.detail === "summary" ? 30 : 20;
    camera.position.set(0, 8, distance);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.minDistance = 4;
    controls.maxDistance = 54;
    controls.target.set(0, 0, 0);
    controls.saveState();

    const root = new THREE.Group();
    root.rotation.x = -0.16;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xd9c7ff, 2.8);
    key.position.set(4, 10, 8);
    scene.add(key);
    const fill = new THREE.PointLight(0x62d08f, 16, 28);
    fill.position.set(-9, 4, 5);
    scene.add(fill);
    const grid = new THREE.GridHelper(34, 34, 0x2a2140, 0x15151f);
    grid.position.y = -7;
    root.add(grid);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pickables: Pickable[] = [];
    const nodeObjects = new Map<string, THREE.Object3D>();
    nodeObjectRef.current = nodeObjects;

    for (const edge of sceneModel.edges) {
      const curve = new THREE.QuadraticBezierCurve3(vector(edge.from), vector(edge.control), vector(edge.to));
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
      const material = new THREE.LineBasicMaterial({
        color: 0x6f6387,
        transparent: true,
        opacity: sceneModel.policy.detail === "summary" ? 0.24 : 0.46,
      });
      root.add(new THREE.Line(geometry, material));
    }

    const sphereGeometry = new THREE.SphereGeometry(1, sceneModel.policy.detail === "summary" ? 12 : 20, sceneModel.policy.detail === "summary" ? 10 : 16);
    for (const node of sceneModel.nodes) {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(node.color),
        emissive: new THREE.Color(node.color),
        emissiveIntensity: node.id === latestSelectedRef.current ? 0.7 : 0.2,
        roughness: 0.42,
        metalness: 0.16,
        transparent: true,
        opacity: filteredIds.has(node.id) ? 0.96 : 0.18,
      });
      const mesh = new THREE.Mesh(sphereGeometry, material) as Pickable;
      mesh.position.copy(vector(node.position));
      mesh.scale.setScalar(node.radius);
      mesh.userData.node = node;
      mesh.userData.baseScale = node.radius;
      root.add(mesh);
      pickables.push(mesh);
      nodeObjects.set(node.id, mesh);

      if (sceneModel.policy.showLabels || node.id === latestSelectedRef.current) {
        const labelSprite = makeLabelSprite(node.label);
        labelSprite.position.set(node.position.x, node.position.y + node.radius + 0.42, node.position.z);
        root.add(labelSprite);
        nodeObjects.set(`${node.id}:label`, labelSprite);
      }
    }

    const resize = () => {
      const rect = shell.getBoundingClientRect();
      const width = Math.max(rect.width, 320);
      const height = Math.max(rect.height, 240);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(shell);
    resize();

    const focusNode = (id: string | null) => {
      if (!id) return;
      const object = nodeObjectRef.current.get(id);
      if (!object) return;
      const world = new THREE.Vector3();
      object.getWorldPosition(world);
      controls.target.copy(world);
      const offset = new THREE.Vector3(3.5, 2.4, 5.2);
      camera.position.copy(world.clone().add(offset));
      camera.lookAt(world);
      controls.update();
    };
    resetCameraRef.current = () => {
      controls.reset();
      camera.position.set(0, 8, distance);
      camera.lookAt(0, 0, 0);
    };
    focusSelectedRef.current = () => focusNode(latestSelectedRef.current);

    const updatePointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const pick = (event: PointerEvent) => {
      updatePointer(event);
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(pickables, false)[0]?.object as Pickable | undefined;
    };
    const onPointerMove = (event: PointerEvent) => {
      const hit = pick(event);
      setHoveredId(hit?.userData.node?.id ?? null);
      canvas.style.cursor = hit ? "pointer" : "grab";
    };
    const onPointerLeave = () => {
      setHoveredId(null);
      canvas.style.cursor = "grab";
    };
    const onPointerDown = () => {
      canvas.style.cursor = "grabbing";
    };
    const onPointerUp = (event: PointerEvent) => {
      canvas.style.cursor = "grab";
      const hit = pick(event);
      onSelectNode(hit?.userData.node?.id ?? null);
    };
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);

    let frame = 0;
    const animate = () => {
      frame = window.requestAnimationFrame(animate);
      controls.update();
      for (const node of sceneModel.nodes) {
        const object = nodeObjects.get(node.id) as Pickable | undefined;
        if (!object) continue;
        const selected = node.id === latestSelectedRef.current;
        const hovered = node.id === hoveredRef.current;
        const scale = (object.userData.baseScale ?? node.radius) * (selected ? 1.55 : hovered ? 1.25 : 1);
        object.scale.setScalar(scale);
        const material = object.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = selected ? 0.78 : hovered ? 0.44 : 0.2;
      }
      root.rotation.y += sceneModel.policy.animateParticles ? 0.00045 : 0;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(frame);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      resizeObserver.disconnect();
      controls.dispose();
      disposeObject(root);
      renderer.dispose();
      nodeObjectRef.current = new Map();
      resetCameraRef.current = null;
      focusSelectedRef.current = null;
    };
  }, [filteredIds, onSelectNode, sceneModel]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        No nodes in this graph.
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#05050a]">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_45%_28%,rgba(142,61,255,0.22),transparent_34%),radial-gradient(circle_at_70%_62%,rgba(98,208,143,0.11),transparent_28%)]" />
      <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{label}</div>
          <div className="truncate text-[10px] text-[var(--text-muted)]">
            {sceneModel.nodes.length} nodes · {sceneModel.edges.length}/{graph.edges.length} edges · {sceneModel.policy.detail}
            {latestSnapshot ? ` · ${latestSnapshot.status}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => resetCameraRef.current?.()}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-white/[0.08]"
          >
            <Icon name="ph:arrows-clockwise" width={12} />
            Reset
          </button>
          <button
            type="button"
            onClick={() => focusSelectedRef.current?.()}
            disabled={!selectedNodeId}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded border border-white/10 bg-white/[0.04] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-white/[0.08] disabled:opacity-40"
          >
            <Icon name="ph:arrows-in-simple" width={12} />
            Focus
          </button>
        </div>
      </div>

      <div ref={shellRef} className="relative z-10 min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          data-testid="library-graph-3d-canvas"
          className="block h-full w-full cursor-grab"
          aria-label="Three-dimensional Graphify knowledge graph"
        />
        <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur">
          Drag rotate · wheel zoom · right-drag pan · click to inspect
        </div>
      </div>

      <div data-testid="library-graph-snapshot-strip" className="relative z-10 shrink-0 border-t border-white/10 bg-black/28 px-3 py-2 backdrop-blur">
        <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
          <span>Run snapshots</span>
          <span>
            {delta.nodeDelta >= 0 ? "+" : ""}{delta.nodeDelta} nodes · {delta.edgeDelta >= 0 ? "+" : ""}{delta.edgeDelta} edges
          </span>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {timeline.length === 0 ? (
            <div className="rounded border border-white/10 px-2 py-1 text-[10px] text-[var(--text-muted)]">No snapshots yet</div>
          ) : timeline.slice(-14).map((snapshot) => (
            <button
              type="button"
              key={snapshot.id}
              onClick={() => setActiveSnapshotId(snapshot.id)}
              title={`${snapshot.status} · ${snapshot.nodeCount} nodes · ${snapshot.edgeCount} edges`}
              className={`min-w-[84px] rounded border px-2 py-1 text-left text-[10px] transition-colors hover:bg-white/[0.08] ${statusClass(snapshot.status)} ${activeSnapshotId === snapshot.id ? "ring-1 ring-[var(--accent-presence)]" : ""}`}
            >
              <div className="font-medium text-[var(--text-primary)]">{shortTime(snapshot.generatedAt)}</div>
              <div className="text-[var(--text-muted)]">{snapshot.nodeCount}n · {snapshot.edgeCount}e</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

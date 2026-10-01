"use client";

// The Grimoire graph: a force-directed constellation over every doc the Cave
// keeps (cave-hand). Nodes are docs (and tags), sized by connection count;
// edges carry their generator: solid = explicit [[wiki-link]], dashed =
// inferred unlinked mention, faint = tag membership.
//
// Two projections share one physics model (`lib/grimoire-force.ts`):
//   3D (default) — the layout lives in a volume and a perspective camera orbits
//                  it. Drag to orbit, shift-drag to pan, scroll to dolly. Depth
//                  reads through size, fog and draw order; the camera drifts
//                  slowly while idle so the structure reads as a shape.
//   2D           — the original flat, Obsidian-style pan/zoom canvas.
//
// Traversal is the point of the view, so a click SELECTS rather than opens: the
// camera flies to the node, its neighbourhood stays lit while the rest dims,
// and a focus panel lists the node's relations grouped by kind. Each relation
// is one click to fly on; a trail records the path for Back. Double-click,
// Enter, or the panel's Open button opens the doc.
//
// Rendering is a hand-rolled <canvas> pass with no 3D or diagram dependency:
// a few hundred projected points do not need WebGL, and the bundle stays as it
// was. Reduced motion settles the layout synchronously, skips camera flights
// and idle drift, and renders still. Positions and the camera are cached
// module-level so reopening the graph resumes where you left it.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon, type IconName } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { DocGraph, DocGraphEdge, DocGraphNode, GraphEdgeType, GraphNodeKind } from "@/lib/grimoire-graph";
import type { GrimoireGraphMeta } from "@/lib/server/grimoire-graph-scan";
import type { WikiDocRef } from "@/lib/wiki-link-resolve";
import {
  ALPHA_MIN,
  createForceSim,
  DEFAULT_FORCE_PARAMS,
  pinForceSimNode,
  reheatForceSim,
  settleForceSim,
  sphereSeed,
  spiralSeed,
  tickForceSim,
  unpinForceSimNode,
  type ForceParams,
  type ForceSim,
} from "@/lib/grimoire-force";

// ── Preferences (persisted) ──────────────────────────────────────────────────

const PREFS_STORAGE_KEY = "cave:grimoire:graph-prefs";

type GraphPrefs = {
  groups: Record<GraphNodeKind, boolean>;
  edgeTypes: Record<GraphEdgeType, boolean>;
  orphans: boolean;
  /** Multiplier on DEFAULT_FORCE_PARAMS.repelStrength (0.25–3). */
  repel: number;
  /** Spring rest length in world units (40–240). */
  linkDistance: number;
  panelOpen: boolean;
  /** Volumetric (3) or flat (2) layout. */
  dims: 2 | 3;
  /** Slow idle camera drift in 3D. */
  drift: boolean;
};

const DEFAULT_PREFS: GraphPrefs = {
  groups: { knowledge: true, memory: true, journal: true, tag: true },
  edgeTypes: { link: true, mention: true, tag: true },
  // Orphans (unconnected docs) are hidden by default: a real corpus is mostly
  // unlinked (e.g. ~400 nodes / ~30 edges), so showing them renders a
  // structureless dot cloud that buries the actual relationships. The graph is
  // for *connections* — the "Orphans" toggle lets you bring the loose nodes
  // back when you want them.
  orphans: false,
  repel: 1,
  linkDistance: DEFAULT_FORCE_PARAMS.linkDistance,
  // Filters start folded: the search box stays visible, the rest is one click.
  panelOpen: false,
  dims: 3,
  drift: true,
};

function readPrefs(): GraphPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      dims: parsed?.dims === 2 ? 2 : 3,
      groups: { ...DEFAULT_PREFS.groups, ...(parsed?.groups ?? {}) },
      edgeTypes: { ...DEFAULT_PREFS.edgeTypes, ...(parsed?.edgeTypes ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ── Session continuity — layout + viewport survive close/reopen ─────────────

/** Keyed `${dims}:${id}` so the flat and volumetric layouts never mix. */
const positionCache = new Map<string, { x: number; y: number; z: number }>();
let savedView: { panX: number; panY: number; k: number } | null = null;
type Camera = { yaw: number; pitch: number; dist: number; tx: number; ty: number; tz: number };
let savedCamera: Camera | null = null;

// ── Visual constants ─────────────────────────────────────────────────────────

const NODE_KIND_TOKEN: Record<GraphNodeKind, string> = {
  knowledge: "--accent-presence",
  memory: "--color-warning",
  journal: "--text-secondary",
  tag: "--color-success",
};

const NODE_KIND_LABEL: Record<GraphNodeKind, string> = {
  knowledge: "Stitch",
  memory: "Memory",
  journal: "Journal day",
  tag: "Tag",
};

const EDGE_STRENGTH: Record<GraphEdgeType, number> = { link: 1, tag: 0.7, mention: 0.35 };
const EDGE_DISTANCE_SCALE: Record<GraphEdgeType, number> = { link: 1, tag: 0.85, mention: 1.35 };
const DIM_ALPHA = 0.12;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 5;
/** Perspective focal length as a share of the viewport's short side. */
const FOCAL_SHARE = 0.9;
/** Nothing closer than this (world units) to the camera is drawn. */
const NEAR_PLANE = 8;
const MAX_PITCH = 1.45;
const FLIGHT_MS = 650;
/** Idle drift: radians of yaw per millisecond, after IDLE_MS without input. */
const DRIFT_RATE = 0.00006;
const IDLE_MS = 2500;
const TRAIL_LIMIT = 12;
/** Label budget: hubs named in overview, relations named around a selection. */
const LABEL_HUBS = 10;
const LABEL_NEIGHBOURS = 14;

function nodeRadius(n: DocGraphNode, degree: number): number {
  if (n.kind === "tag") return 4;
  return Math.min(16, 3.5 + 2.1 * Math.sqrt(degree));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type Palette = Record<GraphNodeKind, string> & {
  edge: string;
  label: string;
  labelStrong: string;
  halo: string;
};

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  const v = (token: string) => cs.getPropertyValue(token).trim() || "#888";
  return {
    knowledge: v(NODE_KIND_TOKEN.knowledge),
    memory: v(NODE_KIND_TOKEN.memory),
    journal: v(NODE_KIND_TOKEN.journal),
    tag: v(NODE_KIND_TOKEN.tag),
    edge: v("--border-strong"),
    label: v("--text-secondary"),
    labelStrong: v("--text-primary"),
    halo: v("--bg-raised"),
  };
}

/** One relation of the selected node, as listed in the focus panel. */
type Relation = { node: DocGraphNode; edge: DocGraphEdge; outgoing: boolean };

const RELATION_GROUPS: { key: string; label: string; icon: IconName; match: (r: Relation) => boolean }[] = [
  { key: "links-out", label: "Links to", icon: "ph:link", match: (r) => r.edge.type === "link" && r.outgoing },
  { key: "links-in", label: "Linked from", icon: "ph:link", match: (r) => r.edge.type === "link" && !r.outgoing },
  { key: "mentions", label: "Mentions", icon: "ph:sparkle", match: (r) => r.edge.type === "mention" },
  { key: "tags", label: "Tags", icon: "ph:tag", match: (r) => r.edge.type === "tag" && r.node.kind === "tag" },
  { key: "tagged", label: "Tagged docs", icon: "ph:book-open", match: (r) => r.edge.type === "tag" && r.node.kind !== "tag" },
];

// ── The view ─────────────────────────────────────────────────────────────────

export function GrimoireGraphView({
  graph,
  meta,
  scopeLabel,
  scopedMemoryTotal,
  scanning,
  scanError,
  ownerLabel,
  onOpen,
}: {
  /** The graph to render — full-corpus scan when available, else the
   *  client-built knowledge graph (so something always paints instantly). */
  graph: DocGraph;
  meta?: GrimoireGraphMeta | null;
  /** Who the shell's familiar multiselect has narrowed memory to, if anyone —
   *  the graph arrives already scoped, this only makes that visible. */
  scopeLabel?: string | null;
  /** How many memory files the active scope owns IN TOTAL, straight off the
   *  same inventory the Memory rail counts. The scan cap is applied coven-wide
   *  BEFORE scoping, so this is the number the rail shows and the graph cannot
   *  match; without it the notice can only talk about coven-wide totals and
   *  leaves the rail's figure unexplained (cave-ed4s3). Null in All scope. */
  scopedMemoryTotal?: number | null;
  /** True while the full-corpus scan is still in flight. */
  scanning?: boolean;
  /** Set when the full scan failed — the local graph stays up. */
  scanError?: string | null;
  /** Display name for a node's owning familiar (journal days carry one). */
  ownerLabel?: (familiarId: string) => string | null;
  onOpen: (ref: WikiDocRef) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useAnnouncer();
  const reducedMotion = usePrefersReducedMotion();

  const [prefs, setPrefs] = useState<GraphPrefs>(readPrefs);
  const [query, setQuery] = useState("");
  // The selected node: spotlighted, centred, and described by the focus panel.
  // Hover lives in a ref — it changes every mousemove and must not re-render.
  const [stickyId, setStickyId] = useState<string | null>(null);
  // The traversal path, oldest first, for Back.
  const [trail, setTrail] = useState<string[]>([]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode */
    }
  }, [prefs]);

  // ── Filter pipeline: edge types → groups → orphans ─────────────────────────
  const visible = useMemo(() => {
    const keepKind = (k: GraphNodeKind) => prefs.groups[k] !== false;
    const nodesByKind = graph.nodes.filter((n) => keepKind(n.kind));
    const nodeIds = new Set(nodesByKind.map((n) => n.id));
    const edges = graph.edges.filter(
      (e) => prefs.edgeTypes[e.type] !== false && nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const nodes = prefs.orphans ? nodesByKind : nodesByKind.filter((n) => (degree.get(n.id) ?? 0) > 0);
    return { nodes, edges, degree };
  }, [graph, prefs.groups, prefs.edgeTypes, prefs.orphans]);

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const e of visible.edges) {
      let s = adj.get(e.source);
      if (!s) adj.set(e.source, (s = new Set()));
      s.add(e.target);
      let t = adj.get(e.target);
      if (!t) adj.set(e.target, (t = new Set()));
      t.add(e.source);
    }
    return adj;
  }, [visible.edges]);

  const queryMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(visible.nodes.filter((n) => n.title.toLowerCase().includes(q)).map((n) => n.id));
  }, [query, visible.nodes]);

  const nodeById = useMemo(() => {
    const m = new Map<string, DocGraphNode>();
    for (const n of visible.nodes) m.set(n.id, n);
    return m;
  }, [visible.nodes]);

  const counts = useMemo(() => {
    const byKind: Record<GraphNodeKind, number> = { knowledge: 0, memory: 0, journal: 0, tag: 0 };
    for (const n of graph.nodes) byKind[n.kind]++;
    return byKind;
  }, [graph.nodes]);

  // A selection the filters removed is no longer selectable.
  useEffect(() => {
    if (stickyId && !nodeById.has(stickyId)) setStickyId(null);
  }, [nodeById, stickyId]);

  // The selected node's relations, grouped for the focus panel.
  const relations = useMemo(() => {
    if (!stickyId) return [];
    const out: Relation[] = [];
    for (const e of visible.edges) {
      if (e.source !== stickyId && e.target !== stickyId) continue;
      const otherId = e.source === stickyId ? e.target : e.source;
      const node = nodeById.get(otherId);
      if (node) out.push({ node, edge: e, outgoing: e.source === stickyId });
    }
    out.sort((a, b) => (visible.degree.get(b.node.id) ?? 0) - (visible.degree.get(a.node.id) ?? 0));
    return out;
  }, [nodeById, stickyId, visible.degree, visible.edges]);

  // ── Simulation lifecycle ────────────────────────────────────────────────────
  const simRef = useRef<ForceSim | null>(null);
  const paramsRef = useRef<ForceParams>(DEFAULT_FORCE_PARAMS);
  paramsRef.current = {
    ...DEFAULT_FORCE_PARAMS,
    repelStrength: DEFAULT_FORCE_PARAMS.repelStrength * prefs.repel,
    linkDistance: prefs.linkDistance,
  };
  const dimsRef = useRef(prefs.dims);
  dimsRef.current = prefs.dims;
  const driftRef = useRef(prefs.drift);
  driftRef.current = prefs.drift;

  const viewRef = useRef(savedView ?? { panX: 0, panY: 0, k: 1 });
  const cameraRef = useRef<Camera>(savedCamera ?? { yaw: 0.6, pitch: -0.35, dist: 600, tx: 0, ty: 0, tz: 0 });
  const flightRef = useRef<{ from: Camera; to: Camera; from2d: { panX: number; panY: number }; to2d: { panX: number; panY: number }; t0: number } | null>(null);
  const lastInputRef = useRef(0);
  const hoverRef = useRef<string | null>(null);
  const stickyRef = useRef<string | null>(null);
  stickyRef.current = stickyId;

  // Projected screen positions, refreshed every frame and reused by hit tests:
  // px/py in CSS pixels, ps = world→pixel scale, pd = camera depth.
  const projRef = useRef({ px: new Float64Array(0), py: new Float64Array(0), ps: new Float64Array(0), pd: new Float64Array(0), near: 0, far: 1 });

  // Keyboard node traversal (cave-2cx8): Tab / Shift+Tab cycle the
  // most-connected visible nodes (hubs first), announcing each and flying to
  // it, with Enter to open. Capped so Tab-cycling stays tractable; the search
  // box still reaches any node by name. Cursor released (index -1) at the ends
  // so Tab can still leave the graph.
  const keyboardNodes = useMemo(
    () =>
      [...visible.nodes]
        .sort((a, b) => (visible.degree.get(b.id) ?? 0) - (visible.degree.get(a.id) ?? 0))
        .slice(0, 40),
    [visible],
  );
  const keyboardNodesRef = useRef(keyboardNodes);
  keyboardNodesRef.current = keyboardNodes;
  const kbdIdxRef = useRef(-1);
  useEffect(() => { kbdIdxRef.current = -1; }, [keyboardNodes]);
  const paletteRef = useRef<Palette | null>(null);
  const frameRef = useRef<number | null>(null);
  const needsFitRef = useRef(prefs.dims === 3 ? savedCamera === null : savedView === null);
  const dragRef = useRef<{
    pointerId: number;
    mode: "node" | "pan" | "orbit";
    nodeIndex: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  /** Save the live sim's positions into the module cache (layout continuity). */
  const snapshotPositions = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (let i = 0; i < sim.count; i++) {
      positionCache.set(`${sim.dims}:${sim.ids[i]}`, { x: sim.x[i], y: sim.y[i], z: sim.z[i] });
    }
  }, []);

  /** Project every node for the current camera into projRef. */
  const project = useCallback((width: number, height: number) => {
    const sim = simRef.current;
    if (!sim) return;
    const proj = projRef.current;
    if (proj.px.length !== sim.count) {
      proj.px = new Float64Array(sim.count);
      proj.py = new Float64Array(sim.count);
      proj.ps = new Float64Array(sim.count);
      proj.pd = new Float64Array(sim.count);
    }
    if (sim.dims === 2) {
      const { panX, panY, k } = viewRef.current;
      for (let i = 0; i < sim.count; i++) {
        proj.px[i] = width / 2 + panX + sim.x[i] * k;
        proj.py[i] = height / 2 + panY + sim.y[i] * k;
        proj.ps[i] = k;
        proj.pd[i] = 0;
      }
      proj.near = 0;
      proj.far = 1;
      return;
    }
    const cam = cameraRef.current;
    const focal = Math.min(width, height) * FOCAL_SHARE;
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    let near = Infinity;
    let far = -Infinity;
    for (let i = 0; i < sim.count; i++) {
      const dx = sim.x[i] - cam.tx;
      const dy = sim.y[i] - cam.ty;
      const dz = sim.z[i] - cam.tz;
      const x1 = dx * cy - dz * sy;
      const z1 = dx * sy + dz * cy;
      const y2 = dy * cp - z1 * sp;
      const z2 = dy * sp + z1 * cp;
      const depth = cam.dist + z2;
      const s = depth > NEAR_PLANE ? focal / depth : 0;
      proj.px[i] = width / 2 + x1 * s;
      proj.py[i] = height / 2 + y2 * s;
      proj.ps[i] = s;
      proj.pd[i] = depth;
      if (s > 0) {
        near = Math.min(near, depth);
        far = Math.max(far, depth);
      }
    }
    proj.near = Number.isFinite(near) ? near : 0;
    proj.far = Number.isFinite(far) && far > proj.near ? far : proj.near + 1;
  }, []);

  /** Camera-plane delta (screen pixels at a given scale) → world delta. */
  const screenDeltaToWorld = useCallback((dxPx: number, dyPx: number, scale: number) => {
    const cam = cameraRef.current;
    const qx = dxPx / scale;
    const qy = dyPx / scale;
    // Undo pitch (about x), then yaw (about y); the camera-plane z is 0.
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const y1 = qy * cp;
    const z1 = -qy * sp;
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    return { x: qx * cy + z1 * sy, y: y1, z: -qx * sy + z1 * cy };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const palette = paletteRef.current ?? readPalette(canvas);
    paletteRef.current = palette;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    project(width, height);
    const { px, py, ps, pd, near, far } = projRef.current;
    const three = sim.dims === 3;
    // Fog: 0 at the nearest node, 1 at the farthest. Flat layouts have none.
    const fog = (i: number) => (three ? Math.min(1, Math.max(0, (pd[i] - near) / (far - near))) : 0);
    const depthAlpha = (i: number) => 1 - 0.62 * fog(i);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const focus = hoverRef.current ?? stickyRef.current;
    const neighborhood = focus ? adjacency.get(focus) : null;
    const inFocus = (id: string) => (!focus ? true : id === focus || (neighborhood?.has(id) ?? false));
    const matches = queryMatches;
    const emphasized = (id: string) => (matches ? matches.has(id) : inFocus(id));
    const zoomish = three ? Math.min(2.5, ps.reduce((m, v) => (v > m ? v : m), 0)) : viewRef.current.k;

    // Edges under nodes; dimmed pass first so spotlights stay crisp.
    const edgeWidth = Math.min(2, Math.max(0.4, Math.sqrt(three ? 1 : viewRef.current.k)));
    for (const dimPass of [true, false]) {
      for (const e of visible.edges) {
        const a = sim.indexOf.get(e.source);
        const b = sim.indexOf.get(e.target);
        if (a === undefined || b === undefined) continue;
        if (ps[a] === 0 || ps[b] === 0) continue; // behind the camera
        const lit = matches
          ? matches.has(e.source) && matches.has(e.target)
          : !focus || ((e.source === focus || e.target === focus) && inFocus(e.source) && inFocus(e.target));
        if (lit === dimPass) continue;
        const baseAlpha = e.type === "link" ? 0.45 : e.type === "tag" ? 0.22 : 0.3;
        const depth = three ? (depthAlpha(a) + depthAlpha(b)) / 2 : 1;
        ctx.globalAlpha = (lit ? (focus || matches ? Math.min(1, baseAlpha + 0.3) : baseAlpha) : DIM_ALPHA * 0.6) * depth;
        ctx.strokeStyle = e.type === "tag" ? palette.tag : lit && focus ? palette[nodeById.get(focus)?.kind ?? "knowledge"] : palette.edge;
        ctx.lineWidth = (e.type === "link" ? edgeWidth : edgeWidth * 0.8) * (lit && focus ? 1.4 : 1);
        ctx.setLineDash(e.type === "mention" ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(px[a], py[a]);
        ctx.lineTo(px[b], py[b]);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Nodes, far to near so closer spheres overlap farther ones.
    const order: number[] = [];
    for (const n of visible.nodes) {
      const i = sim.indexOf.get(n.id);
      if (i !== undefined && ps[i] > 0) order.push(i);
    }
    if (three) order.sort((a, b) => pd[b] - pd[a]);
    for (const i of order) {
      const n = nodeById.get(sim.ids[i]);
      if (!n) continue;
      const lit = emphasized(n.id);
      const r = Math.max(1.5, nodeRadius(n, visible.degree.get(n.id) ?? 0) * ps[i]);
      const sx = px[i];
      const sy = py[i];
      if (sx < -r - 40 || sy < -r - 40 || sx > width + r + 40 || sy > height + r + 40) continue;
      const depth = depthAlpha(i);
      const isFocus = n.id === focus || n.id === stickyRef.current;
      ctx.globalAlpha = (lit ? 1 : DIM_ALPHA) * depth;
      if (isFocus) {
        ctx.shadowColor = palette[n.kind];
        ctx.shadowBlur = 18;
      }
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (n.kind === "tag") {
        ctx.strokeStyle = palette.tag;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        ctx.fillStyle = palette[n.kind];
        ctx.fill();
        // A soft specular dot gives each node a little volume in 3D.
        if (three && r > 3 && lit) {
          ctx.globalAlpha = 0.28 * depth;
          ctx.fillStyle = palette.labelStrong;
          ctx.beginPath();
          ctx.arc(sx - r * 0.32, sy - r * 0.32, r * 0.32, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
      if (isFocus) {
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = palette[n.kind];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Labels on a budget: a dense constellation with every title drawn is
    // unreadable. Overview labels the best-connected hubs and anything the
    // camera has come close to; a selection labels itself and its strongest
    // relations; dimmed nodes are never labelled. Hover and search hits always
    // show.
    const k = zoomish;
    const baseLabelAlpha = k >= 1.3 ? 1 : k >= 0.85 ? (k - 0.85) / 0.45 : 0;
    const selectedId = stickyRef.current;
    const labelled = new Set<string>();
    if (selectedId) {
      labelled.add(selectedId);
      const ranked = [...(adjacency.get(selectedId) ?? [])].sort(
        (a, b) => (visible.degree.get(b) ?? 0) - (visible.degree.get(a) ?? 0),
      );
      for (const id of ranked.slice(0, LABEL_NEIGHBOURS)) labelled.add(id);
    } else {
      for (const n of keyboardNodesRef.current.slice(0, LABEL_HUBS)) labelled.add(n.id);
    }
    if (hoverRef.current) labelled.add(hoverRef.current);
    ctx.font = `11px ${getComputedStyle(canvas).fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const i of order) {
      const n = nodeById.get(sim.ids[i]);
      if (!n) continue;
      if (!emphasized(n.id)) continue;
      const forced = labelled.has(n.id) || (matches?.has(n.id) ?? false);
      const scale = three ? ps[i] : k;
      // Unbudgeted nodes still earn a label once the camera is close.
      const closeAlpha = three ? (scale - 1.6) / 0.6 : baseLabelAlpha;
      let alpha = forced ? 1 : Math.max(0, Math.min(1, closeAlpha));
      if (selectedId && !forced) alpha = Math.min(alpha, 0.55);
      alpha *= depthAlpha(i);
      if (alpha <= 0.02) continue;
      const r = Math.max(1.5, nodeRadius(n, visible.degree.get(n.id) ?? 0) * ps[i]);
      const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
      const sx = px[i];
      const sy = py[i] + r + 3;
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = palette.halo;
      ctx.lineWidth = 3;
      ctx.strokeText(label, sx, sy);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = forced ? palette.labelStrong : palette.label;
      ctx.fillText(label, sx, sy);
    }
    ctx.globalAlpha = 1;
  }, [adjacency, nodeById, project, queryMatches, visible]);

  /** Advance a camera flight; true while one is in progress. */
  const stepFlight = useCallback((now: number) => {
    const flight = flightRef.current;
    if (!flight) return false;
    const t = Math.min(1, (now - flight.t0) / FLIGHT_MS);
    const e = easeInOutCubic(t);
    const lerp = (a: number, b: number) => a + (b - a) * e;
    if (dimsRef.current === 3) {
      cameraRef.current = {
        yaw: lerp(flight.from.yaw, flight.to.yaw),
        pitch: lerp(flight.from.pitch, flight.to.pitch),
        dist: lerp(flight.from.dist, flight.to.dist),
        tx: lerp(flight.from.tx, flight.to.tx),
        ty: lerp(flight.from.ty, flight.to.ty),
        tz: lerp(flight.from.tz, flight.to.tz),
      };
      savedCamera = { ...cameraRef.current };
    } else {
      viewRef.current.panX = lerp(flight.from2d.panX, flight.to2d.panX);
      viewRef.current.panY = lerp(flight.from2d.panY, flight.to2d.panY);
      savedView = { ...viewRef.current };
    }
    if (t >= 1) flightRef.current = null;
    return t < 1;
  }, []);

  /** Idle drift in 3D; true while drifting. */
  const stepDrift = useCallback((now: number, dt: number) => {
    if (dimsRef.current !== 3 || !driftRef.current || reducedMotionRef.current) return false;
    if (dragRef.current || hoverRef.current || stickyRef.current || flightRef.current) return false;
    if (now - lastInputRef.current < IDLE_MS) return true; // keep the loop alive to resume
    cameraRef.current.yaw += DRIFT_RATE * Math.min(dt, 64);
    savedCamera = { ...cameraRef.current };
    return true;
  }, []);

  const lastFrameRef = useRef(0);
  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    const frame = (now: number) => {
      frameRef.current = null;
      const sim = simRef.current;
      if (!sim) return;
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 16;
      lastFrameRef.current = now;
      let more = false;
      if (!reducedMotionRef.current && sim.alpha > ALPHA_MIN) {
        tickForceSim(sim, paramsRef.current);
        more = true;
      }
      if (stepFlight(now)) more = true;
      // The page may be hidden (rAF pauses) — drift only resumes with frames.
      if (stepDrift(now, dt)) more = true;
      draw();
      if (more) {
        frameRef.current = requestAnimationFrame(frame);
      } else {
        lastFrameRef.current = 0;
      }
    };
    frameRef.current = requestAnimationFrame(frame);
  }, [draw, stepDrift, stepFlight]);

  const noteInput = useCallback(() => {
    lastInputRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
  }, []);

  /** Fit the whole layout in the viewport with padding. */
  const fitView = useCallback(() => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas || sim.count === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    flightRef.current = null;
    if (sim.dims === 3) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < sim.count; i++) {
        cx += sim.x[i];
        cy += sim.y[i];
        cz += sim.z[i];
      }
      cx /= sim.count;
      cy /= sim.count;
      cz /= sim.count;
      // Fit the 90th-percentile radius so a few far stragglers don't shrink
      // the whole constellation to a speck.
      const radii: number[] = [];
      for (let i = 0; i < sim.count; i++) {
        radii.push(Math.hypot(sim.x[i] - cx, sim.y[i] - cy, sim.z[i] - cz));
      }
      radii.sort((a, b) => a - b);
      const radius = Math.max(60, radii[Math.floor(radii.length * 0.9)] ?? 60);
      const focal = Math.min(width, height) * FOCAL_SHARE;
      const dist = radius + (radius * focal) / (Math.min(width, height) * 0.44);
      cameraRef.current = { ...cameraRef.current, tx: cx, ty: cy, tz: cz, dist };
      savedCamera = { ...cameraRef.current };
      scheduleFrame();
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < sim.count; i++) {
      minX = Math.min(minX, sim.x[i]);
      maxX = Math.max(maxX, sim.x[i]);
      minY = Math.min(minY, sim.y[i]);
      maxY = Math.max(maxY, sim.y[i]);
    }
    const spanX = Math.max(60, maxX - minX);
    const spanY = Math.max(60, maxY - minY);
    const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((width * 0.82) / spanX, (height * 0.82) / spanY)));
    viewRef.current = {
      k,
      panX: -((minX + maxX) / 2) * k,
      panY: -((minY + maxY) / 2) * k,
    };
    savedView = { ...viewRef.current };
    scheduleFrame();
  }, [scheduleFrame]);

  /** Bring a node to the viewport centre — a short camera flight, or a jump
   *  under reduced motion. Used by selection, traversal, and keyboard focus. */
  const centerOnNode = useCallback((id: string) => {
    const sim = simRef.current;
    if (!sim) return;
    const i = sim.indexOf.get(id);
    if (i === undefined) return;
    const view = viewRef.current;
    const to2d = { panX: -sim.x[i] * view.k, panY: -sim.y[i] * view.k };
    const from = { ...cameraRef.current };
    // Close in on the node, but never past a comfortable reading distance.
    const to: Camera = { ...from, tx: sim.x[i], ty: sim.y[i], tz: sim.z[i], dist: Math.min(from.dist, Math.max(220, from.dist * 0.7)) };
    if (reducedMotionRef.current) {
      if (sim.dims === 3) {
        cameraRef.current = to;
        savedCamera = { ...to };
      } else {
        view.panX = to2d.panX;
        view.panY = to2d.panY;
        savedView = { ...view };
      }
      scheduleFrame();
      return;
    }
    flightRef.current = {
      from,
      to,
      from2d: { panX: view.panX, panY: view.panY },
      to2d,
      t0: performance.now(),
    };
    scheduleFrame();
  }, [scheduleFrame]);

  /** Select a node: spotlight it, fly to it, and extend the trail. */
  const selectNode = useCallback(
    (id: string | null, { record = true }: { record?: boolean } = {}) => {
      setStickyId(id);
      if (id) {
        if (record) {
          setTrail((prev) => (prev[prev.length - 1] === id ? prev : [...prev.filter((p) => p !== id), id].slice(-TRAIL_LIMIT)));
        }
        centerOnNode(id);
      } else {
        scheduleFrame();
      }
    },
    [centerOnNode, scheduleFrame],
  );

  const openNode = useCallback(
    (node: DocGraphNode | undefined) => {
      if (!node) return;
      if (node.ref) {
        announcer.announce(`Opening ${node.title}`, "polite");
        onOpen(node.ref);
      }
    },
    [announcer, onOpen],
  );

  const goBack = useCallback(() => {
    if (trail.length < 2) return;
    const next = trail.slice(0, -1);
    const target = next[next.length - 1];
    setTrail(next);
    setStickyId(target);
    centerOnNode(target);
  }, [centerOnNode, trail]);

  // (Re)build the sim whenever the visible graph or projection changes;
  // carried-over nodes keep their positions, new ones join on the seed spiral.
  useEffect(() => {
    snapshotPositions();
    const dims = prefs.dims;
    let seedIndex = 0;
    const simNodes = visible.nodes.map((n) => {
      const cached = positionCache.get(`${dims}:${n.id}`);
      const offset = seedIndex++ + visible.nodes.length;
      const seed = cached ?? (dims === 3 ? sphereSeed(offset) : { ...spiralSeed(offset), z: 0 });
      return { id: n.id, radius: nodeRadius(n, visible.degree.get(n.id) ?? 0), x: seed.x, y: seed.y, z: seed.z };
    });
    const simLinks = visible.edges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: EDGE_STRENGTH[e.type],
      distanceScale: EDGE_DISTANCE_SCALE[e.type],
    }));
    const sim = createForceSim(simNodes, simLinks, { dims });
    simRef.current = sim;
    if (reducedMotionRef.current) {
      settleForceSim(sim, paramsRef.current);
    } else {
      reheatForceSim(sim, 0.8);
    }
    if (needsFitRef.current && sim.count > 0) {
      needsFitRef.current = false;
      // Fit against a settled-ish layout so the first frame is meaningful. The
      // repulsion pass is O(n²), so a big corpus pre-settles fewer ticks.
      const ticks = Math.max(30, Math.min(120, Math.round((120 * 400) / Math.max(1, sim.count))));
      if (!reducedMotionRef.current) settleForceSim(sim, paramsRef.current, ticks);
      fitView();
      if (!reducedMotionRef.current) reheatForceSim(sim, 0.3);
    }
    scheduleFrame();
    return () => {
      snapshotPositions();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [visible, prefs.dims, fitView, scheduleFrame, snapshotPositions]);

  // Force sliders steer the live sim.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (reducedMotionRef.current) {
      settleForceSim(sim, paramsRef.current);
    } else {
      reheatForceSim(sim, 0.5);
    }
    scheduleFrame();
  }, [prefs.repel, prefs.linkDistance, scheduleFrame]);

  // Turning drift back on restarts the loop.
  useEffect(() => {
    if (prefs.drift) scheduleFrame();
  }, [prefs.drift, scheduleFrame]);

  // Canvas sizing (DPR-aware) + theme-change palette refresh.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      scheduleFrame();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    const mo = new MutationObserver(() => {
      paletteRef.current = null;
      scheduleFrame();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [scheduleFrame]);

  // ── Pointer interactions ────────────────────────────────────────────────────

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { panX, panY, k } = viewRef.current;
    return {
      x: (clientX - rect.left - rect.width / 2 - panX) / k,
      y: (clientY - rect.top - rect.height / 2 - panY) / k,
    };
  }, []);

  /** The front-most node under the pointer, by its projected disc. */
  const hitTest = useCallback(
    (clientX: number, clientY: number): number => {
      const sim = simRef.current;
      const canvas = canvasRef.current;
      if (!sim || !canvas) return -1;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      const { px, py, ps, pd } = projRef.current;
      if (px.length !== sim.count) return -1;
      let best = -1;
      let bestDepth = Infinity;
      let bestD = Infinity;
      for (let i = 0; i < sim.count; i++) {
        if (ps[i] === 0) continue;
        const node = nodeById.get(sim.ids[i]);
        const r = (node ? nodeRadius(node, visible.degree.get(node.id) ?? 0) : 5) * ps[i];
        const d = Math.hypot(px[i] - mx, py[i] - my);
        if (d > Math.max(r, 2) + 6) continue;
        if (pd[i] < bestDepth - 0.5 || (Math.abs(pd[i] - bestDepth) <= 0.5 && d < bestD)) {
          best = i;
          bestDepth = pd[i];
          bestD = d;
        }
      }
      return best;
    },
    [nodeById, visible.degree],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      noteInput();
      flightRef.current = null;
      canvas.setPointerCapture(e.pointerId);
      const nodeIndex = hitTest(e.clientX, e.clientY);
      const panGesture = dimsRef.current === 2 || e.shiftKey || e.button === 2 || e.button === 1;
      dragRef.current = {
        pointerId: e.pointerId,
        mode: nodeIndex >= 0 ? "node" : panGesture ? "pan" : "orbit",
        nodeIndex,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
    },
    [hitTest, noteInput],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      const drag = dragRef.current;
      if (drag && sim && drag.pointerId === e.pointerId) {
        noteInput();
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
          if (drag.mode === "node" && !reducedMotionRef.current) reheatForceSim(sim, 0.3);
        }
        const dx = e.clientX - drag.lastX;
        const dy = e.clientY - drag.lastY;
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        if (!drag.moved) return;
        if (drag.mode === "node") {
          if (sim.dims === 3) {
            const scale = projRef.current.ps[drag.nodeIndex] || 1;
            const w = screenDeltaToWorld(dx, dy, scale);
            const i = drag.nodeIndex;
            pinForceSimNode(sim, drag.nodeIndex, sim.x[i] + w.x, sim.y[i] + w.y, sim.z[i] + w.z);
          } else {
            const { x, y } = toWorld(e.clientX, e.clientY);
            pinForceSimNode(sim, drag.nodeIndex, x, y);
          }
          if (reducedMotionRef.current) settleForceSim(sim, paramsRef.current, 30);
        } else if (drag.mode === "orbit") {
          const cam = cameraRef.current;
          cam.yaw += dx * 0.006;
          cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch + dy * 0.006));
          savedCamera = { ...cam };
        } else if (sim.dims === 3) {
          const canvas = canvasRef.current;
          const short = canvas ? Math.min(canvas.clientWidth, canvas.clientHeight) : 600;
          const scale = (short * FOCAL_SHARE) / cameraRef.current.dist;
          const w = screenDeltaToWorld(dx, dy, scale);
          const cam = cameraRef.current;
          cam.tx -= w.x;
          cam.ty -= w.y;
          cam.tz -= w.z;
          savedCamera = { ...cam };
        } else {
          viewRef.current.panX += dx;
          viewRef.current.panY += dy;
          savedView = { ...viewRef.current };
        }
        scheduleFrame();
        return;
      }
      // Hover spotlight.
      const idx = hitTest(e.clientX, e.clientY);
      const id = idx >= 0 ? (simRef.current?.ids[idx] ?? null) : null;
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        const canvas = canvasRef.current;
        if (canvas) canvas.style.cursor = id ? "pointer" : "grab";
        scheduleFrame();
      }
    },
    [hitTest, noteInput, scheduleFrame, screenDeltaToWorld, toWorld],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || !sim) return;
      if (drag.mode === "node" && drag.moved) {
        unpinForceSimNode(sim, drag.nodeIndex);
        if (!reducedMotionRef.current) reheatForceSim(sim, 0.2);
        scheduleFrame();
        return;
      }
      if (drag.moved) {
        scheduleFrame();
        return; // orbit / pan
      }
      // Click: select a node (fly to it + focus panel), or clear on background.
      const idx = hitTest(e.clientX, e.clientY);
      if (idx < 0) {
        setStickyId(null);
        scheduleFrame();
        return;
      }
      const node = nodeById.get(sim.ids[idx]);
      if (!node) return;
      setStickyId((prev) => (prev === node.id ? null : node.id));
      if (stickyRef.current !== node.id) selectNode(node.id);
    },
    [hitTest, nodeById, scheduleFrame, selectNode],
  );

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      noteInput();
      if (dimsRef.current === 3) {
        // Dolly toward the target; the camera never passes through it.
        const cam = cameraRef.current;
        cam.dist = Math.max(NEAR_PLANE * 6, Math.min(20000, cam.dist / factor));
        savedCamera = { ...cam };
        scheduleFrame();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
      const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;
      const view = viewRef.current;
      const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.k * factor));
      const scale = k / view.k;
      // Keep the world point under the cursor stationary.
      view.panX = px - rect.width / 2 - (px - rect.width / 2 - view.panX) * scale;
      view.panY = py - rect.height / 2 - (py - rect.height / 2 - view.panY) * scale;
      view.k = k;
      savedView = { ...view };
      scheduleFrame();
    },
    [noteInput, scheduleFrame],
  );

  // Wheel must be non-passive to preventDefault (page scroll).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.0016), e.clientX, e.clientY);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  const stepNeighbor = useCallback(
    (delta: 1 | -1) => {
      if (!stickyId || relations.length === 0) return;
      const ids = relations.map((r) => r.node.id);
      const cursor = hoverRef.current && ids.includes(hoverRef.current) ? ids.indexOf(hoverRef.current) : -1;
      const next = ids[(cursor + delta + ids.length) % ids.length];
      hoverRef.current = next;
      const node = nodeById.get(next);
      if (node) announcer.announce(`${node.title}, ${NODE_KIND_LABEL[node.kind]}. Press Enter to fly there.`, "polite");
      scheduleFrame();
    },
    [announcer, nodeById, relations, scheduleFrame, stickyId],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
      noteInput();
      // Tab / Shift+Tab cycle the keyboard node list (hubs first): select,
      // centre, and announce each. At either end the cursor is released (no
      // preventDefault) so Tab still leaves the graph — no focus trap.
      if (e.key === "Tab") {
        const list = keyboardNodesRef.current;
        if (list.length === 0) return;
        const next = e.shiftKey ? kbdIdxRef.current - 1 : kbdIdxRef.current + 1;
        if (next < 0 || next >= list.length) {
          kbdIdxRef.current = -1;
          if (stickyRef.current) { setStickyId(null); scheduleFrame(); }
          return; // release focus out of the canvas
        }
        kbdIdxRef.current = next;
        const node = list[next];
        setStickyId(node.id);
        centerOnNode(node.id);
        announcer.announce(
          `${node.title}, ${next + 1} of ${list.length}${node.ref ? ", press Enter to open" : ""}`,
          "polite",
        );
        e.preventDefault();
        return;
      }
      // ] / [ step through the selected node's relations; Enter on a stepped
      // relation flies there, otherwise Enter opens the selection.
      if (e.key === "]" || e.key === "[") {
        stepNeighbor(e.key === "]" ? 1 : -1);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        const hovered = hoverRef.current;
        if (hovered && stickyRef.current && hovered !== stickyRef.current) {
          selectNode(hovered);
          hoverRef.current = null;
        } else if (kbdIdxRef.current >= 0) {
          openNode(keyboardNodesRef.current[kbdIdxRef.current]);
        } else if (stickyRef.current) {
          openNode(nodeById.get(stickyRef.current));
        } else {
          return;
        }
        e.preventDefault();
        return;
      }
      if (e.key === "Backspace") {
        goBack();
        e.preventDefault();
        return;
      }
      const three = dimsRef.current === 3;
      const pan = (dx: number, dy: number) => {
        if (three) {
          const cam = cameraRef.current;
          cam.yaw -= dx * 0.004;
          cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch - dy * 0.004));
          savedCamera = { ...cam };
        } else {
          viewRef.current.panX += dx;
          viewRef.current.panY += dy;
          savedView = { ...viewRef.current };
        }
        scheduleFrame();
      };
      if (e.key === "ArrowLeft") pan(60, 0);
      else if (e.key === "ArrowRight") pan(-60, 0);
      else if (e.key === "ArrowUp") pan(0, 60);
      else if (e.key === "ArrowDown") pan(0, -60);
      else if (e.key === "+" || e.key === "=") zoomBy(1.25);
      else if (e.key === "-" || e.key === "_") zoomBy(0.8);
      else if (e.key === "0") fitView();
      else if (e.key === "Escape" && (stickyRef.current || hoverRef.current || kbdIdxRef.current >= 0)) {
        hoverRef.current = null;
        kbdIdxRef.current = -1;
        setStickyId(null);
        scheduleFrame();
      } else return;
      e.preventDefault();
    },
    [announcer, centerOnNode, fitView, goBack, nodeById, noteInput, openNode, scheduleFrame, selectNode, stepNeighbor, zoomBy],
  );

  // How many of the scope's memory files were actually READ. The scan cap is
  // applied coven-wide BEFORE familiar scoping, so a scoped view is not "this
  // familiar's memory graph" — it is their slice of the coven's most recent N
  // files. `meta.memory.scanned` is coven-wide and cannot answer this, so the
  // count comes off the nodes themselves (cave-ed4s3).
  //
  // `scanned` is load-bearing, not defensive: the resolution index spans the
  // WHOLE corpus while the scan is capped, so a [[link]] into an out-of-window
  // memory file still resolves and lands as a leaf node with no body. Counting
  // raw memory nodes would mix files that were read with files merely pointed
  // at and overcount the window — the exact class of false claim this notice
  // exists to stop making.
  //
  // This MUST stay above the empty-state early return below. It lived under it
  // and only ran when the graph had nodes, so an empty graph rendered one hook
  // fewer and React threw "Rendered more hooks than during the previous render"
  // the moment the graph filled or emptied — which a scope change does routinely
  // (cave-qxq4l). Nothing in CI catches this: eslint.config.mjs is a
  // design-system-only gate that stubs react-hooks to a no-op, so
  // rules-of-hooks never runs.
  const scopedMemoryInWindow = useMemo(
    () =>
      scopeLabel
        ? graph.nodes.reduce((n, node) => n + (node.kind === "memory" && node.scanned ? 1 : 0), 0)
        : 0,
    [graph, scopeLabel],
  );

  // ── Empty state — only when there is genuinely nothing to draw ─────────────
  if (graph.nodes.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:graph"
          headline={
            scanning ? "Weaving the graph…" : scopeLabel ? `No relations for ${scopeLabel}` : "Nothing to graph yet"
          }
          subtitle={
            scanning
              ? "Scanning your knowledge, memory, and journal for connections."
              : scopeLabel
                ? "Nothing in this scope has anything to weave together. Widen the familiar selection to see the whole coven's relations."
                : "Create a knowledge entry, memory file, or journal day and it appears here — [[wiki-links]], tags, and mentions weave them together."
          }
        />
      </div>
    );
  }

  const summary = `${visible.nodes.length} of ${graph.nodes.length} nodes, ${visible.edges.length} connections shown`;
  const memoryTruncated = meta ? meta.memory.scanned < meta.memory.total : false;
  // Only worth saying when the scope actually lost files to the cap. Equal
  // counts mean the window covered them all, and a shortfall notice would be
  // noise; `>` cannot happen, but treating it as "nothing to report" keeps the
  // copy from ever rendering a negative remainder.
  const scopedShortfall =
    scopeLabel != null &&
    typeof scopedMemoryTotal === "number" &&
    scopedMemoryInWindow < scopedMemoryTotal;
  const three = prefs.dims === 3;
  const selected = stickyId ? nodeById.get(stickyId) ?? null : null;
  const selectedOwner = selected?.owner ? ownerLabel?.(selected.owner) ?? selected.owner : null;
  const hubs = keyboardNodes.slice(0, 6);
  const trailNodes = trail.map((id) => nodeById.get(id)).filter((n): n is DocGraphNode => Boolean(n));

  const checkboxRow = (
    label: string,
    checked: boolean,
    onChange: (next: boolean) => void,
    dotToken?: string,
    count?: number,
    help?: string,
  ) => (
    <label
      title={help}
      className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]"
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring h-3 w-3 accent-[var(--accent-presence)]"
      />
      {dotToken ? (
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${dotToken})` }} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{count}</span> : null}
    </label>
  );

  const nodeButton = (node: DocGraphNode, onClick: () => void, extra?: string) => (
    <button
      key={`${node.id}${extra ?? ""}`}
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        hoverRef.current = node.id;
        scheduleFrame();
      }}
      onMouseLeave={() => {
        hoverRef.current = null;
        scheduleFrame();
      }}
      className="focus-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-[length:var(--text-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(${NODE_KIND_TOKEN[node.kind]})` }} />
      <span className="min-w-0 flex-1 truncate">{node.title}</span>
      <span className="shrink-0 text-[length:var(--text-2xs)] text-[var(--text-muted)]">{visible.degree.get(node.id) ?? 0}</span>
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="grimoire-graph relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_center,var(--bg-raised)_0%,var(--bg-base)_72%)]"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Document graph: ${summary}. Tab and Shift+Tab step through the most-connected documents, Enter opens the focused one; ${three ? "arrow keys orbit" : "arrow keys pan"}, plus and minus zoom, 0 fits the view; with a document selected, ] and [ step through its relations and Backspace goes back.`}
        tabIndex={0}
        className="focus-ring absolute inset-0 h-full w-full cursor-grab touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onPointerLeave={() => {
          if (hoverRef.current) {
            hoverRef.current = null;
            scheduleFrame();
          }
        }}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const sim = simRef.current;
          const idx = hitTest(e.clientX, e.clientY);
          if (sim && idx >= 0) openNode(nodeById.get(sim.ids[idx]));
          else fitView();
        }}
      />

      {/* Search + filter / forces card (Obsidian's graph settings). */}
      <section
        aria-label="Graph filters"
        className="absolute left-2 top-2 w-60 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 shadow-sm backdrop-blur"
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <Icon name="ph:magnifying-glass" width={12} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              } else if (e.key === "Enter" && queryMatches && queryMatches.size > 0) {
                // Fly to the best-connected match.
                const best = [...queryMatches].sort(
                  (a, b) => (visible.degree.get(b) ?? 0) - (visible.degree.get(a) ?? 0),
                )[0];
                selectNode(best);
              }
            }}
            placeholder="Find a node…"
            aria-label="Highlight graph nodes"
            className="focus-ring min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-[length:var(--text-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <button
            type="button"
            aria-expanded={prefs.panelOpen}
            aria-label={prefs.panelOpen ? "Collapse graph filters" : "Expand graph filters"}
            title="Filters and forces"
            onClick={() => setPrefs((p) => ({ ...p, panelOpen: !p.panelOpen }))}
            className="focus-ring inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:sliders-horizontal" width={12} aria-hidden />
          </button>
        </div>
        {queryMatches ? (
          <p className="border-t border-[var(--border-hairline)] px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-muted)]">
            {queryMatches.size === 0 ? "No matching nodes" : `${queryMatches.size} match${queryMatches.size === 1 ? "" : "es"} · Enter to fly to the best connected`}
          </p>
        ) : null}
        {prefs.panelOpen ? (
          <div className="max-h-[60vh] space-y-2.5 overflow-y-auto border-t border-[var(--border-hairline)] px-2.5 py-2">
            <div>
              <p className="pb-0.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Groups
              </p>
              {checkboxRow(
                "Knowledge",
                prefs.groups.knowledge,
                (v) => setPrefs((p) => ({ ...p, groups: { ...p.groups, knowledge: v } })),
                NODE_KIND_TOKEN.knowledge,
                counts.knowledge,
                "Curated reference entries from the knowledge vault",
              )}
              {checkboxRow(
                "Memory",
                prefs.groups.memory,
                (v) => setPrefs((p) => ({ ...p, groups: { ...p.groups, memory: v } })),
                NODE_KIND_TOKEN.memory,
                counts.memory,
                "Files your familiars and runtimes write as they work",
              )}
              {checkboxRow(
                "Journal",
                prefs.groups.journal,
                (v) => setPrefs((p) => ({ ...p, groups: { ...p.groups, journal: v } })),
                NODE_KIND_TOKEN.journal,
                counts.journal,
                "Daily reflections, one per familiar per day",
              )}
              {checkboxRow(
                "Tags",
                prefs.groups.tag,
                (v) => setPrefs((p) => ({ ...p, groups: { ...p.groups, tag: v } })),
                NODE_KIND_TOKEN.tag,
                counts.tag,
                "Each tag is its own node, connected to the docs that carry it",
              )}
            </div>
            <div>
              <p className="pb-0.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Connections
              </p>
              {checkboxRow(
                "Links",
                prefs.edgeTypes.link,
                (v) => setPrefs((p) => ({ ...p, edgeTypes: { ...p.edgeTypes, link: v } })),
                undefined,
                undefined,
                "Solid lines — explicit [[wiki-links]] written in a doc",
              )}
              {checkboxRow(
                "Mentions",
                prefs.edgeTypes.mention,
                (v) => setPrefs((p) => ({ ...p, edgeTypes: { ...p.edgeTypes, mention: v } })),
                undefined,
                undefined,
                "Dashed lines — one doc's text mentions another's title, without a link",
              )}
              {checkboxRow(
                "Tag links",
                prefs.edgeTypes.tag,
                (v) => setPrefs((p) => ({ ...p, edgeTypes: { ...p.edgeTypes, tag: v } })),
                undefined,
                undefined,
                "Faint lines — a doc connected to a tag it carries",
              )}
              {checkboxRow(
                "Orphans",
                prefs.orphans,
                (v) => setPrefs((p) => ({ ...p, orphans: v })),
                undefined,
                undefined,
                "Docs with no connections at all — hide them to see only the web",
              )}
            </div>
            <div>
              <p className="pb-0.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Forces
              </p>
              <label className="block py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                Repel
                <input
                  type="range"
                  min={0.25}
                  max={3}
                  step={0.05}
                  value={prefs.repel}
                  onChange={(e) => setPrefs((p) => ({ ...p, repel: Number(e.target.value) }))}
                  aria-label="Repel force"
                  className="focus-ring mt-0.5 w-full accent-[var(--accent-presence)]"
                />
              </label>
              <label className="block py-0.5 text-[length:var(--text-xs)] text-[var(--text-secondary)]">
                Link distance
                <input
                  type="range"
                  min={40}
                  max={240}
                  step={5}
                  value={prefs.linkDistance}
                  onChange={(e) => setPrefs((p) => ({ ...p, linkDistance: Number(e.target.value) }))}
                  aria-label="Link distance"
                  className="focus-ring mt-0.5 w-full accent-[var(--accent-presence)]"
                />
              </label>
            </div>
            {scopeLabel ? (
              <p className="text-[length:var(--text-sm)] leading-snug text-[var(--text-muted)]">
                Memory and journal days are scoped to {scopeLabel}. Stitches stay coven-wide.
              </p>
            ) : null}
            {memoryTruncated && meta ? (
              <p className="text-[length:var(--text-sm)] leading-snug text-[var(--text-muted)]">
                {scopedShortfall ? (
                  <>
                    {scopedMemoryInWindow} of {scopeLabel}&rsquo;s {scopedMemoryTotal} memory files are in
                    the scanned window — the {meta.memory.scanned} most recent of {meta.memory.total}{" "}
                    across the coven.
                  </>
                ) : (
                  <>
                    Scanned the {meta.memory.scanned} most recent of {meta.memory.total} memory files
                    {scopeLabel ? " across the coven" : ""}.
                  </>
                )}
              </p>
            ) : null}
            {scanError ? (
              <p className="text-[length:var(--text-sm)] leading-snug text-[var(--color-warning)]">
                Full scan unavailable — showing knowledge-vault connections only.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Focus panel: the selected node and its relations, one click to fly on. */}
      <section
        aria-label={selected ? `Selected: ${selected.title}` : "Explore the graph"}
        className="absolute right-2 top-2 flex max-h-[calc(100%-11rem)] w-72 flex-col overflow-hidden rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 shadow-sm backdrop-blur"
      >
        {selected ? (
          <>
            <div className="border-b border-[var(--border-hairline)] px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(${NODE_KIND_TOKEN[selected.kind]})` }} />
                {NODE_KIND_LABEL[selected.kind]}
                {selectedOwner ? <span className="normal-case tracking-normal">· {selectedOwner}</span> : null}
                <button
                  type="button"
                  aria-label="Clear selection"
                  title="Clear selection (Esc)"
                  onClick={() => selectNode(null)}
                  className="focus-ring ml-auto inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon name="ph:x" width={11} aria-hidden />
                </button>
              </div>
              <h3 className="mt-1 text-[length:var(--text-base)] font-medium leading-snug text-[var(--text-primary)]">{selected.title}</h3>
              <p className="mt-0.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {relations.length} connection{relations.length === 1 ? "" : "s"}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                {selected.ref ? (
                  <button
                    type="button"
                    onClick={() => openNode(selected)}
                    className="focus-ring inline-flex items-center gap-1 rounded-md bg-[var(--accent-presence)] px-2.5 py-1 text-[length:var(--text-xs)] font-medium text-[var(--accent-presence-foreground)]"
                  >
                    <Icon name="ph:arrow-square-out" width={12} aria-hidden />
                    Open
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={goBack}
                  disabled={trailNodes.length < 2}
                  title="Back (Backspace)"
                  className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[length:var(--text-xs)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  <Icon name="ph:arrow-left" width={12} aria-hidden />
                  Back
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
              {RELATION_GROUPS.map((group) => {
                const rows = relations.filter(group.match);
                if (rows.length === 0) return null;
                return (
                  <div key={group.key} className="pb-1.5">
                    <p className="flex items-center gap-1 px-2 pb-0.5 pt-1 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      <Icon name={group.icon} width={10} aria-hidden />
                      {group.label}
                      <span className="ml-auto font-normal">{rows.length}</span>
                    </p>
                    {rows.slice(0, 40).map((r) => nodeButton(r.node, () => selectNode(r.node.id), `:${group.key}`))}
                    {rows.length > 40 ? (
                      <p className="px-2 text-[length:var(--text-xs)] text-[var(--text-muted)]">and {rows.length - 40} more</p>
                    ) : null}
                  </div>
                );
              })}
              {relations.length === 0 ? (
                <p className="px-2 py-1 text-[length:var(--text-sm)] text-[var(--text-muted)]">
                  No visible connections. Turn on Orphans or another connection type to see more.
                </p>
              ) : null}
            </div>
            {trailNodes.length > 1 ? (
              <nav aria-label="Traversal trail" className="flex flex-wrap items-center gap-1 border-t border-[var(--border-hairline)] px-2.5 py-1.5 text-[length:var(--text-xs)] text-[var(--text-muted)]">
                {trailNodes.slice(-5).map((n, i, arr) => (
                  <span key={n.id} className="flex min-w-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectNode(n.id, { record: false })}
                      aria-current={n.id === stickyId ? "true" : undefined}
                      className="focus-ring max-w-[7rem] truncate rounded px-1 hover:text-[var(--text-primary)] aria-[current=true]:text-[var(--text-primary)]"
                    >
                      {n.title}
                    </button>
                    {i < arr.length - 1 ? <Icon name="ph:caret-right" width={9} aria-hidden /> : null}
                  </span>
                ))}
              </nav>
            ) : null}
          </>
        ) : (
          <div className="px-2 py-2">
            <p className="px-1 pb-1 text-[length:var(--text-sm)] leading-snug text-[var(--text-secondary)]">
              Select any node to fly to it and walk its connections. Start from a hub:
            </p>
            {hubs.map((n) => nodeButton(n, () => selectNode(n.id)))}
          </div>
        )}
      </section>

      {/* Projection / drift / zoom / fit controls. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        {(
          [
            {
              label: three ? "Switch to flat 2D layout" : "Switch to 3D layout",
              icon: three ? "ph:graph" : "ph:cube",
              act: () => {
                needsFitRef.current = true;
                setPrefs((p) => ({ ...p, dims: p.dims === 3 ? 2 : 3 }));
              },
              pressed: undefined,
            },
            ...(three && !reducedMotion
              ? [
                  {
                    label: prefs.drift ? "Pause idle drift" : "Resume idle drift",
                    icon: prefs.drift ? "ph:pause" : "ph:play",
                    act: () => setPrefs((p) => ({ ...p, drift: !p.drift })),
                    pressed: prefs.drift,
                  },
                ]
              : []),
            { label: "Zoom in", icon: "ph:plus", act: () => zoomBy(1.25), pressed: undefined },
            { label: "Zoom out", icon: "ph:minus", act: () => zoomBy(0.8), pressed: undefined },
            { label: "Fit graph to view", icon: "ph:arrows-in-simple", act: () => fitView(), pressed: undefined },
          ] as { label: string; icon: IconName; act: () => void; pressed: boolean | undefined }[]
        ).map((b) => (
          <button
            key={b.label}
            type="button"
            aria-label={b.label}
            aria-pressed={b.pressed}
            title={b.label}
            onClick={b.act}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 text-[var(--text-secondary)] backdrop-blur hover:text-[var(--text-primary)]"
          >
            <Icon name={b.icon} width={12} aria-hidden />
          </button>
        ))}
      </div>

      {/* Status line. */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 px-2.5 py-1 text-[length:var(--text-xs)] text-[var(--text-muted)] backdrop-blur">
        {summary}
        {scanning ? " · scanning…" : ""}
        {three ? " · drag to orbit, shift-drag to pan" : ""}
      </div>
    </div>
  );
}

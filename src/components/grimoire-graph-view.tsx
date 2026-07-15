"use client";

// The Grimoire graph — an Obsidian-style force-directed canvas over every doc
// the Cave keeps (cave-hand). Nodes are docs (and tags), sized by connection
// count; edges carry their generator: solid = explicit [[wiki-link]], dashed =
// inferred unlinked mention, faint = tag membership. Interactions mirror
// Obsidian: drag nodes (the sim reheats around them), pan and cursor-anchored
// zoom, hover to spotlight a node's neighborhood while the rest dims, click a
// doc to open it, click a tag to pin its neighborhood. A filter card governs
// groups / edge types / orphans and exposes two live force sliders; scan
// bounds from the server are reported, never silently applied.
//
// Rendering is a hand-rolled <canvas> pass (no diagram dep): the corpus can
// reach hundreds of nodes, and canvas + typed-array physics
// (`lib/grimoire-force.ts`) keeps that smooth. Reduced motion settles the
// layout synchronously and renders it still. Positions and the viewport are
// cached module-level so reopening the graph resumes exactly where you left.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Icon } from "@/lib/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { DocGraph, DocGraphNode, GraphEdgeType, GraphNodeKind } from "@/lib/grimoire-graph";
import type { GrimoireGraphMeta } from "@/lib/server/grimoire-graph-scan";
import type { WikiDocRef } from "@/lib/wiki-link-resolve";
import {
  ALPHA_MIN,
  createForceSim,
  DEFAULT_FORCE_PARAMS,
  pinForceSimNode,
  reheatForceSim,
  settleForceSim,
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
  panelOpen: true,
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
      groups: { ...DEFAULT_PREFS.groups, ...(parsed?.groups ?? {}) },
      edgeTypes: { ...DEFAULT_PREFS.edgeTypes, ...(parsed?.edgeTypes ?? {}) },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

// ── Session continuity — layout + viewport survive close/reopen ─────────────

const positionCache = new Map<string, { x: number; y: number }>();
let savedView: { panX: number; panY: number; k: number } | null = null;

// ── Visual constants ─────────────────────────────────────────────────────────

const NODE_KIND_TOKEN: Record<GraphNodeKind, string> = {
  knowledge: "--accent-presence",
  memory: "--color-warning",
  journal: "--text-secondary",
  tag: "--color-success",
};

const EDGE_STRENGTH: Record<GraphEdgeType, number> = { link: 1, tag: 0.7, mention: 0.35 };
const EDGE_DISTANCE_SCALE: Record<GraphEdgeType, number> = { link: 1, tag: 0.85, mention: 1.35 };
const DIM_ALPHA = 0.12;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 5;

function nodeRadius(n: DocGraphNode, degree: number): number {
  if (n.kind === "tag") return 4;
  return Math.min(16, 3.5 + 2.1 * Math.sqrt(degree));
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

// ── The view ─────────────────────────────────────────────────────────────────

export function GrimoireGraphView({
  graph,
  meta,
  scanning,
  scanError,
  onOpen,
}: {
  /** The graph to render — full-corpus scan when available, else the
   *  client-built knowledge graph (so something always paints instantly). */
  graph: DocGraph;
  meta?: GrimoireGraphMeta | null;
  /** True while the full-corpus scan is still in flight. */
  scanning?: boolean;
  /** Set when the full scan failed — the local graph stays up. */
  scanError?: string | null;
  onOpen: (ref: WikiDocRef) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useAnnouncer();
  const reducedMotion = usePrefersReducedMotion();

  const [prefs, setPrefs] = useState<GraphPrefs>(readPrefs);
  const [query, setQuery] = useState("");
  // Sticky spotlight (a clicked tag stays highlighted); hover lives in a ref —
  // it changes every mousemove and must not re-render React.
  const [stickyId, setStickyId] = useState<string | null>(null);

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

  // ── Simulation lifecycle ────────────────────────────────────────────────────
  const simRef = useRef<ForceSim | null>(null);
  const paramsRef = useRef<ForceParams>(DEFAULT_FORCE_PARAMS);
  paramsRef.current = {
    ...DEFAULT_FORCE_PARAMS,
    repelStrength: DEFAULT_FORCE_PARAMS.repelStrength * prefs.repel,
    linkDistance: prefs.linkDistance,
  };

  const viewRef = useRef(savedView ?? { panX: 0, panY: 0, k: 1 });
  const hoverRef = useRef<string | null>(null);
  const stickyRef = useRef<string | null>(null);
  stickyRef.current = stickyId;

  // Keyboard node traversal (cave-2cx8): the canvas was pointer-only — panning
  // with the arrows but never letting focus reach a node. Tab / Shift+Tab now
  // cycle the most-connected visible nodes (hubs first), announcing each and
  // centering it, with Enter to open. Capped so Tab-cycling stays tractable; the
  // search box still reaches any node by name. Cursor released (index -1) at the
  // ends so Tab can still leave the graph.
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
  const needsFitRef = useRef(savedView === null);
  const dragRef = useRef<{
    pointerId: number;
    mode: "node" | "pan";
    nodeIndex: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  /** Save the live sim's positions into the module cache (layout continuity). */
  const snapshotPositions = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    for (let i = 0; i < sim.count; i++) positionCache.set(sim.ids[i], { x: sim.x[i], y: sim.y[i] });
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
    const { panX, panY, k } = viewRef.current;
    const cx = width / 2 + panX;
    const cy = height / 2 + panY;
    const toScreenX = (wx: number) => cx + wx * k;
    const toScreenY = (wy: number) => cy + wy * k;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const focus = hoverRef.current ?? stickyRef.current;
    const neighborhood = focus ? adjacency.get(focus) : null;
    const inFocus = (id: string) => (!focus ? true : id === focus || (neighborhood?.has(id) ?? false));
    const matches = queryMatches;
    const emphasized = (id: string) => (matches ? matches.has(id) : inFocus(id));

    // Edges under nodes; dimmed pass first so spotlights stay crisp.
    const edgeWidth = Math.min(2, Math.max(0.4, Math.sqrt(k)));
    for (const dimPass of [true, false]) {
      for (const e of visible.edges) {
        const a = sim.indexOf.get(e.source);
        const b = sim.indexOf.get(e.target);
        if (a === undefined || b === undefined) continue;
        const lit = matches
          ? matches.has(e.source) && matches.has(e.target)
          : !focus || ((e.source === focus || e.target === focus) && inFocus(e.source) && inFocus(e.target));
        if (lit === dimPass) continue;
        const baseAlpha = e.type === "link" ? 0.45 : e.type === "tag" ? 0.22 : 0.3;
        ctx.globalAlpha = lit ? (focus || matches ? Math.min(1, baseAlpha + 0.25) : baseAlpha) : DIM_ALPHA * 0.6;
        ctx.strokeStyle = e.type === "tag" ? palette.tag : palette.edge;
        ctx.lineWidth = e.type === "link" ? edgeWidth : edgeWidth * 0.8;
        ctx.setLineDash(e.type === "mention" ? [4, 4] : []);
        ctx.beginPath();
        ctx.moveTo(toScreenX(sim.x[a]), toScreenY(sim.y[a]));
        ctx.lineTo(toScreenX(sim.x[b]), toScreenY(sim.y[b]));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // Nodes.
    for (const n of visible.nodes) {
      const i = sim.indexOf.get(n.id);
      if (i === undefined) continue;
      const lit = emphasized(n.id);
      const r = Math.max(1.5, nodeRadius(n, visible.degree.get(n.id) ?? 0) * k);
      const sx = toScreenX(sim.x[i]);
      const sy = toScreenY(sim.y[i]);
      ctx.globalAlpha = lit ? 1 : DIM_ALPHA;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (n.kind === "tag") {
        ctx.strokeStyle = palette.tag;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      } else {
        ctx.fillStyle = palette[n.kind];
        ctx.fill();
      }
      if (n.id === focus || n.id === stickyRef.current) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = palette[n.kind];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Labels — fade in with zoom (hover/sticky/query hits always show; hubs a
    // little earlier than leaves).
    const baseLabelAlpha = k >= 1.3 ? 1 : k >= 0.85 ? (k - 0.85) / 0.45 : 0;
    ctx.font = `11px ${getComputedStyle(canvas).fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const n of visible.nodes) {
      const i = sim.indexOf.get(n.id);
      if (i === undefined) continue;
      const forced = n.id === focus || n.id === stickyRef.current || (matches?.has(n.id) ?? false);
      const hubAlpha =
        (visible.degree.get(n.id) ?? 0) >= 5 ? Math.max(baseLabelAlpha, (k - 0.5) / 0.6) : baseLabelAlpha;
      let alpha = forced ? 1 : Math.max(0, Math.min(1, hubAlpha));
      if (!emphasized(n.id)) alpha = Math.min(alpha, DIM_ALPHA);
      if (alpha <= 0.02) continue;
      const r = Math.max(1.5, nodeRadius(n, visible.degree.get(n.id) ?? 0) * k);
      const label = n.title.length > 28 ? `${n.title.slice(0, 27)}…` : n.title;
      const sx = toScreenX(sim.x[i]);
      const sy = toScreenY(sim.y[i]) + r + 3;
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = palette.halo;
      ctx.lineWidth = 3;
      ctx.strokeText(label, sx, sy);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = forced ? palette.labelStrong : palette.label;
      ctx.fillText(label, sx, sy);
    }
    ctx.globalAlpha = 1;
  }, [adjacency, queryMatches, visible]);

  const scheduleFrame = useCallback(() => {
    if (frameRef.current !== null) return;
    const frame = () => {
      frameRef.current = null;
      const sim = simRef.current;
      if (!sim) return;
      if (!reducedMotionRef.current && sim.alpha > ALPHA_MIN) {
        tickForceSim(sim, paramsRef.current);
        draw();
        frameRef.current = requestAnimationFrame(frame);
      } else {
        draw();
      }
    };
    frameRef.current = requestAnimationFrame(frame);
  }, [draw]);

  /** Fit the whole layout in the viewport with padding. */
  const fitView = useCallback(() => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas || sim.count === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
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

  /** Pan (keeping zoom) so a node sits at the viewport centre — used by the
   *  keyboard traversal to bring the focused node into view. */
  const centerOnNode = useCallback((id: string) => {
    const sim = simRef.current;
    if (!sim) return;
    const i = sim.indexOf.get(id);
    if (i === undefined) return;
    const view = viewRef.current;
    view.panX = -sim.x[i] * view.k;
    view.panY = -sim.y[i] * view.k;
    savedView = { ...view };
    scheduleFrame();
  }, [scheduleFrame]);

  // (Re)build the sim whenever the visible graph changes; carried-over nodes
  // keep their positions, new ones join on the spiral.
  useEffect(() => {
    snapshotPositions();
    let spiralIndex = 0;
    const simNodes = visible.nodes.map((n) => {
      const cached = positionCache.get(n.id);
      const seed = cached ?? spiralSeed(spiralIndex++ + visible.nodes.length);
      return { id: n.id, radius: nodeRadius(n, visible.degree.get(n.id) ?? 0), x: seed.x, y: seed.y };
    });
    const simLinks = visible.edges.map((e) => ({
      source: e.source,
      target: e.target,
      strength: EDGE_STRENGTH[e.type],
      distanceScale: EDGE_DISTANCE_SCALE[e.type],
    }));
    const sim = createForceSim(simNodes, simLinks);
    simRef.current = sim;
    if (reducedMotionRef.current) {
      settleForceSim(sim, paramsRef.current);
    } else {
      reheatForceSim(sim, 0.8);
    }
    if (needsFitRef.current && sim.count > 0) {
      needsFitRef.current = false;
      // Fit against a settled-ish layout so the first frame is meaningful.
      if (!reducedMotionRef.current) settleForceSim(sim, paramsRef.current, 120);
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
  }, [visible, fitView, scheduleFrame, snapshotPositions]);

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

  const hitTest = useCallback(
    (clientX: number, clientY: number): number => {
      const sim = simRef.current;
      if (!sim) return -1;
      const { x: wx, y: wy } = toWorld(clientX, clientY);
      const slack = 6 / viewRef.current.k;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < sim.count; i++) {
        const dx = sim.x[i] - wx;
        const dy = sim.y[i] - wy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const node = nodeById.get(sim.ids[i]);
        const r = node ? nodeRadius(node, visible.degree.get(node.id) ?? 0) : 5;
        if (d <= r + slack && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    },
    [nodeById, toWorld, visible.degree],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);
      const nodeIndex = hitTest(e.clientX, e.clientY);
      dragRef.current = {
        pointerId: e.pointerId,
        mode: nodeIndex >= 0 ? "node" : "pan",
        nodeIndex,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    },
    [hitTest],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const sim = simRef.current;
      const drag = dragRef.current;
      if (drag && sim && drag.pointerId === e.pointerId) {
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) {
          drag.moved = true;
          if (drag.mode === "node" && !reducedMotionRef.current) reheatForceSim(sim, 0.3);
        }
        if (!drag.moved) return;
        if (drag.mode === "node") {
          const { x, y } = toWorld(e.clientX, e.clientY);
          pinForceSimNode(sim, drag.nodeIndex, x, y);
          if (reducedMotionRef.current) settleForceSim(sim, paramsRef.current, 30);
        } else {
          viewRef.current.panX += e.movementX;
          viewRef.current.panY += e.movementY;
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
    [hitTest, scheduleFrame, toWorld],
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
      if (drag.moved) return; // pan
      // Click: open a doc, pin a tag's neighborhood, or clear on background.
      const idx = hitTest(e.clientX, e.clientY);
      if (idx < 0) {
        setStickyId(null);
        scheduleFrame();
        return;
      }
      const node = nodeById.get(sim.ids[idx]);
      if (!node) return;
      if (node.ref) {
        announcer.announce(`Opening ${node.title}`, "polite");
        onOpen(node.ref);
      } else {
        setStickyId((prev) => (prev === node.id ? null : node.id));
        scheduleFrame();
      }
    },
    [announcer, hitTest, nodeById, onOpen, scheduleFrame],
  );

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
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
    [scheduleFrame],
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

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLCanvasElement>) => {
      // Tab / Shift+Tab cycle the keyboard node list (hubs first): highlight,
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
      // Enter opens the keyboard-focused node.
      if (e.key === "Enter" && kbdIdxRef.current >= 0) {
        const node = keyboardNodesRef.current[kbdIdxRef.current];
        if (node?.ref) {
          announcer.announce(`Opening ${node.title}`, "polite");
          onOpen(node.ref);
        }
        e.preventDefault();
        return;
      }
      const pan = (dx: number, dy: number) => {
        viewRef.current.panX += dx;
        viewRef.current.panY += dy;
        savedView = { ...viewRef.current };
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
    [announcer, centerOnNode, fitView, onOpen, scheduleFrame, zoomBy],
  );

  // ── Empty state — only when there is genuinely nothing to draw ─────────────
  if (graph.nodes.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center p-8">
        <EmptyState
          icon="ph:graph"
          headline={scanning ? "Weaving the graph…" : "Nothing to graph yet"}
          subtitle={
            scanning
              ? "Scanning your knowledge, memory, and journal for connections."
              : "Create a knowledge entry, memory file, or journal day and it appears here — [[wiki-links]], tags, and mentions weave them together."
          }
        />
      </div>
    );
  }

  const summary = `${visible.nodes.length} of ${graph.nodes.length} nodes, ${visible.edges.length} connections shown`;
  const memoryTruncated = meta ? meta.memory.scanned < meta.memory.total : false;

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
      className="flex cursor-pointer items-center gap-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]"
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
      {count !== undefined ? <span className="shrink-0 text-[10px] text-[var(--text-muted)]">{count}</span> : null}
    </label>
  );

  return (
    <div ref={containerRef} className="grimoire-graph relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Document graph: ${summary}. Tab and Shift+Tab step through the most-connected documents, Enter opens the focused one; arrow keys pan, plus and minus zoom, 0 fits the view.`}
        tabIndex={0}
        className="focus-ring absolute inset-0 h-full w-full cursor-grab touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (hoverRef.current) {
            hoverRef.current = null;
            scheduleFrame();
          }
        }}
        onKeyDown={onKeyDown}
        onDoubleClick={() => fitView()}
      />

      {/* Filter / forces card (Obsidian's graph settings). */}
      <section
        aria-label="Graph filters"
        className="absolute left-2 top-2 w-52 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 shadow-sm backdrop-blur"
      >
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <Icon name="ph:sliders-horizontal" width={12} aria-hidden className="text-[var(--text-muted)]" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text-primary)]">Graph</span>
          <button
            type="button"
            aria-expanded={prefs.panelOpen}
            aria-label={prefs.panelOpen ? "Collapse graph filters" : "Expand graph filters"}
            onClick={() => setPrefs((p) => ({ ...p, panelOpen: !p.panelOpen }))}
            className="focus-ring inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon name={prefs.panelOpen ? "ph:caret-down" : "ph:caret-right"} width={11} aria-hidden />
          </button>
        </div>
        {prefs.panelOpen ? (
          <div className="space-y-2.5 border-t border-[var(--border-hairline)] px-2.5 py-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder="Highlight nodes…"
              aria-label="Highlight graph nodes"
              className="focus-ring w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <div>
              <p className="pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
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
                "Daily reflections, one per day",
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
              <p className="pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
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
              <p className="pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Forces
              </p>
              <label className="block py-0.5 text-[11px] text-[var(--text-secondary)]">
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
              <label className="block py-0.5 text-[11px] text-[var(--text-secondary)]">
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
            {memoryTruncated && meta ? (
              <p className="text-[10px] leading-snug text-[var(--text-muted)]">
                Scanned the {meta.memory.scanned} most recent of {meta.memory.total} memory files.
              </p>
            ) : null}
            {scanError ? (
              <p className="text-[10px] leading-snug text-[var(--color-warning)]">
                Full scan unavailable — showing knowledge-vault connections only.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Zoom / fit controls. */}
      <div className="absolute bottom-2 right-2 flex flex-col gap-1">
        {(
          [
            { label: "Zoom in", icon: "ph:plus", act: () => zoomBy(1.25) },
            { label: "Zoom out", icon: "ph:minus", act: () => zoomBy(0.8) },
            { label: "Fit graph to view", icon: "ph:arrows-in-simple", act: () => fitView() },
          ] as const
        ).map((b) => (
          <button
            key={b.label}
            type="button"
            aria-label={b.label}
            title={b.label}
            onClick={b.act}
            className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 text-[var(--text-secondary)] backdrop-blur hover:text-[var(--text-primary)]"
          >
            <Icon name={b.icon} width={12} aria-hidden />
          </button>
        ))}
      </div>

      {/* Status line. */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-[var(--border-hairline)] bg-[var(--bg-raised)]/90 px-2.5 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur">
        {summary}
        {scanning ? " · scanning…" : ""}
      </div>
    </div>
  );
}

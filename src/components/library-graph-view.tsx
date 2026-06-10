"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Modal } from "@/components/ui/modal";
import type { GraphifyResult, GraphifyGraph, GraphifyNode, GraphifyEdge } from "@/lib/library-types";

// ── Types ────────────────────────────────────────────────────────

type GraphMeta = Omit<GraphifyResult, "graphJson" | "reportMd">;

type NodePos = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  node: GraphifyNode;
};

// ── Force layout (simple spring simulation) ─────────────────────

function runForceLayout(
  nodes: GraphifyNode[],
  edges: GraphifyEdge[],
  width: number,
  height: number,
  iterations = 200,
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  // Large graphs: skip full O(n²) sim — too slow and doesn't converge well.
  // Instead assign a readable grid layout that avoids collisions, then run
  // a small attraction-only pass to pull connected nodes closer.
  const BIG_GRAPH_THRESHOLD = 300;
  if (nodes.length > BIG_GRAPH_THRESHOLD) {
    const cols = Math.ceil(Math.sqrt(nodes.length * (width / height)));
    const rows = Math.ceil(nodes.length / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    const posMap = new Map(
      nodes.map((n, i) => [
        n.id,
        {
          x: (i % cols) * cellW + cellW / 2 + (Math.random() - 0.5) * cellW * 0.3,
          y: Math.floor(i / cols) * cellH + cellH / 2 + (Math.random() - 0.5) * cellH * 0.3,
          vx: 0,
          vy: 0,
          node: n,
        },
      ]),
    );
    // Light attraction-only pass (50 iters) to pull edge-connected nodes closer
    const aK = Math.min(cellW, cellH) * 0.15;
    for (let iter = 0; iter < 50; iter++) {
      for (const edge of edges) {
        const srcId = typeof edge.source === "object"
          ? (edge.source as { id?: string }).id ?? String(edge.source)
          : String(edge.source);
        const tgtId = typeof edge.target === "object"
          ? (edge.target as { id?: string }).id ?? String(edge.target)
          : String(edge.target);
        const a = posMap.get(srcId);
        const b = posMap.get(tgtId);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = aK;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx * 0.5; a.vy += fy * 0.5;
        b.vx -= fx * 0.5; b.vy -= fy * 0.5;
      }
      for (const p of posMap.values()) {
        p.x = Math.max(24, Math.min(width - 24, p.x + p.vx));
        p.y = Math.max(24, Math.min(height - 24, p.y + p.vy));
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
    }
    return new Map([...posMap.entries()].map(([id, p]) => [id, { x: p.x, y: p.y }]));
  }

  const positions: NodePos[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.35;
    return {
      id: n.id,
      x: width / 2 + r * Math.cos(angle),
      y: height / 2 + r * Math.sin(angle),
      vx: 0,
      vy: 0,
      node: n,
    };
  });

  const posMap = new Map(positions.map((p) => [p.id, p]));
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1));
  // Boost repulsion so nodes spread across the full canvas, not into columns
  const repulsion = k * k * 3.0;
  const attractionK = k * 0.08;
  const damping = 0.8;

  for (let iter = 0; iter < iterations; iter++) {
    const temp = 1 - iter / iterations;

    // Repulsion between all pairs
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const force = repulsion / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction along edges
    for (const edge of edges) {
      const srcId = typeof edge.source === "object"
        ? (edge.source as { id?: string }).id ?? String(edge.source)
        : String(edge.source);
      const tgtId = typeof edge.target === "object"
        ? (edge.target as { id?: string }).id ?? String(edge.target)
        : String(edge.target);
      const a = posMap.get(srcId);
      const b = posMap.get(tgtId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const force = attractionK * dist;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Apply velocity + damping + bounds
    const maxDisplace = Math.min(width, height) * 0.1 * temp;
    for (const p of positions) {
      const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > maxDisplace) {
        p.vx = (p.vx / speed) * maxDisplace;
        p.vy = (p.vy / speed) * maxDisplace;
      }
      p.x = Math.max(40, Math.min(width - 40, p.x + p.vx));
      p.y = Math.max(40, Math.min(height - 40, p.y + p.vy));
      p.vx *= damping;
      p.vy *= damping;
    }
  }

  return new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
}

// ── GraphCanvas ──────────────────────────────────────────────────

function GraphCanvas({
  graph,
  filter,
  selectedNodeId,
  onSelectNode,
}: {
  graph: GraphifyGraph;
  filter: string;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0 });
  const [posOverride, setPosOverride] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setSize({ w: e.contentRect.width || 600, h: e.contentRect.height || 400 });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (graph.nodes.length === 0) return;
    const pos = runForceLayout(graph.nodes, graph.edges, size.w, size.h);
    setPositions(pos);
    setPosOverride(new Map());
  }, [graph, size]);

  const filterLower = filter.toLowerCase();
  const filteredNodeIds = new Set(
    filter
      ? graph.nodes.filter((n) => n.label.toLowerCase().includes(filterLower)).map((n) => n.id)
      : graph.nodes.map((n) => n.id),
  );

  const getPos = (id: string) => posOverride.get(id) ?? positions.get(id) ?? { x: 0, y: 0 };
  const radius = (n: GraphifyNode) => {
    const w = typeof n.weight === "number" ? n.weight : 1;
    return Math.max(8, Math.min(24, 8 + w * 3));
  };

  const onMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const pos = getPos(nodeId);
    setDragging(nodeId);
    setDragOffset({ dx: pos.x - (e.clientX - svgRect.left), dy: pos.y - (e.clientY - svgRect.top) });
  };

  const onMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!dragging) return;
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const svgRect = svgEl.getBoundingClientRect();
      const nx = Math.max(20, Math.min(size.w - 20, e.clientX - svgRect.left + dragOffset.dx));
      const ny = Math.max(20, Math.min(size.h - 20, e.clientY - svgRect.top + dragOffset.dy));
      setPosOverride((prev) => new Map(prev).set(dragging, { x: nx, y: ny }));
    },
    [dragging, dragOffset, size],
  );

  const onMouseUp = () => setDragging(null);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">
        No nodes in this graph.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="cursor-default select-none"
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onClick={() => onSelectNode(null)}
      >
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--border-hairline)" />
          </marker>
        </defs>

        {graph.edges.map((edge, i) => {
          const srcId = typeof edge.source === "object"
            ? (edge.source as { id?: string }).id ?? String(edge.source)
            : String(edge.source);
          const tgtId = typeof edge.target === "object"
            ? (edge.target as { id?: string }).id ?? String(edge.target)
            : String(edge.target);
          const src = getPos(srcId);
          const tgt = getPos(tgtId);
          const visible = filteredNodeIds.has(srcId) && filteredNodeIds.has(tgtId);
          return (
            <line
              key={i}
              x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
              stroke="var(--border-hairline)"
              strokeWidth={1.5}
              strokeOpacity={visible ? 0.6 : 0.1}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {graph.nodes.map((node) => {
          const pos = getPos(node.id);
          const r = radius(node);
          const visible = filteredNodeIds.has(node.id);
          const selected = node.id === selectedNodeId;
          const hovered = node.id === hoveredNodeId;
          // Only render text labels when the graph is small enough that they
          // won't collide. For dense graphs, show labels only on hover/selection.
          const LABEL_DENSITY_THRESHOLD = 120;
          const showLabel =
            graph.nodes.length <= LABEL_DENSITY_THRESHOLD || selected || hovered;
          return (
            <g
              key={node.id}
              transform={`translate(${pos.x},${pos.y})`}
              style={{ cursor: "pointer", opacity: visible ? 1 : 0.25 }}
              onMouseDown={(e) => onMouseDown(e, node.id)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId((prev) => (prev === node.id ? null : prev))}
              onClick={(e) => { e.stopPropagation(); onSelectNode(selected ? null : node.id); }}
            >
              <circle
                r={r}
                fill={selected ? "var(--accent-presence)" : hovered ? "var(--bg-active)" : "var(--bg-raised)"}
                stroke={selected ? "var(--accent-presence)" : hovered ? "var(--text-muted)" : "var(--border-hairline)"}
                strokeWidth={selected ? 2.5 : hovered ? 2 : 1.5}
              />
              {showLabel && (
                <text
                  textAnchor="middle"
                  dominantBaseline="auto"
                  y={r + 12}
                  fontSize={selected || hovered ? 11 : 10}
                  fontWeight={selected || hovered ? 600 : 400}
                  fill={selected ? "var(--text-primary)" : hovered ? "var(--text-primary)" : "var(--text-secondary)"}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {node.label.length > 18 ? node.label.slice(0, 16) + "\u2026" : node.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {/* Node count hint — helpful for dense graphs where labels are suppressed */}
      {graph.nodes.length > 0 && (
        <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-[var(--text-muted)] opacity-60 select-none">
          {graph.nodes.length} nodes · {graph.edges.length} edges
          {graph.nodes.length > 120 ? " · hover to label" : ""}
        </div>
      )}
    </div>
  );
}

// ── NodeDetailPanel ──────────────────────────────────────────────

function NodeDetailPanel({
  node,
  graph,
  onClose,
}: {
  node: GraphifyNode;
  graph: GraphifyGraph;
  onClose: () => void;
}) {
  const connected = graph.edges
    .filter((e) => {
      const src = typeof e.source === "object"
        ? (e.source as { id?: string }).id ?? String(e.source)
        : String(e.source);
      const tgt = typeof e.target === "object"
        ? (e.target as { id?: string }).id ?? String(e.target)
        : String(e.target);
      return src === node.id || tgt === node.id;
    })
    .map((e) => {
      const src = typeof e.source === "object"
        ? (e.source as { id?: string }).id ?? String(e.source)
        : String(e.source);
      const tgt = typeof e.target === "object"
        ? (e.target as { id?: string }).id ?? String(e.target)
        : String(e.target);
      const otherId = src === node.id ? tgt : src;
      const other = graph.nodes.find((n) => n.id === otherId);
      return { edge: e, other, direction: src === node.id ? ("out" as const) : ("in" as const) };
    });

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="truncate font-semibold text-[var(--text-primary)]">{node.label}</span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-raised)] hover:text-[var(--text-primary)]"
          aria-label="Close"
        >
          <Icon name="ph:x-bold" width={12} />
        </button>
      </div>

      {node.type && (
        <div className="mb-2">
          <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">Type </span>
          <span className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
            {String(node.type)}
          </span>
        </div>
      )}

      {typeof node.weight === "number" && (
        <div className="mb-2 text-xs text-[var(--text-muted)]">
          Weight: <span className="text-[var(--text-secondary)]">{node.weight}</span>
        </div>
      )}

      {Array.isArray(node.tags) && (node.tags as string[]).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {(node.tags as string[]).map((tag, i) => (
            <span key={i} className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {tag}
            </span>
          ))}
        </div>
      )}

      {connected.length > 0 && (
        <div className="flex-1 overflow-y-auto">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Connections ({connected.length})
          </div>
          <ul className="space-y-1">
            {connected.map(({ other, edge, direction }, i) => (
              <li key={i} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className="shrink-0 text-[var(--text-muted)]">{direction === "out" ? "\u2192" : "\u2190"}</span>
                <span className="truncate">
                  {other?.label ?? (direction === "out" ? String(edge.target) : String(edge.source))}
                </span>
                {edge.label && (
                  <span className="ml-auto shrink-0 rounded bg-[var(--bg-raised)] px-1 py-0.5 text-[9px] text-[var(--text-muted)]">
                    {String(edge.label)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── RunGraphifyModal ─────────────────────────────────────────────

function RunGraphifyModal({
  open,
  onClose,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  onResult: (result: GraphifyResult) => void;
}) {
  const [targetPath, setTargetPath] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!targetPath.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/library/graph", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetPath: targetPath.trim(), label: label.trim() || undefined }),
      });
      const json = await res.json() as { ok: boolean; result?: GraphifyResult; error?: string };
      if (!json.ok || !json.result) {
        setError(json.error ?? "Graphify failed");
        return;
      }
      onResult(json.result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) { setTargetPath(""); setLabel(""); setError(null); }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      breadcrumb={["Knowledge Graph", "Run Graphify"]}
      footerActions={
        <>
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-raised)]"
          >
            Cancel
          </button>
          <button
            onClick={() => void run()}
            disabled={!targetPath.trim() || loading}
            className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)] disabled:opacity-50"
          >
            {loading ? "Running\u2026" : "Run Graphify"}
          </button>
        </>
      }
    >
      <div className="mb-4">
        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Target folder path
        </label>
        <input
          value={targetPath}
          onChange={(e) => setTargetPath(e.target.value)}
          placeholder="/Users/buns/Documents/GitHub/my-project"
          autoFocus
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
        />
      </div>
      <div className="mb-4">
        <label className="mb-1.5 block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
          Label (optional)
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="My Project"
          className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
        />
      </div>
      {loading && (
        <div className="mb-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-muted)]">
          Running graphify \u2014 this can take up to 2 minutes for large codebases\u2026
        </div>
      )}
      {error && (
        <div className="mb-3 rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
    </Modal>
  );
}

// ── LibraryGraphView (main export) ───────────────────────────────

export function LibraryGraphView() {
  const [graphMetas, setGraphMetas] = useState<GraphMeta[]>([]);
  const [activeResult, setActiveResult] = useState<GraphifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const loadMetas = useCallback(async () => {
    try {
      const res = await fetch("/api/library/graph", { cache: "no-store" });
      const json = await res.json() as { ok: boolean; graphs?: GraphMeta[] };
      if (json.ok) setGraphMetas(json.graphs ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { void loadMetas(); }, [loadMetas]);

  const loadGraphById = async (id: string) => {
    setLoading(true);
    setError(null);
    setSelectedNodeId(null);
    setFilter("");
    try {
      const res = await fetch(`/api/library/graph?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const json = await res.json() as { ok: boolean; result?: GraphifyResult; error?: string };
      if (json.ok && json.result) {
        setActiveResult(json.result);
      } else {
        setError(json.error ?? "Failed to load graph");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleNewResult = (result: GraphifyResult) => {
    setActiveResult(result);
    setGraphMetas((prev) => [
      { id: result.id, label: result.label, targetPath: result.targetPath, generatedAt: result.generatedAt },
      ...prev.filter((m) => m.id !== result.id),
    ]);
    setSelectedNodeId(null);
    setFilter("");
  };

  const selectedNode = activeResult?.graphJson.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const dateFmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
        <Icon name="ph:graph" width={15} className="text-[var(--text-muted)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">Knowledge Graph</span>

        {graphMetas.length > 0 && (
          <select
            className="ml-2 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--text-secondary)] outline-none"
            value={activeResult?.id ?? ""}
            onChange={(e) => { if (e.target.value) void loadGraphById(e.target.value); }}
          >
            <option value="">{activeResult ? activeResult.label : "\u2014 Previous runs \u2014"}</option>
            {graphMetas.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} \u00b7 {dateFmt.format(new Date(m.generatedAt))}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          {activeResult && (
            <>
              <div className="relative">
                <Icon name="ph:magnifying-glass" width={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value); setSelectedNodeId(null); }}
                  placeholder="Filter nodes\u2026"
                  className="h-7 w-36 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] pl-6 pr-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--border-strong)]"
                />
              </div>
              {activeResult.reportMd && (
                <button
                  type="button"
                  onClick={() => setShowReport((v) => !v)}
                  className={`flex items-center gap-1 rounded border border-[var(--border-hairline)] px-2 py-1 text-xs transition-colors ${showReport ? "bg-[var(--accent-presence)] text-white" : "bg-[var(--bg-base)] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]"}`}
                >
                  <Icon name="ph:file-text" width={11} />
                  Report
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => setRunModalOpen(true)}
            className="flex items-center gap-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)]"
          >
            <Icon name="ph:arrows-clockwise" width={12} />
            Run Graphify
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex min-h-0 flex-1">
        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
            Loading graph\u2026
          </div>
        )}

        {error && (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm rounded border border-[var(--border-hairline)] bg-[var(--bg-card)] p-4 text-sm text-red-400">
              {error}
            </div>
          </div>
        )}

        {!loading && !error && !activeResult && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-[var(--text-muted)]">
            <Icon name="ph:graph" width={40} className="opacity-20" />
            <p>No knowledge graph loaded.</p>
            <button
              type="button"
              onClick={() => setRunModalOpen(true)}
              className="flex items-center gap-1.5 rounded border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-card)]"
            >
              <Icon name="ph:arrows-clockwise" width={13} />
              Run Graphify on a folder
            </button>
          </div>
        )}

        {!loading && !error && activeResult && !showReport && (
          <>
            <div className={`relative min-h-0 overflow-hidden ${selectedNode ? "flex-1" : "flex-1"}`}>
              <GraphCanvas
                graph={activeResult.graphJson}
                filter={filter}
                selectedNodeId={selectedNodeId}
                onSelectNode={setSelectedNodeId}
              />
              <div className="absolute bottom-2 right-2 rounded bg-[var(--bg-card)]/80 px-2 py-1 text-[10px] text-[var(--text-muted)] backdrop-blur-sm">
                {activeResult.graphJson.nodes.length} nodes \u00b7 {activeResult.graphJson.edges.length} edges
                {" \u00b7 "}{activeResult.label}
              </div>
            </div>

            {selectedNode && (
              <div className="w-[220px] shrink-0 overflow-hidden">
                <NodeDetailPanel
                  node={selectedNode}
                  graph={activeResult.graphJson}
                  onClose={() => setSelectedNodeId(null)}
                />
              </div>
            )}
          </>
        )}

        {!loading && !error && activeResult?.reportMd && showReport && (
          <div className="flex-1 overflow-y-auto p-6">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--text-secondary)]">
              {activeResult.reportMd}
            </pre>
            <button
              type="button"
              onClick={() => setShowReport(false)}
              className="mt-4 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Icon name="ph:arrow-left" width={11} />
              Back to graph
            </button>
          </div>
        )}
      </div>

      <RunGraphifyModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        onResult={handleNewResult}
      />
    </div>
  );
}

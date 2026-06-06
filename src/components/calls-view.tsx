"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { Familiar } from "@/lib/types";
import { aggregateEdges, type CallEdge, type CovenCall } from "@/lib/coven-calls-types";
import { DelegationCard } from "@/components/delegation-card";
import { CovenFloor } from "@/components/coven-floor";

// Coven Calls view — two tabs:
//   1. "The Floor" — live familiar status board (Coven Floor)
//   2. "Delegations" — delegation timeline + call graph (original view)

type Tab = "floor" | "delegations";

type Props = {
  familiars: Familiar[];
};

export function CallsView({ familiars }: Props) {
  const [tab, setTab] = useState<Tab>("floor");
  const [calls, setCalls] = useState<CovenCall[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coven-calls", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "calls load failed");
        return;
      }
      setCalls(json.calls ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    if (tab !== "delegations") return;
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load, tab]);

  const famById = useMemo(() => {
    const m = new Map<string, Familiar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const edges = useMemo(() => aggregateEdges(calls), [calls]);

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)]">
      {/* Top-level header + tab bar */}
      <header className="border-b border-[var(--border-hairline)] px-5 py-3">
        <h1 className="text-sm font-medium text-[var(--text-primary)]">
          Coven Calls
        </h1>
        {/* Tab bar */}
        <div className="mt-2 flex gap-1">
          {([
            ["floor", "The Floor"] as const,
            ["delegations", "Delegations"] as const,
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                "rounded-lg px-3 py-1 text-[11px] font-medium transition-colors",
                tab === id
                  ? "bg-[var(--bg-raised)] text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Tab content */}
      {tab === "floor" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CovenFloor />
        </div>
      ) : (
        <>
          {error ? (
            <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">
              {error}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto px-5 py-4 lg:grid-cols-[1fr_360px]">
            <section className="min-w-0">
              <h2 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                Recent delegations
              </h2>
          {calls.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-5 py-10 text-center text-sm text-[var(--text-secondary)]">
              No coven calls yet. The daemon will emit a delegation event
              each time one familiar calls another ({" "}
              <code className="rounded bg-[var(--bg-raised)] px-1 py-0.5 font-mono text-[11px]">
                :familiar &quot;task&quot;
              </code>{" "}
              etc.) and they will appear here.
            </div>
          ) : (
            <ul className="space-y-2">
              {calls.map((c) => (
                <li key={c.id}>
                  <DelegationCard call={c} familiars={famById} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="min-w-0">
          <h2 className="mb-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            Call graph
          </h2>
          <CallGraph
            familiars={familiars}
            edges={edges}
            calls={calls}
            emptyText={calls.length === 0 ? "no calls yet" : ""}
          />
        </aside>
      </div>
        </>
      )}
    </section>
  );
}

/* ----- Graph (SVG, circular, directional arrows, hover tooltips) ----- */

type RichEdge = CallEdge & { mostRecentRequest: string; hasRunning: boolean };
type TooltipEdgeState = { kind: "edge"; edge: RichEdge; x: number; y: number };
type TooltipNodeState = { kind: "node"; familiarId: string; x: number; y: number };
type TooltipState = TooltipEdgeState | TooltipNodeState | null;
type NodeStat = {
  sentCount: number;
  receivedCount: number;
  hasRunningReceived: boolean;
  latestReceivedFailed: boolean;
};

function CallGraph({
  familiars,
  edges: rawEdges,
  calls,
  emptyText,
}: {
  familiars: Familiar[];
  edges: CallEdge[];
  calls: CovenCall[];
  emptyText: string;
}) {
  const edges = rawEdges as RichEdge[];
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const nodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) {
      s.add(e.caller);
      s.add(e.callee);
    }
    return Array.from(s);
  }, [edges]);

  const W = 320;
  const H = 320;
  const cx = 160;
  const cy = 160;
  const NODE_R = 14;
  const r = Math.min(W, H) / 2 - 30;

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    nodeIds.forEach((id, i) => {
      const theta = (i / Math.max(nodeIds.length, 1)) * Math.PI * 2 - Math.PI / 2;
      m.set(id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    });
    return m;
  }, [nodeIds, r]);

  const nodeStats = useMemo(() => {
    const m = new Map<string, NodeStat>();
    const ensure = (id: string): NodeStat => {
      if (!m.has(id)) {
        m.set(id, {
          sentCount: 0,
          receivedCount: 0,
          hasRunningReceived: false,
          latestReceivedFailed: false,
        });
      }
      return m.get(id)!;
    };
    const sorted = [...calls].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const seenCallee = new Set<string>();
    for (const c of sorted) {
      ensure(c.callerFamiliarId).sentCount += 1;
      const stat = ensure(c.calleeFamiliarId);
      stat.receivedCount += 1;
      if (c.status === "running") stat.hasRunningReceived = true;
      if (!seenCallee.has(c.calleeFamiliarId)) {
        seenCallee.add(c.calleeFamiliarId);
        stat.latestReceivedFailed = c.status === "failed";
      }
    }
    return m;
  }, [calls]);

  if (nodeIds.length === 0) {
    return (
      <div
        className="grid place-items-center rounded-2xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 text-[11px] text-[var(--text-muted)]"
        style={{ height: H }}
      >
        {emptyText || "no graph"}
      </div>
    );
  }

  const maxCount = Math.max(...edges.map((e) => e.count));

  const svgToContainer = (svgX: number, svgY: number) => {
    const el = svgRef.current;
    if (!el) return { x: svgX, y: svgY };
    const bb = el.getBoundingClientRect();
    return { x: (svgX / W) * bb.width, y: (svgY / H) * bb.height };
  };

  const handleEdgeEnter = (
    _ev: MouseEvent<SVGPathElement>,
    edge: RichEdge,
    mx: number,
    my: number,
  ) => {
    const pt = svgToContainer(mx, my);
    setTooltip({ kind: "edge", edge, x: pt.x, y: pt.y });
  };

  const handleNodeEnter = (id: string, svgX: number, svgY: number) => {
    const pt = svgToContainer(svgX, svgY + NODE_R + 4);
    setTooltip({ kind: "node", familiarId: id, x: pt.x, y: pt.y });
  };

  return (
    <div className="relative" style={{ height: H }}>
      <style>{`
        @keyframes coven-dash { to { stroke-dashoffset: -24; } }
        .coven-edge-running { animation: coven-dash 1.5s linear infinite; }
      `}</style>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30"
        style={{ width: "100%", height: H }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <marker
            id="coven-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 7 3.5, 0 7" fill="var(--accent-presence)" fillOpacity={0.7} />
          </marker>
          <marker
            id="coven-arrow-running"
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <polygon points="0 0, 7 3.5, 0 7" fill="var(--accent-presence)" fillOpacity={1} />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = positions.get(e.caller);
          const b = positions.get(e.callee);
          if (!a || !b) return null;
          const strokeW = 1 + (e.count / maxCount) * 3;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const x1 = a.x + ux * (NODE_R + 1);
          const y1 = a.y + uy * (NODE_R + 1);
          const x2 = b.x - ux * (NODE_R + 2);
          const y2 = b.y - uy * (NODE_R + 2);
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const pathD = `M ${x1} ${y1} L ${x2} ${y2}`;
          const isRunning = e.hasRunning;
          return (
            <g key={i}>
              <path
                d={pathD}
                stroke="transparent"
                strokeWidth={Math.max(strokeW + 8, 12)}
                fill="none"
                style={{ cursor: "default" }}
                onMouseEnter={(ev) => handleEdgeEnter(ev, e, mx, my)}
                onMouseLeave={() => setTooltip(null)}
              />
              <path
                d={pathD}
                stroke="var(--accent-presence)"
                strokeOpacity={isRunning ? 0.85 : 0.45}
                strokeWidth={strokeW}
                strokeLinecap="round"
                fill="none"
                markerEnd={isRunning ? "url(#coven-arrow-running)" : "url(#coven-arrow)"}
                {...(isRunning
                  ? { className: "coven-edge-running", strokeDasharray: "8 4" }
                  : {})}
                style={{ pointerEvents: "none" }}
              />
              {e.count > 1 && (
                <text
                  x={mx}
                  y={my - 4}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--text-muted)"
                  style={{ pointerEvents: "none" }}
                >
                  {e.count}
                </text>
              )}
            </g>
          );
        })}
        {nodeIds.map((id) => {
          const f = familiars.find((x) => x.id === id);
          const p = positions.get(id)!;
          const stat = nodeStats.get(id);
          let ringColor = "var(--accent-presence)";
          let ringOpacity = 0.6;
          let ringWidth = 1.5;
          if (stat?.hasRunningReceived) {
            ringColor = "var(--status-active, #4ade80)";
            ringOpacity = 0.9;
            ringWidth = 2;
          } else if (stat?.latestReceivedFailed) {
            ringColor = "var(--status-error, #f87171)";
            ringOpacity = 0.9;
            ringWidth = 2;
          }
          const glyph = f?.emoji ? f.emoji : (f?.display_name ?? id).slice(0, 1).toUpperCase();
          const isEmoji = Boolean(f?.emoji);
          return (
            <g key={id}>
              <circle
                cx={p.x}
                cy={p.y}
                r={NODE_R}
                fill="var(--bg-raised)"
                stroke={ringColor}
                strokeOpacity={ringOpacity}
                strokeWidth={ringWidth}
                style={{ cursor: "default" }}
                onMouseEnter={() => handleNodeEnter(id, p.x, p.y)}
                onMouseLeave={() => setTooltip(null)}
              />
              <text
                x={p.x}
                y={isEmoji ? p.y + 5 : p.y + 4}
                textAnchor="middle"
                fontSize={isEmoji ? "14" : "10"}
                fontWeight={isEmoji ? "normal" : "600"}
                fill="var(--text-primary)"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {glyph}
              </text>
              <text
                x={p.x}
                y={p.y + 28}
                textAnchor="middle"
                fontSize="9"
                fill="var(--text-secondary)"
                style={{ pointerEvents: "none" }}
              >
                {f?.display_name ?? id}
              </text>
            </g>
          );
        })}
      </svg>
      {tooltip && <GraphTooltip tooltip={tooltip} familiars={familiars} nodeStats={nodeStats} />}
    </div>
  );
}

function GraphTooltip({
  tooltip,
  familiars,
  nodeStats,
}: {
  tooltip: NonNullable<TooltipState>;
  familiars: Familiar[];
  nodeStats: Map<string, NodeStat>;
}) {
  const name = (id: string) => familiars.find((f) => f.id === id)?.display_name ?? id;
  const style: CSSProperties = {
    position: "absolute",
    left: tooltip.x + 8,
    top: tooltip.y + 8,
    maxWidth: 220,
    zIndex: 50,
    pointerEvents: "none",
  };
  if (tooltip.kind === "edge") {
    const { edge } = tooltip;
    const req = edge.mostRecentRequest;
    const t = req.length > 60 ? `${req.slice(0, 60)}...` : req;
    return (
      <div
        style={style}
        className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[11px] shadow-lg"
      >
        <div className="font-medium text-[var(--text-primary)]">
          {name(edge.caller)} -&gt; {name(edge.callee)}
        </div>
        <div className="mt-0.5 text-[var(--text-secondary)]">
          {edge.count} call{edge.count !== 1 ? "s" : ""}
          {edge.hasRunning && (
            <span className="ml-1.5 rounded bg-[var(--status-active,#4ade80)]/20 px-1 py-0.5 text-[10px] text-[var(--status-active,#4ade80)]">
              running
            </span>
          )}
        </div>
        {t && <div className="mt-1 italic text-[var(--text-muted)]">&quot;{t}&quot;</div>}
      </div>
    );
  }
  const stat = nodeStats.get(tooltip.familiarId);
  return (
    <div
      style={style}
      className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[11px] shadow-lg"
    >
      <div className="font-medium text-[var(--text-primary)]">{name(tooltip.familiarId)}</div>
      <div className="mt-0.5 text-[var(--text-secondary)]">
        up {stat?.sentCount ?? 0} sent · down {stat?.receivedCount ?? 0} received
      </div>
    </div>
  );
}

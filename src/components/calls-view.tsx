"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Card } from "@/lib/cave-board-types";
import {
  buildDelegationGraph,
  inferDelegationTraces,
  type CovenCall,
  type DelegationGraph,
  type DelegationGraphEdge,
  type DelegationGraphNode,
  type DelegationTrace,
} from "@/lib/coven-calls-types";
import type { Familiar, SessionRow } from "@/lib/types";
import { CovenFloor } from "@/components/coven-floor";
import { Icon } from "@/lib/icon";

export type CallsViewTab = "floor" | "delegations";
type TimeWindow = "24h" | "7d" | "all";
type Selection =
  | { kind: "edge"; key: string }
  | { kind: "node"; id: string }
  | { kind: "trace"; id: string }
  | null;

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
  initialTab?: CallsViewTab;
  embedded?: boolean;
};

type CallsResponse = { ok: true; calls: CovenCall[] } | { ok: false; error?: string };
type BoardResponse = { ok: true; cards: Card[] } | { ok: false; error?: string };
type TooltipState =
  | { kind: "edge"; edge: DelegationGraphEdge; x: number; y: number }
  | { kind: "node"; node: DelegationGraphNode; x: number; y: number }
  | null;

const TIME_WINDOWS: Array<{ id: TimeWindow; label: string }> = [
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "all", label: "All" },
];

function edgeKey(edge: DelegationGraphEdge): string {
  return `${edge.caller}->${edge.callee}->${edge.source}`;
}

function familiarName(familiars: Map<string, Familiar>, id: string): string {
  return familiars.get(id)?.display_name ?? id;
}

function shortTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function windowStart(window: TimeWindow): number | null {
  if (window === "all") return null;
  return Date.now() - (window === "24h" ? 24 : 24 * 7) * 60 * 60 * 1000;
}

function matchesQuery(trace: DelegationTrace, query: string, familiars: Map<string, Familiar>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    trace.request,
    trace.status,
    trace.source,
    trace.inferenceReason ?? "",
    familiarName(familiars, trace.callerFamiliarId),
    familiarName(familiars, trace.calleeFamiliarId),
  ].some((value) => value.toLowerCase().includes(q));
}

function statusTone(status: DelegationTrace["status"]): string {
  if (status === "running") return "border-emerald-500/25 bg-emerald-500/15 text-emerald-300";
  if (status === "failed") return "border-rose-500/25 bg-rose-500/15 text-rose-200";
  if (status === "cancelled") return "border-amber-500/25 bg-amber-500/15 text-amber-200";
  return "border-[var(--border-hairline)] bg-[var(--bg-raised)] text-[var(--text-secondary)]";
}

function sourceTone(source: DelegationTrace["source"] | "mixed"): string {
  if (source === "explicit") return "border-[#8E3DFF]/30 bg-[#8E3DFF]/15 text-[#c7a7ff]";
  if (source === "inferred") return "border-amber-500/30 bg-amber-500/15 text-amber-200";
  return "border-sky-500/30 bg-sky-500/15 text-sky-200";
}

function edgeStroke(edge: DelegationGraphEdge): string {
  if (edge.latestStatus === "failed") return "#f87171";
  if (edge.hasRunning) return "#62d08f";
  if (edge.source === "inferred") return "#fbbf24";
  if (edge.source === "mixed") return "#38bdf8";
  return "#8E3DFF";
}

export function CallsView({ familiars, sessions, onOpenSession, initialTab = "floor", embedded = false }: Props) {
  const [tab, setTab] = useState<CallsViewTab>(initialTab);
  const [calls, setCalls] = useState<CovenCall[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [includeInferred, setIncludeInferred] = useState(true);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [callsRes, boardRes] = await Promise.all([
        fetch("/api/coven-calls", { cache: "no-store" }),
        fetch("/api/board", { cache: "no-store" }),
      ]);
      const callsJson = (await callsRes.json()) as CallsResponse;
      const boardJson = (await boardRes.json()) as BoardResponse;

      if (!callsJson.ok) {
        setError(callsJson.error ?? "calls load failed");
        return;
      }
      setCalls(callsJson.calls ?? []);
      if (boardJson.ok) setCards(boardJson.cards ?? []);
      setError(boardJson.ok ? null : boardJson.error ?? "task context load failed");
      setLastLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    if (tab !== "delegations") return;
    void load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load, tab]);

  const famById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const inferredTraces = useMemo(() => inferDelegationTraces({ cards, sessions }), [cards, sessions]);

  const graph = useMemo(() => {
    const since = windowStart(timeWindow);
    const explicitCalls = calls.filter((call) => {
      if (since !== null && new Date(call.createdAt).getTime() < since) return false;
      return matchesQuery({ ...call, source: "explicit" }, query, famById);
    });
    const visibleInferred = inferredTraces.filter((trace) => {
      if (since !== null && new Date(trace.createdAt).getTime() < since) return false;
      return matchesQuery(trace, query, famById);
    });
    return buildDelegationGraph({ explicitCalls, inferredTraces: visibleInferred, includeInferred });
  }, [calls, famById, inferredTraces, includeInferred, query, timeWindow]);

  const selectedEdge = selection?.kind === "edge"
    ? graph.edges.find((edge) => edgeKey(edge) === selection.key) ?? null
    : null;
  const selectedNode = selection?.kind === "node"
    ? graph.nodes.find((node) => node.id === selection.id) ?? null
    : null;
  const selectedTrace = selection?.kind === "trace"
    ? graph.traces.find((trace) => trace.id === selection.id) ?? null
    : null;

  const metrics = useMemo(() => ({
    explicit: graph.traces.filter((trace) => trace.source === "explicit").length,
    inferred: graph.traces.filter((trace) => trace.source === "inferred").length,
    running: graph.traces.filter((trace) => trace.status === "running").length,
    failed: graph.traces.filter((trace) => trace.status === "failed").length,
    agents: graph.nodes.length,
  }), [graph]);

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)]">
      {!embedded && (
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-hairline)] px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-[var(--text-primary)]">Coven Calls</h1>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Live familiar activity and delegation traces.</p>
        </div>
        <div className="ml-auto flex items-center overflow-hidden rounded-lg border border-[var(--border-hairline)]">
          {([
            ["floor", "The Floor"] as const,
            ["delegations", "Delegations"] as const,
          ] as [CallsViewTab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={[
                "px-3 py-1.5 text-[11px] font-medium transition-colors",
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
      )}

      {tab === "floor" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <CovenFloor />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-[11px] text-amber-200">{error}</div>
          ) : null}

          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border-hairline)] px-5 py-3">
            <div className="relative min-w-[220px] flex-1 md:max-w-[360px]">
              <Icon name="ph:magnifying-glass" width={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agent, request, status..."
                className="h-8 w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 pl-8 pr-3 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[#8E3DFF]"
              />
            </div>
            <div className="flex items-center overflow-hidden rounded-md border border-[var(--border-hairline)]">
              {TIME_WINDOWS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTimeWindow(id)}
                  className={[
                    "h-8 px-3 text-[11px] transition-colors",
                    timeWindow === id ? "bg-[#8E3DFF] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)]/40 px-3 text-[11px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={includeInferred} onChange={(e) => setIncludeInferred(e.target.checked)} className="accent-[#8E3DFF]" />
              Include inferred
            </label>
            <button type="button" onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
              <Icon name="ph:arrows-clockwise-bold" width={12} />
              Refresh
            </button>
            {lastLoadedAt ? <span className="text-[10px] text-[var(--text-muted)]">updated {new Date(lastLoadedAt).toLocaleTimeString()}</span> : null}
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--border-hairline)] px-5 py-3 md:grid-cols-5">
            <Metric label="Explicit" value={metrics.explicit} tone="text-[#c7a7ff]" />
            <Metric label="Inferred" value={metrics.inferred} tone="text-amber-200" />
            <Metric label="Running" value={metrics.running} tone="text-emerald-300" />
            <Metric label="Failed" value={metrics.failed} tone="text-rose-200" />
            <Metric label="Agents" value={metrics.agents} tone="text-[var(--text-primary)]" />
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-5 py-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex min-w-0 flex-col gap-3 overflow-hidden">
              <TraceGraph graph={graph} familiars={famById} selection={selection} onSelect={setSelection} />
              <TraceTimeline traces={graph.traces} familiars={famById} selectedTraceId={selection?.kind === "trace" ? selection.id : null} onSelect={(trace) => setSelection({ kind: "trace", id: trace.id })} />
            </section>
            <TraceInspector
              graph={graph}
              familiars={famById}
              selectedEdge={selectedEdge}
              selectedNode={selectedNode}
              selectedTrace={selectedTrace}
              onOpenSession={onOpenSession}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function TraceGraph({
  graph,
  familiars,
  selection,
  onSelect,
}: {
  graph: DelegationGraph;
  familiars: Map<string, Familiar>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}) {
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeStats = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const W = 900;
  const H = 460;
  const cx = W / 2;
  const cy = H / 2;
  const nodeR = 22;
  const r = Math.min(W, H) / 2 - 54;

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    graph.nodes.forEach((node, i) => {
      const theta = (i / Math.max(graph.nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
      map.set(node.id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    });
    return map;
  }, [graph.nodes, r]);

  useEffect(() => {
    setTooltip(null);
  }, [graph.edges, nodeStats]);

  if (graph.nodes.length === 0) {
    return (
      <div className="grid min-h-[360px] flex-1 place-items-center rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/25 text-sm text-[var(--text-muted)]">
        No delegation traces in this view.
      </div>
    );
  }

  const svgPoint = (x: number, y: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    return box ? { x: (x / W) * box.width, y: (y / H) * box.height } : { x, y };
  };
  const maxCount = Math.max(...graph.edges.map((edge) => edge.count), 1);

  return (
    <div className="relative min-h-[360px] flex-1 overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20">
      <style>{`@keyframes coven-dash { to { stroke-dashoffset: -24; } } .coven-edge-running { animation: coven-dash 1.5s linear infinite; }`}</style>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full min-h-[360px] w-full" onMouseLeave={() => setTooltip(null)}>
        <defs>
          {[
            ["explicit", "#8E3DFF"],
            ["inferred", "#fbbf24"],
            ["mixed", "#38bdf8"],
            ["running", "#62d08f"],
            ["failed", "#f87171"],
          ].map(([id, color]) => (
            <marker key={id} id={`coven-arrow-${id}`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth">
              <polygon points="0 0, 9 4.5, 0 9" fill={color} fillOpacity={0.9} />
            </marker>
          ))}
        </defs>

        {graph.edges.map((edge) => {
          const a = positions.get(edge.caller);
          const b = positions.get(edge.callee);
          if (!a || !b) return null;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const x1 = a.x + ux * (nodeR + 4);
          const y1 = a.y + uy * (nodeR + 4);
          const x2 = b.x - ux * (nodeR + 6);
          const y2 = b.y - uy * (nodeR + 6);
          const reciprocal = graph.edges.some((other) => other.caller === edge.callee && other.callee === edge.caller);
          const curve = reciprocal ? (edge.caller < edge.callee ? 46 : -46) : 18;
          const mx = (x1 + x2) / 2 - uy * curve;
          const my = (y1 + y2) / 2 + ux * curve;
          const pathD = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
          const selected = selection?.kind === "edge" && selection.key === edgeKey(edge);
          const strokeW = 1.5 + (edge.count / maxCount) * 4;
          const marker = edge.latestStatus === "failed"
            ? "url(#coven-arrow-failed)"
            : edge.hasRunning
            ? "url(#coven-arrow-running)"
            : `url(#coven-arrow-${edge.source})`;
          const tip = svgPoint(mx, my);
          return (
            <g key={`${edge.caller}->${edge.callee}->${edge.source}`} data-edge-source={edge.source}>
              <path
                d={pathD}
                stroke="transparent"
                strokeWidth={Math.max(strokeW + 12, 16)}
                fill="none"
                className="cursor-pointer"
                onClick={() => onSelect({ kind: "edge", key: edgeKey(edge) })}
                onMouseEnter={() => setTooltip({ kind: "edge", edge, x: tip.x, y: tip.y })}
                onMouseLeave={() => setTooltip(null)}
              />
              <path
                d={pathD}
                stroke={edgeStroke(edge)}
                strokeOpacity={selected ? 1 : edge.source === "inferred" ? 0.58 : 0.76}
                strokeWidth={selected ? strokeW + 1.5 : strokeW}
                strokeLinecap="round"
                fill="none"
                markerEnd={marker}
                strokeDasharray={edge.source === "inferred" ? "7 6" : edge.hasRunning ? "9 5" : undefined}
                className={edge.hasRunning ? "coven-edge-running" : undefined}
                style={{ pointerEvents: "none" }}
              />
              {edge.count > 1 ? (
                <g style={{ pointerEvents: "none" }}>
                  <circle cx={mx} cy={my - 8} r="10" fill="var(--bg-base)" stroke="var(--border-hairline)" />
                  <text x={mx} y={my - 4} textAnchor="middle" fontSize="10" fill="var(--text-secondary)" fontWeight="600">{edge.count}</text>
                </g>
              ) : null}
            </g>
          );
        })}

        {graph.nodes.map((node) => {
          const p = positions.get(node.id)!;
          const f = familiars.get(node.id);
          const glyph = f?.emoji ?? f?.display_name?.slice(0, 1).toUpperCase() ?? node.id.slice(0, 1).toUpperCase();
          const selected = selection?.kind === "node" && selection.id === node.id;
          const ring = node.hasRunningReceived ? "#62d08f" : node.latestReceivedFailed ? "#f87171" : "#8E3DFF";
          const tip = svgPoint(p.x, p.y + nodeR);
          return (
            <g
              key={node.id}
              className="cursor-pointer"
              onClick={() => onSelect({ kind: "node", id: node.id })}
              onMouseEnter={() => setTooltip({ kind: "node", node, x: tip.x, y: tip.y })}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle cx={p.x} cy={p.y} r={selected ? nodeR + 4 : nodeR} fill="var(--bg-raised)" stroke={ring} strokeWidth={selected ? 3 : 2} strokeOpacity={selected ? 1 : 0.82} />
              <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="650" fill="var(--text-primary)" style={{ pointerEvents: "none", userSelect: "none" }}>{glyph}</text>
              <text x={p.x} y={p.y + 39} textAnchor="middle" fontSize="10" fill="var(--text-secondary)" style={{ pointerEvents: "none" }}>{familiarName(familiars, node.id)}</text>
            </g>
          );
        })}
      </svg>
      {tooltip ? <GraphTooltip tooltip={tooltip} familiars={familiars} /> : null}
    </div>
  );
}

function GraphTooltip({ tooltip, familiars }: { tooltip: NonNullable<TooltipState>; familiars: Map<string, Familiar> }) {
  const style: CSSProperties = { position: "absolute", left: tooltip.x + 8, top: tooltip.y + 8, maxWidth: 250, zIndex: 50, pointerEvents: "none" };
  if (tooltip.kind === "edge") {
    const edge = tooltip.edge;
    return (
      <div style={style} className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[11px] shadow-xl">
        <div className="font-medium text-[var(--text-primary)]">{familiarName(familiars, edge.caller)} -&gt; {familiarName(familiars, edge.callee)}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <span className={`rounded-full border px-1.5 py-0.5 ${sourceTone(edge.source)}`}>{edge.source}</span>
          <span className={`rounded-full border px-1.5 py-0.5 ${statusTone(edge.latestStatus)}`}>{edge.latestStatus}</span>
        </div>
        <div className="mt-1 text-[var(--text-muted)]">{edge.count} trace{edge.count === 1 ? "" : "s"} · {shortTime(edge.lastSeenAt)}</div>
      </div>
    );
  }
  return (
    <div style={style} className="rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 py-2 text-[11px] shadow-xl">
      <div className="font-medium text-[var(--text-primary)]">{familiarName(familiars, tooltip.node.id)}</div>
      <div className="mt-0.5 text-[var(--text-secondary)]">{tooltip.node.sentCount} sent · {tooltip.node.receivedCount} received</div>
      <div className="mt-0.5 text-[var(--text-muted)]">{tooltip.node.sentInferredCount + tooltip.node.receivedInferredCount} inferred</div>
    </div>
  );
}

function TraceTimeline({
  traces,
  familiars,
  selectedTraceId,
  onSelect,
}: {
  traces: DelegationTrace[];
  familiars: Map<string, Familiar>;
  selectedTraceId: string | null;
  onSelect: (trace: DelegationTrace) => void;
}) {
  return (
    <div className="min-h-[170px] overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20">
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-secondary)]">Recent trace events</h2>
        <span className="text-[10px] text-[var(--text-muted)]">{traces.length} visible</span>
      </div>
      {traces.length === 0 ? (
        <div className="grid min-h-[120px] place-items-center text-sm text-[var(--text-muted)]">No trace events match the current filters.</div>
      ) : (
        <div className="max-h-[220px] overflow-y-auto">
          {traces.slice(0, 30).map((trace) => (
            <button
              key={trace.id}
              type="button"
              onClick={() => onSelect(trace)}
              className={[
                "grid w-full grid-cols-[92px_minmax(0,1fr)_auto] items-start gap-3 border-b border-[var(--border-hairline)] px-3 py-2 text-left text-[12px] transition-colors last:border-b-0",
                selectedTraceId === trace.id ? "bg-[#8E3DFF]/10" : "hover:bg-[var(--bg-raised)]/40",
              ].join(" ")}
            >
              <span className="text-[10px] text-[var(--text-muted)]">{shortTime(trace.createdAt)}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-[var(--text-primary)]">{familiarName(familiars, trace.callerFamiliarId)} -&gt; {familiarName(familiars, trace.calleeFamiliarId)}</span>
                <span className="mt-0.5 block truncate text-[var(--text-secondary)]">{trace.request}</span>
              </span>
              <span className="flex flex-wrap justify-end gap-1">
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${sourceTone(trace.source)}`}>{trace.source}</span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${statusTone(trace.status)}`}>{trace.status}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceInspector({
  graph,
  familiars,
  selectedEdge,
  selectedNode,
  selectedTrace,
  onOpenSession,
}: {
  graph: DelegationGraph;
  familiars: Map<string, Familiar>;
  selectedEdge: DelegationGraphEdge | null;
  selectedNode: DelegationGraphNode | null;
  selectedTrace: DelegationTrace | null;
  onOpenSession?: (sessionId: string, familiarId?: string | null) => void;
}) {
  if (selectedTrace) {
    return (
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
        <InspectorTitle eyebrow="Trace event" title={`${familiarName(familiars, selectedTrace.callerFamiliarId)} -> ${familiarName(familiars, selectedTrace.calleeFamiliarId)}`} />
        <BadgeRow source={selectedTrace.source} status={selectedTrace.status} />
        <p className="mt-3 whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--text-secondary)]">{selectedTrace.request}</p>
        {selectedTrace.inferenceReason ? <div className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">{selectedTrace.inferenceReason}</div> : null}
        <InspectorMeta label="Seen" value={shortTime(selectedTrace.createdAt)} />
        {selectedTrace.linkedCardId ? <InspectorMeta label="Linked task" value={selectedTrace.linkedCardId} /> : null}
        {selectedTrace.sessionId ? (
          <button type="button" onClick={() => onOpenSession?.(selectedTrace.sessionId!, selectedTrace.calleeFamiliarId)} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-hairline)] bg-[var(--bg-raised)] px-3 text-[11px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]">
            <Icon name="ph:arrow-square-out" width={12} />
            Open session
          </button>
        ) : null}
      </aside>
    );
  }

  if (selectedEdge) {
    return (
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
        <InspectorTitle eyebrow="Selected edge" title={`${familiarName(familiars, selectedEdge.caller)} -> ${familiarName(familiars, selectedEdge.callee)}`} />
        <BadgeRow source={selectedEdge.source} status={selectedEdge.latestStatus} />
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="Total" value={selectedEdge.count} tone="text-[var(--text-primary)]" />
          <Metric label="Explicit" value={selectedEdge.explicitCount} tone="text-[#c7a7ff]" />
          <Metric label="Inferred" value={selectedEdge.inferredCount} tone="text-amber-200" />
        </div>
        <InspectorMeta label="Last seen" value={shortTime(selectedEdge.lastSeenAt)} />
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">{selectedEdge.mostRecentRequest}</p>
      </aside>
    );
  }

  if (selectedNode) {
    return (
      <aside className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
        <InspectorTitle eyebrow="Selected agent" title={familiarName(familiars, selectedNode.id)} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="Sent" value={selectedNode.sentCount} tone="text-[var(--text-primary)]" />
          <Metric label="Received" value={selectedNode.receivedCount} tone="text-[var(--text-primary)]" />
          <Metric label="Explicit" value={selectedNode.sentExplicitCount + selectedNode.receivedExplicitCount} tone="text-[#c7a7ff]" />
          <Metric label="Inferred" value={selectedNode.sentInferredCount + selectedNode.receivedInferredCount} tone="text-amber-200" />
        </div>
        <InspectorMeta label="Last activity" value={selectedNode.lastSeenAt ? shortTime(selectedNode.lastSeenAt) : "none"} />
      </aside>
    );
  }

  const busiest = graph.edges[0];
  return (
    <aside className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/20 p-4">
      <InspectorTitle eyebrow="Trace inspector" title="Select an edge, node, or event" />
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        Explicit calls are solid traces. Inferred traces are dashed and amber, and can be hidden from the toolbar.
      </p>
      {busiest ? (
        <div className="mt-4 rounded-lg border border-[var(--border-hairline)] bg-[var(--bg-base)]/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">Busiest route</div>
          <div className="mt-1 text-sm font-medium text-[var(--text-primary)]">{familiarName(familiars, busiest.caller)} -&gt; {familiarName(familiars, busiest.callee)}</div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">{busiest.count} traces</div>
        </div>
      ) : null}
    </aside>
  );
}

function InspectorTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{eyebrow}</div>
      <h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
    </div>
  );
}

function BadgeRow({ source, status }: { source: DelegationTrace["source"] | "mixed"; status: DelegationTrace["status"] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${sourceTone(source)}`}>{source}</span>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusTone(status)}`}>{status}</span>
    </div>
  );
}

function InspectorMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">{value}</div>
    </div>
  );
}

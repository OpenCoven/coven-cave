"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
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
import { TraceGraph3D } from "@/components/trace-graph-3d";
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
type CovenMemoryResponse = { ok: boolean; entries?: Array<{ familiar_id: string }> };

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
  const [memoryCounts, setMemoryCounts] = useState<Map<string, number>>(new Map());

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

      try {
        const memRes = await fetch("/api/coven-memory", { cache: "no-store" });
        const memJson = (await memRes.json()) as CovenMemoryResponse;
        if (memJson.ok && memJson.entries) {
          const counts = new Map<string, number>();
          for (const entry of memJson.entries) {
            counts.set(entry.familiar_id, (counts.get(entry.familiar_id) ?? 0) + 1);
          }
          setMemoryCounts(counts);
        } else {
          setMemoryCounts(new Map());
        }
      } catch {
        setMemoryCounts(new Map());
      }
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
  const selectedTraceEdge = selectedTrace
    ? graph.edges.find((edge) => edge.traces.some((trace) => trace.id === selectedTrace.id)) ?? null
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
              <TraceGraph3D
                graph={graph}
                familiars={famById}
                selection={selection}
                onSelect={setSelection}
                memoryCounts={memoryCounts}
              />
              <TraceTimeline traces={graph.traces} familiars={famById} selectedTraceId={selection?.kind === "trace" ? selection.id : null} onSelect={(trace) => setSelection({ kind: "trace", id: trace.id })} />
            </section>
            <TraceInspector
              graph={graph}
              familiars={famById}
              selectedEdge={selectedEdge ?? selectedTraceEdge}
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

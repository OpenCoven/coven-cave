"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar } from "@/lib/types";
import { aggregateEdges, type CallEdge, type CovenCall } from "@/lib/coven-calls-types";
import { DelegationCard } from "@/components/delegation-card";

// Coven Calls view (issue #21) — read-only delegation timeline + a
// simple circular-layout graph showing who called whom across the
// current call log. Daemon-side delegation events are forthcoming;
// until then this lights up an empty state.

type Props = {
  familiars: Familiar[];
};

export function CallsView({ familiars }: Props) {
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
    void load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  const famById = useMemo(() => {
    const m = new Map<string, Familiar>();
    for (const f of familiars) m.set(f.id, f);
    return m;
  }, [familiars]);

  const edges = useMemo(() => aggregateEdges(calls), [calls]);

  return (
    <section className="flex h-full flex-col bg-[var(--bg-base)]">
      <header className="border-b border-[var(--border-hairline)] px-5 py-3">
        <h1 className="text-sm font-medium text-[var(--text-primary)]">
          Coven Calls
        </h1>
        <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
          Delegation timeline + who-called-whom across familiars.
        </p>
      </header>

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
                :cody &quot;task&quot;
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
            emptyText={calls.length === 0 ? "no calls yet" : ""}
          />
        </aside>
      </div>
    </section>
  );
}

/* ----- Graph (SVG, circular layout, no external dep) ----- */

function CallGraph({
  familiars,
  edges,
  emptyText,
}: {
  familiars: Familiar[];
  edges: CallEdge[];
  emptyText: string;
}) {
  // Only render nodes that appear in at least one edge — keeps the graph
  // legible when many familiars exist but only a few delegate.
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
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - 30;

  const positions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    nodeIds.forEach((id, i) => {
      const theta = (i / Math.max(nodeIds.length, 1)) * Math.PI * 2 - Math.PI / 2;
      m.set(id, { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
    });
    return m;
  }, [nodeIds, cx, cy, r]);

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

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="rounded-2xl border border-[var(--border-hairline)] bg-[var(--bg-raised)]/30"
      style={{ width: "100%", height: H }}
    >
      {edges.map((e, i) => {
        const a = positions.get(e.caller);
        const b = positions.get(e.callee);
        if (!a || !b) return null;
        const stroke = 1 + (e.count / maxCount) * 4;
        return (
          <g key={i}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--accent-presence)"
              strokeOpacity={0.45}
              strokeWidth={stroke}
              strokeLinecap="round"
            />
          </g>
        );
      })}
      {nodeIds.map((id) => {
        const f = familiars.find((x) => x.id === id);
        const p = positions.get(id)!;
        return (
          <g key={id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              fill="var(--bg-raised)"
              stroke="var(--accent-presence)"
              strokeOpacity={0.6}
            />
            <text
              x={p.x}
              y={p.y + 4}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="var(--text-primary)"
            >
              {(f?.display_name ?? id).slice(0, 1).toUpperCase()}
            </text>
            <text
              x={p.x}
              y={p.y + 28}
              textAnchor="middle"
              fontSize="9"
              fill="var(--text-secondary)"
            >
              {f?.display_name ?? id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

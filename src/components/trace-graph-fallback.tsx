"use client";

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
import type { DelegationGraph, DelegationGraphEdge } from "@/lib/coven-calls-types";
import type { Familiar } from "@/lib/types";

type Selection =
  | { kind: "edge"; key: string }
  | { kind: "node"; id: string }
  | { kind: "trace"; id: string }
  | null;

type Props = {
  graph: DelegationGraph;
  familiars: Map<string, Familiar>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Mirrors calls-view's local edgeKey so selection round-trips identically. */
  edgeKey: (edge: DelegationGraphEdge) => string;
};

function familiarName(familiars: Map<string, Familiar>, id: string): string {
  return familiars.get(id)?.display_name ?? id;
}

/**
 * 2D, dependency-free delegation view: the graph's edges rendered as a
 * selectable caller → callee list. (Replaced a Three.js 3D graph that was
 * removed to drop the heavy `three` dependency.)
 */
export function TraceGraphFallback({ graph, familiars, selection, onSelect, edgeKey }: Props) {
  const edges = useMemo(
    () => [...graph.edges].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    [graph.edges],
  );

  return (
    <section
      className="trace-graph-fallback flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]"
      aria-label="Delegation list"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
        <Icon name="ph:graph" width={13} aria-hidden />
        <span>Delegations</span>
      </header>
      {edges.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-[11px] text-[var(--text-muted)]">
          No delegations in this window.
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {edges.map((edge) => {
            const key = edgeKey(edge);
            const selected = selection?.kind === "edge" && selection.key === key;
            const tone = edge.hasRunning
              ? "var(--color-success)"
              : edge.latestStatus === "failed"
                ? "var(--color-danger)"
                : "var(--text-muted)";
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`trace-graph-fallback-row flex w-full items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2 text-left text-[12px] transition-colors last:border-b-0 ${
                    selected
                      ? "bg-[color-mix(in_oklch,var(--accent-presence)_14%,transparent)]"
                      : "hover:bg-[var(--bg-hover)]"
                  }`}
                  style={{ minHeight: "var(--touch-target)" }}
                  aria-pressed={selected}
                  onClick={() => onSelect({ kind: "edge", key })}
                >
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {familiarName(familiars, edge.caller)}
                  </span>
                  <Icon name="ph:arrow-right-bold" width={12} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                    {familiarName(familiars, edge.callee)}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
                    style={{ color: tone, background: "color-mix(in oklch, currentColor 14%, transparent)" }}
                  >
                    {edge.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

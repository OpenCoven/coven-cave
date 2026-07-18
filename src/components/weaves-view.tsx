"use client";
// Weaves view: composes the weave rail and thread pane over the Phase 4 read
// routes. Fail-closed composition rules (spec §4):
// - blocked envelope -> full-surface blocked state, never an empty-healthy list
// - stale/fixture banners render above the surfaces; nothing hides them
// - the trace drawer shows predicate evidence + source cursor for any pill
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { StrandInspector } from "@/components/strand-inspector";
import { ThreadPane } from "@/components/thread-pane";
import { WeaveMapCanvas } from "@/components/weave-map";
import { WeaveRail } from "@/components/weave-rail";
import type {
  AuditEntryView,
  DegradedFamiliarView,
  ProposalView,
  ThreadView,
  WeaveDetail,
  WeaveSummary,
  WeaveListEntry,
} from "@/lib/threads-read";
import {
  blockedMessage,
  railModel,
  surfaceStateFromPayload,
  traceForDegradedFamiliar,
  traceForTension,
  traceForWeave,
  type StatusTrace,
  type SurfaceState,
} from "@/lib/weave-rail";

async function fetchSurface<T>(url: string): Promise<SurfaceState<T>> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const payload: unknown = await res.json();
    return surfaceStateFromPayload<T>(payload);
  } catch {
    return {
      kind: "blocked",
      why: "daemon-unreachable",
      message: blockedMessage("daemon-unreachable"),
      meta: null,
    };
  }
}

function Banners({ state }: { state: SurfaceState<unknown> }) {
  if (state.kind !== "ready" || state.banners.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {state.banners.map((banner) => (
        <p
          key={banner.kind}
          role="status"
          className="flex items-center gap-2 rounded border border-dashed border-[var(--border-strong,#555)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--text-muted)]"
        >
          <Icon name={banner.kind === "stale" ? "ph:clock-countdown" : "ph:flask"} aria-hidden />
          {banner.message}
        </p>
      ))}
    </div>
  );
}

function BlockedSurface({ state }: { state: Extract<SurfaceState<unknown>, { kind: "blocked" }> }) {
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 rounded border border-[var(--border-strong,#555)] bg-[var(--bg-raised)] px-3 py-4"
    >
      <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
        <Icon name="ph:shield-slash" aria-hidden />
        Blocked — cannot verify
      </span>
      <p className="text-xs text-[var(--text-muted)]">{state.message}</p>
      {state.meta ? (
        <p className="text-[10px] text-[var(--text-muted)]">
          last attempt {state.meta.observedAt} · adapter {state.meta.adapter}
        </p>
      ) : null}
    </div>
  );
}

function TraceDrawer({ trace, onClose }: { trace: StatusTrace; onClose: () => void }) {
  return (
    <aside
      aria-label="Trace to source"
      className="rounded border border-[var(--border,#333)] bg-[var(--bg-raised)] px-3 py-2"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--text-primary)]">
          <Icon name="ph:path" aria-hidden />
          Trace to source
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trace"
          className="focus-ring rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:x" aria-hidden />
        </button>
      </header>
      <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-[var(--text-primary)]">
        {trace.evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">
        cursor {trace.source.cursor} · observed {trace.source.observedAt} · adapter {trace.source.adapter}
      </p>
    </aside>
  );
}

export function WeavesView() {
  const [railState, setRailState] = useState<SurfaceState<WeaveListEntry[]>>({ kind: "loading" });
  const [familiarFilter, setFamiliarFilter] = useState<string | null>(null);
  const [selectedWeaveId, setSelectedWeaveId] = useState<string | null>(null);
  const [paneState, setPaneState] = useState<SurfaceState<WeaveDetail> | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [trace, setTrace] = useState<StatusTrace | null>(null);
  const [proposalsState, setProposalsState] = useState<SurfaceState<ProposalView[]>>({ kind: "loading" });

  const loadRail = useCallback(async () => {
    setRailState(await fetchSurface<WeaveListEntry[]>("/api/weaves"));
  }, []);

  useEffect(() => {
    void loadRail();
    void fetchSurface<ProposalView[]>("/api/proposals").then(setProposalsState);
  }, [loadRail]);

  // Lineage annotation set: proposal ids that still resolve to staged files.
  // A blocked proposals read yields an empty set — unresolved-by-default is
  // the honest treatment when nothing can be verified (R7 leans fail-closed).
  const knownProposalIds = useMemo(() => {
    if (proposalsState.kind !== "ready") return new Set<string>();
    return new Set(
      proposalsState.data
        .map((p) => p.payload?.id)
        .filter((id): id is string => typeof id === "string"),
    );
  }, [proposalsState]);

  useEffect(() => {
    if (!selectedWeaveId) {
      setPaneState(null);
      return;
    }
    let cancelled = false;
    setPaneState({ kind: "loading" });
    void fetchSurface<WeaveDetail>(`/api/weaves/${encodeURIComponent(selectedWeaveId)}`).then((state) => {
      if (!cancelled) setPaneState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedWeaveId]);

  // Audit rows for the weave map's "touched" edges — one lazy fetch per
  // thread of the open weave. A blocked read contributes nothing (the map
  // simply shows fewer edges), never an invented edge.
  const [weaveAudit, setWeaveAudit] = useState<AuditEntryView[]>([]);
  useEffect(() => {
    if (paneState?.kind !== "ready") {
      setWeaveAudit([]);
      return;
    }
    let cancelled = false;
    void Promise.all(
      paneState.data.threads.map((thread) =>
        fetchSurface<AuditEntryView[]>(`/api/threads/${encodeURIComponent(thread.id)}/audit`).then(
          (state) => (state.kind === "ready" ? state.data : []),
        ),
      ),
    ).then((batches) => {
      if (!cancelled) setWeaveAudit(batches.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [paneState]);

  const onTraceWeave = useCallback(
    (weave: WeaveSummary) => {
      if (railState.kind === "ready") setTrace(traceForWeave(weave, railState.meta));
    },
    [railState],
  );

  const onTraceDegraded = useCallback(
    (degraded: DegradedFamiliarView) => {
      if (railState.kind === "ready") setTrace(traceForDegradedFamiliar(degraded, railState.meta));
    },
    [railState],
  );

  const onTraceThread = useCallback(
    (thread: ThreadView) => {
      if (paneState?.kind === "ready") setTrace(traceForTension(thread.tension, paneState.meta));
    },
    [paneState],
  );

  return (
    <div className="flex flex-col gap-3">
      {railState.kind === "ready" ? <Banners state={railState} /> : null}
      {trace ? <TraceDrawer trace={trace} onClose={() => setTrace(null)} /> : null}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          {railState.kind === "loading" ? (
            <p className="px-2 py-4 text-xs text-[var(--text-muted)]">Reading weave state…</p>
          ) : railState.kind === "blocked" ? (
            <BlockedSurface state={railState} />
          ) : (
            <WeaveRail
              {...railModel(railState.data)}
              familiarFilter={familiarFilter}
              selectedWeaveId={selectedWeaveId}
              meta={railState.meta}
              onSelect={(id) => {
                setSelectedThreadId(null);
                setSelectedWeaveId(id);
              }}
              onFilter={setFamiliarFilter}
              onTrace={onTraceWeave}
              onTraceDegraded={onTraceDegraded}
            />
          )}
        </div>
        <div className="min-w-0">
          {selectedWeaveId === null ? (
            <p className="px-2 py-4 text-xs text-[var(--text-muted)]">
              Select a weave to open its threads — each thread binds one protected surface to one
              writer.
            </p>
          ) : paneState === null || paneState.kind === "loading" ? (
            <p className="px-2 py-4 text-xs text-[var(--text-muted)]">Opening weave…</p>
          ) : paneState.kind === "blocked" ? (
            <BlockedSurface state={paneState} />
          ) : (
            <div className="flex flex-col gap-4">
              <WeaveMapCanvas
                threads={paneState.data.threads}
                audit={weaveAudit}
                proposals={proposalsState.kind === "ready" ? proposalsState.data : []}
                selectedThreadId={selectedThreadId}
                onSelectThread={(id) => setSelectedThreadId(id === selectedThreadId ? null : id)}
              />
              <ThreadPane
                weave={paneState.data}
                meta={paneState.meta}
                selectedThreadId={selectedThreadId}
                onSelectThread={(id) => setSelectedThreadId(id === selectedThreadId ? null : id)}
                onTraceThread={onTraceThread}
              />
              {selectedThreadId
                ? (() => {
                    const thread = paneState.data.threads.find((t) => t.id === selectedThreadId);
                    return thread ? (
                      <StrandInspector thread={thread} knownProposalIds={knownProposalIds} />
                    ) : null;
                  })()
                : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

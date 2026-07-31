"use client";
// Weaves view: composes the weave rail and thread pane over the Phase 4 read
// routes. Fail-closed composition rules (spec §4):
// - blocked envelope -> full-surface blocked state, never an empty-healthy list
// - stale/fixture banners render above the surfaces; nothing hides them
// - the trace drawer shows predicate evidence + source cursor for any pill
//
// Layout is a list+detail pair that fills the route: the rail scopes and
// selects, the detail pane answers "what is wrong with this weave and what
// does it cost me". Below the split breakpoint exactly one pane is on screen.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { ThreadPane } from "@/components/thread-pane";
import {
  BlockedSurface,
  SurfaceBanners,
  SurfaceSkeleton,
  ThreadsHeader,
} from "@/components/threads-chrome";
import { StatusPill, WeaveRail } from "@/components/weave-rail";
import { WeaveMapCanvas } from "@/components/weave-map";
import { proposalListModel } from "@/lib/proposal-flow";
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
  ALL_WEAVES_SCOPE,
  blockedMessage,
  matchesScope,
  pillForCoherence,
  railModel,
  shortHash,
  sortWeavesWorstFirst,
  surfaceStateFromPayload,
  traceForDegradedFamiliar,
  traceForTension,
  traceForWeave,
  weaveSummaryLine,
  weaveTallies,
  weaveStatus,
  type StatusTrace,
  type SurfaceState,
  type WeaveScope,
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

function TraceDrawer({ trace, onClose }: { trace: StatusTrace; onClose: () => void }) {
  return (
    <aside aria-label="Trace to source" className="wv-trace">
      <div className="wv-trace__head">
        <span className="wv-trace__title">
          <Icon name="ph:path" aria-hidden />
          Trace to source
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trace"
          className="wv-icon-btn focus-ring"
        >
          <Icon name="ph:x" aria-hidden />
        </button>
      </div>
      <ul className="wv-trace__list">
        {trace.evidence.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="wv-trace__src">
        cursor {trace.source.cursor} · observed {trace.source.observedAt} · adapter{" "}
        {trace.source.adapter}
      </p>
    </aside>
  );
}

export function WeavesView() {
  const [railState, setRailState] = useState<SurfaceState<WeaveListEntry[]>>({ kind: "loading" });
  const [scope, setScope] = useState<WeaveScope>(ALL_WEAVES_SCOPE);
  const [selectedWeaveId, setSelectedWeaveId] = useState<string | null>(null);
  const [paneState, setPaneState] = useState<SurfaceState<WeaveDetail> | null>(null);
  // Retrying a blocked weave read re-runs the same request, so the effect needs
  // a reason to fire again beyond the (unchanged) selected id.
  const [paneAttempt, setPaneAttempt] = useState(0);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [trace, setTrace] = useState<StatusTrace | null>(null);
  const [mapAsList, setMapAsList] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [narrowPane, setNarrowPane] = useState<"list" | "detail">("list");
  const [proposalsState, setProposalsState] = useState<SurfaceState<ProposalView[]>>({
    kind: "loading",
  });

  const loadRail = useCallback(async () => {
    setRailState({ kind: "loading" });
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

  // Threads with a staged write, and the proposal each one is waiting on. A
  // blocked read contributes nothing: no thread claims a decision is pending
  // unless the queue said so.
  const stagedByThread = useMemo(() => {
    const map = new Map<string, string>();
    if (proposalsState.kind !== "ready") return map;
    for (const proposal of proposalListModel(proposalsState.data).ok) {
      if (proposal.payload) map.set(proposal.payload.threadId, proposal.payload.id);
    }
    return map;
  }, [proposalsState]);

  const pendingCount =
    proposalsState.kind === "ready" ? proposalListModel(proposalsState.data).ok.length : null;

  useEffect(() => {
    if (!selectedWeaveId) {
      setPaneState(null);
      return;
    }
    let cancelled = false;
    setPaneState({ kind: "loading" });
    void fetchSurface<WeaveDetail>(`/api/weaves/${encodeURIComponent(selectedWeaveId)}`).then(
      (state) => {
        if (!cancelled) setPaneState(state);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedWeaveId, paneAttempt]);

  // Audit rows for the weave map's List view — one lazy fetch per thread of the
  // open weave. A blocked read contributes nothing (a row simply claims less
  // evidence), never an invented edge.
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

  const rail = railState.kind === "ready" ? railModel(railState.data) : null;

  // Deterministic default selection: the first row the rail actually shows —
  // worst-first under the current scope — so opening the surface lands on what
  // asks something of you rather than on an alphabetical first.
  const selected = useMemo(() => {
    if (!rail) return null;
    if (selectedWeaveId) return rail.weaves.find((w) => w.id === selectedWeaveId) ?? null;
    return sortWeavesWorstFirst(rail.weaves).find((weave) => matchesScope(weave, scope)) ?? null;
  }, [rail, selectedWeaveId, scope]);

  useEffect(() => {
    if (selectedWeaveId === null && selected) setSelectedWeaveId(selected.id);
  }, [selected, selectedWeaveId]);

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

  const openProposal = useCallback(
    (threadId: string) => {
      const proposalId = stagedByThread.get(threadId);
      if (!proposalId) return;
      window.location.href = `/proposals?proposal=${encodeURIComponent(proposalId)}`;
    },
    [stagedByThread],
  );

  const header = (
    <ThreadsHeader
      surface="weaves"
      pendingCount={pendingCount}
      listCollapsed={collapsed}
      onToggleList={() => setCollapsed((value) => !value)}
    />
  );

  if (railState.kind === "loading") {
    return (
      <div className="wv-page">
        {header}
        <SurfaceSkeleton split label="Reading weave state…" />
      </div>
    );
  }

  if (railState.kind === "blocked") {
    return (
      <div className="wv-page">
        {header}
        <BlockedSurface
          state={railState}
          title="Blocked — cannot verify"
          rule="Nothing is shown as healthy while the source is unverifiable. No weave state is cached or guessed."
          onRetry={() => void loadRail()}
        >
          <a className="wv-ghost focus-ring" href="/settings?tab=daemon">
            Open daemon settings
          </a>
        </BlockedSurface>
      </div>
    );
  }

  const entries = railState.data;
  const tallies = weaveTallies(entries, pendingCount ?? 0);
  const needsScopeFilter = entries.some((entry) => weaveStatus(entry) !== "healthy");

  return (
    <div className="wv-page">
      {header}
      <div className="wv-strip">
        <p className="wv-strip__lede">
          One familiar&apos;s enforced authority over its protected memory. Anything unverifiable
          renders blocked, never healthy.
        </p>
        <dl className="wv-tallies" aria-label="Integrity overview">
          {tallies.map((tally) => (
            // dt before dd in DOM order — the term defines the value, and
            // assistive tech reads the pair in source order. `order` on
            // .wv-tally__value/__label puts the number first visually.
            <div key={tally.key} className={`wv-tally wv-tally--${tally.key}`}>
              <dt className="wv-tally__label">{tally.label}</dt>
              <dd className="wv-tally__value">{tally.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <SurfaceBanners banners={railState.banners} />

      <div
        className="wv-grid"
        data-pane={narrowPane}
        data-collapsed={collapsed ? "true" : "false"}
      >
        <WeaveRail
          weaves={rail?.weaves ?? []}
          degraded={rail?.degraded ?? []}
          familiars={rail?.familiars ?? []}
          scope={scope}
          onScope={(next) => {
            setScope(next);
            setSelectedWeaveId(null);
          }}
          showStatusFilter={needsScopeFilter}
          selectedWeaveId={selected?.id ?? null}
          meta={railState.meta}
          onSelect={(id) => {
            setOpenThreadId(null);
            setTrace(null);
            setSelectedWeaveId(id);
            setNarrowPane("detail");
          }}
          onTraceDegraded={onTraceDegraded}
        />

        <section aria-label="Weave detail" className="wv-pane-detail">
          {selected === null ? (
            <div className="wv-center">
              <p className="wv-quiet">
                Select a weave to open its threads — each thread binds one protected surface to one
                writer.
              </p>
            </div>
          ) : paneState === null || paneState.kind === "loading" ? (
            <SurfaceSkeleton split={false} label="Opening weave…" />
          ) : paneState.kind === "blocked" ? (
            <>
              <div className="wv-detail-head">
                {narrowPane === "detail" ? (
                  <button
                    type="button"
                    className="wv-ghost wv-only-narrow focus-ring"
                    onClick={() => setNarrowPane("list")}
                  >
                    <Icon name="ph:arrow-left" aria-hidden />
                    Back
                  </button>
                ) : null}
                <div className="wv-detail-head__main">
                  <h2 className="wv-detail-title">{selected.familiarId}</h2>
                </div>
              </div>
              <BlockedSurface
                state={paneState}
                title="No threads can be listed"
                rule="An empty list here would read as “no threads to worry about”. There may be six. Cave will not say either way until this weave can be read."
                onRetry={() => setPaneAttempt((attempt) => attempt + 1)}
              />
            </>
          ) : (
            <>
              <div className="wv-detail-head">
                {narrowPane === "detail" ? (
                  <button
                    type="button"
                    className="wv-ghost wv-only-narrow focus-ring"
                    onClick={() => setNarrowPane("list")}
                    aria-label="Back to weaves"
                  >
                    <Icon name="ph:arrow-left" aria-hidden />
                  </button>
                ) : null}
                <div className="wv-detail-head__main">
                  <h2 className="wv-detail-title">
                    {paneState.data.familiarId}
                    <span className="wv-detail-hash">
                      weave {shortHash(paneState.data.weaveHash)}
                    </span>
                  </h2>
                  <p className="wv-detail-summary">{weaveSummaryLine(paneState.data)}</p>
                </div>
                <StatusPill pill={pillForCoherence(paneState.data.coherence)} />
                <button
                  type="button"
                  className="wv-ghost wv-ghost--sm focus-ring"
                  onClick={() => onTraceWeave(paneState.data)}
                >
                  <Icon name="ph:path" aria-hidden />
                  Trace to source
                </button>
              </div>

              <div className="wv-detail-body">
                {trace ? <TraceDrawer trace={trace} onClose={() => setTrace(null)} /> : null}

                <WeaveMapCanvas
                  threads={paneState.data.threads}
                  audit={weaveAudit}
                  proposals={proposalsState.kind === "ready" ? proposalsState.data : []}
                  asList={mapAsList}
                  onPresentation={setMapAsList}
                  blockedReason={
                    paneState.data.threads.length === 0 ? "no thread could be enumerated" : null
                  }
                />

                {paneState.data.patternDescriptor ? (
                  <aside aria-label="Pattern descriptor (derived)" className="wv-derived">
                    <span className="wv-derived__tag">Derived</span>
                    <p>
                      Pattern “{paneState.data.patternDescriptor.name}” names{" "}
                      {paneState.data.patternDescriptor.protectedSurfaces.join(", ") ||
                        "no surfaces"}{" "}
                      — a summary for legibility, never what decided. Every verdict above comes from
                      the predicate.
                    </p>
                  </aside>
                ) : null}

                {paneState.data.threads.length === 0 ? (
                  <div role="status" className="wv-inset-block">
                    <span className="wv-inset-block__title">
                      <Icon name="ph:shield-slash" aria-hidden />
                      No threads can be listed
                    </span>
                    <p className="wv-why-empty">
                      This weave reported no thread bindings. An empty list would read as “no
                      threads to worry about” — Cave says nothing either way until a binding is
                      verified.
                    </p>
                  </div>
                ) : (
                  <ThreadPane
                    weave={paneState.data}
                    openThreadId={openThreadId}
                    stagedThreadIds={new Set(stagedByThread.keys())}
                    knownProposalIds={knownProposalIds}
                    onToggleThread={(id) => setOpenThreadId(id === openThreadId ? null : id)}
                    onTraceThread={onTraceThread}
                    onOpenProposal={openProposal}
                  />
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

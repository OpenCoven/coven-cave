"use client";

/**
 * The Work scheduler — the `isWork` half of the Cody Code Reading v2 handoff
 * (cave-7c329). The room half landed as cave-0rcku / #4423.
 *
 * WHAT THIS SURFACE IS, AND WHAT IT IS NOT. The Board's Queue tab
 * (`familiar-work-queue-view.tsx`) already exists and is NOT this. That one is
 * PR triage: its lanes are pull-request states — checks failing, needs review,
 * ready to merge — and it answers "what is in flight and what does it need?".
 * This one is scheduling: its lanes are FAMILIARS, and it answers "who is
 * working, what is next for them, and what is stuck?". It is also the only
 * surface in the Cave that can see BLOCKED beads at all — `/api/beads` had no
 * mode for them before this change, so the blocked half of the tracker was
 * invisible to every UI. Neither surface should grow into the other; if one
 * day they should merge, that is an owner call, not drift.
 *
 * FIVE THINGS THE FRAME DRAWS THAT ARE DELIBERATELY NOT HERE. Each was cut
 * because rendering it would have asserted something the Cave cannot back:
 *
 *  1. DRAG REORDER. `bd` stores a priority band, not a rank, so a dragged
 *     position could not survive a reload. The row's Priority menu writes a
 *     real band instead (`POST /api/beads {action:"priority"}`), and the table
 *     order is a pure function of the tracker (`buildSchedulerQueue`).
 *  2. GATE APPROVAL. There is no approval backend anywhere in the Cave. A gate
 *     card routes to its blocker instead of offering an Approve button.
 *  3. LANE LOAD %. No familiar declares a capacity, so a load percentage has
 *     no denominator. The tile shows share OF THE QUEUE, labelled as such.
 *  4. UNDO ON REASSIGN. Reassign also sets the bead in progress, and no action
 *     restores the previous assignee and status — so the entry is recorded
 *     with the reason it cannot be reversed. Only priority offers an undo.
 *  5. PSYCHE. The frame reserves a slot marked "not connected · nothing is
 *     wired to it". A permanently dead slot teaches a reader to ignore part of
 *     the surface, and cannot even say what it would be. The reservation is
 *     recorded in docs/design-handoff/IMPLEMENTATION-STATUS.md instead.
 *
 * The session list is fetched here rather than taken from the room's context:
 * that context is familiar-scoped, and a lane strip built from it would report
 * "idle" for every familiar whose sessions were never fetched.
 */

import "@/styles/globals/surface-work-scheduler.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem, PopoverLabel, PopoverSeparator, PopoverSubmenu } from "@/components/ui/popover";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import { relativeTime } from "@/lib/relative-time";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import {
  PRIORITY_BANDS,
  UNASSIGNED_LANE_KEY,
  appendSchedulerLog,
  buildGateCards,
  buildSchedulerLanes,
  buildSchedulerQueue,
  deriveSchedulerStatus,
  gatePrimaryBasisText,
  markSchedulerLogUndone,
  priorityBand,
  priorityLogEntry,
  reassignLogEntry,
  undoRequestBody,
  type BlockedBead,
  type SchedulerBead,
  type SchedulerLogEntry,
  type SchedulerQueueRow,
} from "@/lib/work-scheduler";
import type { Familiar, SessionRow } from "@/lib/types";

const POLL_MS = 8000;
const RAIL_TABS = ["gates", "history", "bead"] as const;
type RailTab = (typeof RAIL_TABS)[number];

const RAIL_TAB_LABEL: Record<RailTab, string> = {
  gates: "Gates",
  history: "History",
  bead: "Bead",
};

/** Ten cells so a share reads at a glance without implying sub-percent precision. */
const METER_CELLS = 10;

type QueueProject = { id: string; name: string; root: string } | null;

type LoadState = {
  ready: SchedulerBead[];
  blocked: BlockedBead[];
  blockerRecords: SchedulerBead[];
  familiars: Familiar[];
  sessions: SessionRow[];
  sources: { queue: boolean; roster: boolean; gates: boolean };
  lastLoadedAtMs: number | null;
  project: QueueProject;
  projectMessage: string | null;
};

const EMPTY: LoadState = {
  ready: [],
  blocked: [],
  blockerRecords: [],
  familiars: [],
  sessions: [],
  sources: { queue: false, roster: false, gates: false },
  lastLoadedAtMs: null,
  project: null,
  projectMessage: null,
};

async function readJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  const json: unknown = await response.json();
  if (json && typeof json === "object" && (json as { ok?: boolean }).ok === false) {
    throw new Error((json as { error?: string }).error || `${url} failed`);
  }
  return json;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function CodeWorkScheduler({
  onJumpToSession,
}: {
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
}) {
  const [state, setState] = useState<LoadState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [railTab, setRailTab] = useState<RailTab>("gates");
  const [selectedBeadId, setSelectedBeadId] = useState<string | null>(null);
  const [beadDetail, setBeadDetail] = useState<{ id: string; body: unknown } | null>(null);
  const [log, setLog] = useState<SchedulerLogEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const { announce } = useAnnouncer();

  // Ages and the freshness read tick between polls; nothing else would move them.
  useMinuteTick();

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;

    try {
      const readiness = (await readJson("/api/queue/readiness", signal)) as {
        readiness?: { ok: boolean; message: string; project: QueueProject };
      };
      if (seq !== seqRef.current) return;
      const project = readiness.readiness?.project ?? null;
      if (!readiness.readiness?.ok || !project) {
        setState((prev) => ({
          ...EMPTY,
          project: null,
          projectMessage: readiness.readiness?.message ?? "No project selected.",
          // A previous good read stays visible; the status chip says it is stale.
          lastLoadedAtMs: prev.lastLoadedAtMs,
        }));
        return;
      }

      const query = `projectRoot=${encodeURIComponent(project.root)}`;
      const [queueResult, gatesResult, rosterResult, sessionsResult] = await Promise.allSettled([
        readJson(`/api/beads?mode=ready&${query}`, signal),
        readJson(`/api/beads?mode=blocked&${query}`, signal),
        readJson("/api/familiars", signal),
        readJson("/api/sessions/list?collapseFamiliarWorkspace=1", signal),
      ]);
      if (seq !== seqRef.current) return;

      const queueOk = queueResult.status === "fulfilled";
      const gatesOk = gatesResult.status === "fulfilled";
      // The roster half needs BOTH calls: a familiar list with no session list
      // cannot say what any lane is doing, and guessing "idle" is the lie.
      const rosterOk = rosterResult.status === "fulfilled" && sessionsResult.status === "fulfilled";

      setState((prev) => ({
        ready: queueOk
          ? asArray<SchedulerBead>((queueResult.value as { data?: unknown }).data)
          : prev.ready,
        blocked: gatesOk
          ? asArray<BlockedBead>((gatesResult.value as { data?: unknown }).data)
          : prev.blocked,
        blockerRecords: gatesOk
          ? asArray<SchedulerBead>((gatesResult.value as { blockers?: unknown }).blockers)
          : prev.blockerRecords,
        familiars: rosterOk
          ? asArray<Familiar>((rosterResult.value as { familiars?: unknown }).familiars)
          : prev.familiars,
        sessions: rosterOk
          ? asArray<SessionRow>((sessionsResult.value as { sessions?: unknown }).sessions)
          : prev.sessions,
        sources: { queue: queueOk, roster: rosterOk, gates: gatesOk },
        lastLoadedAtMs: queueOk ? Date.now() : prev.lastLoadedAtMs,
        project,
        projectMessage: null,
      }));
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      if (seq !== seqRef.current) return;
      setState((prev) => ({ ...prev, sources: { queue: false, roster: false, gates: false } }));
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);
  usePausablePoll(() => void load(), POLL_MS, { pauseWhileInputActive: true });

  const rows = useMemo(
    () => buildSchedulerQueue(state.ready, { familiars: state.familiars }),
    [state.ready, state.familiars],
  );
  const lanes = useMemo(
    () =>
      buildSchedulerLanes({
        familiars: state.familiars,
        sessions: state.sessions,
        sessionsKnown: state.sources.roster,
        rows,
      }),
    [state.familiars, state.sessions, state.sources.roster, rows],
  );
  const gates = useMemo(
    () => buildGateCards(state.blocked, state.blockerRecords),
    [state.blocked, state.blockerRecords],
  );
  const status = useMemo(
    () =>
      deriveSchedulerStatus({
        projectSelected: state.project !== null,
        sources: state.sources,
        lastLoadedAtMs: state.lastLoadedAtMs,
        nowMs: Date.now(),
        pollIntervalMs: POLL_MS,
      }),
    [state.project, state.sources, state.lastLoadedAtMs],
  );

  const selectedRow = rows.find((row) => row.bead.id === selectedBeadId) ?? null;

  // Bead detail is the tracker's own record, fetched on selection.
  useEffect(() => {
    if (!selectedBeadId || !state.project) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const json = (await readJson(
          `/api/beads?mode=show&id=${encodeURIComponent(selectedBeadId)}&projectRoot=${encodeURIComponent(state.project!.root)}`,
          controller.signal,
        )) as { data?: unknown };
        setBeadDetail({ id: selectedBeadId, body: json.data });
      } catch {
        setBeadDetail(null);
      }
    })();
    return () => controller.abort();
  }, [selectedBeadId, state.project]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/beads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error || "The tracker rejected that change.");
    },
    [],
  );

  const setPriority = useCallback(
    async (row: SchedulerQueueRow, priority: number) => {
      if (!state.project) return;
      setBusyId(row.bead.id);
      try {
        await post({ action: "priority", id: row.bead.id, priority, projectRoot: state.project.root });
        setLog((current) =>
          appendSchedulerLog(
            current,
            priorityLogEntry({
              id: `${row.bead.id}:${Date.now()}`,
              at: Date.now(),
              beadId: row.bead.id,
              beadTitle: row.bead.title,
              // The band we are moving FROM is the one the last read showed.
              previousPriority: Number.isInteger(row.bead.priority) ? row.bead.priority : null,
              priority,
            }),
          ),
        );
        announce(`${row.bead.id} set to ${priorityBand(priority).label}.`);
        await load();
      } catch (error) {
        announce(error instanceof Error ? error.message : "Could not set the priority.", "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, post, state.project],
  );

  const reassign = useCallback(
    async (row: SchedulerQueueRow, familiar: Familiar) => {
      if (!state.project) return;
      setBusyId(row.bead.id);
      try {
        await post({ action: "claim", id: row.bead.id, assignee: familiar.id, projectRoot: state.project.root });
        setLog((current) =>
          appendSchedulerLog(
            current,
            reassignLogEntry({
              id: `${row.bead.id}:${Date.now()}`,
              at: Date.now(),
              beadId: row.bead.id,
              beadTitle: row.bead.title,
              toLabel: familiar.display_name || familiar.id,
            }),
          ),
        );
        announce(`${row.bead.id} reassigned to ${familiar.display_name || familiar.id}.`);
        await load();
      } catch (error) {
        announce(error instanceof Error ? error.message : "Could not reassign the bead.", "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, post, state.project],
  );

  const undo = useCallback(
    async (entry: SchedulerLogEntry) => {
      if (!entry.undo || !state.project) return;
      setBusyId(entry.beadId);
      try {
        await post(undoRequestBody(entry.undo, state.project.root));
        setLog((current) => markSchedulerLogUndone(current, entry.id));
        announce(`Undone: ${entry.summary}.`);
        await load();
      } catch (error) {
        announce(error instanceof Error ? error.message : "Could not undo that.", "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, post, state.project],
  );

  const openBead = useCallback((id: string) => {
    setSelectedBeadId(id);
    setRailTab("bead");
  }, []);

  if (loading && state.lastLoadedAtMs === null && state.projectMessage === null) {
    return (
      <div className="wsch-root">
        <SkeletonRows count={6} />
      </div>
    );
  }

  return (
    <div className="wsch-root">
      <div className="wsch-head">
        <span className={`wsch-status wsch-status--${status.kind}`} title={status.detail}>
          <span className="wsch-status-dot" aria-hidden />
          {status.label}
        </span>
        <span className="wsch-head-detail">{status.detail}</span>
        {state.project ? <span className="wsch-head-project">{state.project.name}</span> : null}
      </div>

      {state.projectMessage ? (
        <EmptyState
          icon="ph:kanban"
          headline="No project to schedule"
          subtitle={state.projectMessage}
        />
      ) : (
        <>
          <LaneStrip lanes={lanes} rosterKnown={state.sources.roster} />
          <div className="wsch-body">
            <QueueTable
              rows={rows}
              familiars={state.familiars}
              busyId={busyId}
              queueOk={state.sources.queue}
              onOpenBead={openBead}
              onSetPriority={setPriority}
              onReassign={reassign}
            />
            <aside className="wsch-rail" aria-label="Scheduler rail">
              <div className="wsch-rail-tabs" role="tablist" aria-label="Scheduler rail sections">
                {RAIL_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={railTab === tab}
                    className={`focus-ring-inset wsch-rail-tab${railTab === tab ? " is-active" : ""}`}
                    onClick={() => setRailTab(tab)}
                  >
                    {RAIL_TAB_LABEL[tab]}
                    {tab === "gates" && gates.length > 0 ? (
                      <span className="wsch-rail-count">{gates.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="wsch-rail-body">
                {railTab === "gates" ? (
                  <GatesRail cards={gates} gatesOk={state.sources.gates} onOpenBead={openBead} />
                ) : null}
                {railTab === "history" ? (
                  <HistoryRail log={log} busyId={busyId} onUndo={undo} />
                ) : null}
                {railTab === "bead" ? (
                  <BeadRail
                    row={selectedRow}
                    id={selectedBeadId}
                    detail={beadDetail?.id === selectedBeadId ? beadDetail.body : null}
                    sessions={state.sessions}
                    onJumpToSession={onJumpToSession}
                  />
                ) : null}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

// ── lane strip ───────────────────────────────────────────────────────────────

function LaneStrip({
  lanes,
  rosterKnown,
}: {
  lanes: ReturnType<typeof buildSchedulerLanes>;
  rosterKnown: boolean;
}) {
  if (lanes.length === 0) {
    return (
      <p className="wsch-strip-empty">
        {rosterKnown ? "No familiars and nothing queued." : "The familiar roster could not be read."}
      </p>
    );
  }
  return (
    <ul className="wsch-strip" aria-label="Familiar lanes">
      {lanes.map((lane) => {
        const percent = Math.round(lane.shareOfQueue * 100);
        const filled = lane.shareOfQueue > 0 ? Math.min(METER_CELLS, Math.ceil(lane.shareOfQueue * METER_CELLS)) : 0;
        return (
          <li key={lane.key} className="wsch-lane">
            <span className="wsch-lane-initial" aria-hidden>
              {lane.name.charAt(0).toUpperCase()}
            </span>
            <div className="wsch-lane-main">
              <p className="wsch-lane-name">{lane.name}</p>
              {lane.presence ? (
                <p className="wsch-lane-state">
                  <span className={`wsch-lane-dot wsch-lane-dot--${lane.presence.state}`} aria-hidden />
                  {lane.presence.label}
                </p>
              ) : (
                <p className="wsch-lane-state wsch-lane-state--unknown">
                  {lane.key === UNASSIGNED_LANE_KEY ? "no familiar" : "state unknown"}
                </p>
              )}
              {/* Share OF THE QUEUE. Not load: nothing declares a capacity. */}
              <p className="wsch-lane-figure">
                {lane.queued} queued · {percent}% of queue
              </p>
              <span
                className="wsch-meter"
                role="img"
                aria-label={`${lane.queued} of the queue, ${percent} percent`}
              >
                {Array.from({ length: METER_CELLS }, (_, index) => (
                  <span
                    key={index}
                    className={`wsch-meter-cell${index < filled ? " is-filled" : ""}`}
                    aria-hidden
                  />
                ))}
              </span>
              {lane.note ? <p className="wsch-lane-note">{lane.note}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── queue table ──────────────────────────────────────────────────────────────

function QueueTable({
  rows,
  familiars,
  busyId,
  queueOk,
  onOpenBead,
  onSetPriority,
  onReassign,
}: {
  rows: SchedulerQueueRow[];
  familiars: Familiar[];
  busyId: string | null;
  queueOk: boolean;
  onOpenBead: (id: string) => void;
  onSetPriority: (row: SchedulerQueueRow, priority: number) => void;
  onReassign: (row: SchedulerQueueRow, familiar: Familiar) => void;
}) {
  return (
    <div className="wsch-queue">
      <p className="wsch-queue-caption">
        Ordered by priority band, then oldest update. There is no hand-rank —
        moving a row means changing its priority, which the tracker stores.
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon="ph:list-checks"
          headline={queueOk ? "Nothing ready" : "Queue unavailable"}
          subtitle={
            queueOk
              ? "Every ready bead has been picked up, or the tracker has none."
              : "The last read of the ready queue failed. Nothing is shown rather than a stale guess."
          }
        />
      ) : (
        <table className="wsch-table">
          <caption className="wsch-sr">Ready beads, ordered by priority band then oldest update</caption>
          <thead>
            <tr>
              <th scope="col" title="Position under the sort above. Derived on read; nothing stores it.">
                #
              </th>
              <th scope="col">Bead</th>
              <th scope="col">Task</th>
              <th scope="col">Familiar</th>
              <th scope="col">Priority</th>
              <th scope="col">
                <span className="wsch-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.bead.id} className={busyId === row.bead.id ? "is-busy" : undefined}>
                <td className="wsch-cell-pos">{row.position}</td>
                <td>
                  <button
                    type="button"
                    className="focus-ring wsch-bead-link"
                    onClick={() => onOpenBead(row.bead.id)}
                  >
                    {row.bead.id}
                  </button>
                </td>
                <td className="wsch-cell-task">{row.bead.title}</td>
                <td className="wsch-cell-familiar">{row.familiarLabel}</td>
                <td>
                  <span className={`wsch-band wsch-band--${row.band.value}`}>{row.band.label}</span>
                </td>
                <td className="wsch-cell-actions">
                  <OverflowMenu ariaLabel={`Actions for ${row.bead.id}`} disabled={busyId === row.bead.id}>
                    <PopoverItem icon="ph:arrow-square-out" onSelect={() => onOpenBead(row.bead.id)}>
                      Open bead
                    </PopoverItem>
                    <PopoverSeparator />
                    <PopoverSubmenu icon="ph:flag" label="Priority">
                      <PopoverLabel>Stored on the bead</PopoverLabel>
                      {PRIORITY_BANDS.map((band) => (
                        <PopoverItem
                          key={band.value}
                          checked={row.bead.priority === band.value}
                          onSelect={() => onSetPriority(row, band.value)}
                        >
                          {band.label}
                        </PopoverItem>
                      ))}
                    </PopoverSubmenu>
                    <PopoverSubmenu icon="ph:user" label="Reassign" disabled={familiars.length === 0}>
                      <PopoverLabel>Claims the bead on their behalf</PopoverLabel>
                      {familiars.map((familiar) => (
                        <PopoverItem
                          key={familiar.id}
                          checked={row.familiarId === familiar.id}
                          onSelect={() => onReassign(row, familiar)}
                        >
                          {familiar.display_name || familiar.id}
                        </PopoverItem>
                      ))}
                    </PopoverSubmenu>
                  </OverflowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── gates rail ───────────────────────────────────────────────────────────────

function GatesRail({
  cards,
  gatesOk,
  onOpenBead,
}: {
  cards: ReturnType<typeof buildGateCards>;
  gatesOk: boolean;
  onOpenBead: (id: string) => void;
}) {
  if (!gatesOk) {
    return (
      <EmptyState
        icon="ph:warning-circle"
        headline="Gates unavailable"
        subtitle="The blocked-bead read failed on the last pass. No gate cards are shown rather than stale ones."
      />
    );
  }
  if (cards.length === 0) {
    return <EmptyState icon="ph:list-checks" headline="Nothing blocked" subtitle="No bead is waiting on another." />;
  }
  return (
    <ul className="wsch-gates">
      {cards.map((card) => (
        <li key={card.bead.id} className="wsch-gate">
          <div className="wsch-gate-head">
            <button type="button" className="focus-ring wsch-bead-link" onClick={() => onOpenBead(card.bead.id)}>
              {card.bead.id}
            </button>
            <span className={`wsch-band wsch-band--${priorityBand(card.bead.priority).value}`}>
              {priorityBand(card.bead.priority).label}
            </span>
          </div>
          <p className="wsch-gate-title">{card.bead.title}</p>
          <p className="wsch-gate-label">
            Blocked by {card.blockers.length}
            {card.unnamed > 0 ? ` · ${card.unnamed} could not be named` : ""}
          </p>
          <ul className="wsch-gate-blockers">
            {card.blockers.map((blocker) => (
              <li key={blocker.id} className={blocker.id === card.primary?.id ? "is-primary" : undefined}>
                <button type="button" className="focus-ring wsch-bead-link" onClick={() => onOpenBead(blocker.id)}>
                  {blocker.id}
                </button>{" "}
                {blocker.title ?? <span className="wsch-gate-unnamed">name unavailable</span>}
                {blocker.itselfBlocked ? <span className="wsch-gate-chip">also blocked</span> : null}
              </li>
            ))}
          </ul>
          {card.primaryBasis ? <p className="wsch-gate-basis">{gatePrimaryBasisText(card.primaryBasis)}</p> : null}
          {/*
            The frame draws an Approve button here. There is no approval backend
            in the Cave, so the honest action is the one that exists: go to the
            thing that is actually holding this bead.
          */}
          {card.route ? (
            <button
              type="button"
              className="focus-ring wsch-gate-route"
              onClick={() => onOpenBead(card.route!.beadId)}
            >
              <Icon name="ph:caret-right" width={12} height={12} aria-hidden />
              {card.route.label}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ── history rail ─────────────────────────────────────────────────────────────

function HistoryRail({
  log,
  busyId,
  onUndo,
}: {
  log: SchedulerLogEntry[];
  busyId: string | null;
  onUndo: (entry: SchedulerLogEntry) => void;
}) {
  if (log.length === 0) {
    return (
      <EmptyState
        icon="ph:clock-counter-clockwise"
        headline="Nothing yet"
        subtitle="Changes you make here are listed as you make them. The log is this session only — it is not a tracker audit trail."
      />
    );
  }
  return (
    <ul className="wsch-history">
      {log.map((entry) => (
        <li key={entry.id} className={`wsch-history-row${entry.undone ? " is-undone" : ""}`}>
          <p className="wsch-history-summary">{entry.summary}</p>
          <p className="wsch-history-bead">
            {entry.beadId} · {entry.beadTitle}
          </p>
          <p className="wsch-history-when">{relativeTime(new Date(entry.at).toISOString())}</p>
          {/*
            An undo is offered ONLY when firing it genuinely reverses the change.
            Everything else prints the reason instead of a control that would
            look the same and do nothing.
          */}
          {entry.undo ? (
            <button
              type="button"
              className="focus-ring wsch-history-undo"
              disabled={busyId === entry.beadId}
              onClick={() => onUndo(entry)}
            >
              <Icon name="ph:arrow-counter-clockwise" width={12} height={12} aria-hidden />
              Undo
            </button>
          ) : (
            <p className="wsch-history-locked">
              <Icon name="ph:lock-simple" width={12} height={12} aria-hidden />
              {entry.irreversible}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── bead rail ────────────────────────────────────────────────────────────────

function beadRecord(detail: unknown): Record<string, unknown> | null {
  if (Array.isArray(detail)) return (detail[0] as Record<string, unknown>) ?? null;
  if (detail && typeof detail === "object") return detail as Record<string, unknown>;
  return null;
}

function textField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function BeadRail({
  row,
  id,
  detail,
  sessions,
  onJumpToSession,
}: {
  row: SchedulerQueueRow | null;
  id: string | null;
  detail: unknown;
  sessions: SessionRow[];
  onJumpToSession?: (sessionId: string, familiarId?: string | null) => void;
}) {
  if (!id) {
    return (
      <EmptyState
        icon="ph:circle-dashed"
        headline="No bead selected"
        subtitle="Pick a bead id from the queue or a gate card to read its record."
      />
    );
  }
  const record = beadRecord(detail);
  const title = textField(record, "title") ?? row?.bead.title ?? null;
  const assignee = textField(record, "assignee") ?? row?.bead.assignee ?? null;
  const status = textField(record, "status") ?? row?.bead.status ?? null;
  const running = assignee
    ? sessions.find(
        (session) =>
          !session.archived_at &&
          session.status === "running" &&
          (session.familiarId ?? "").toLowerCase() === assignee.toLowerCase(),
      )
    : undefined;

  return (
    <div className="wsch-bead">
      <p className="wsch-bead-id">{id}</p>
      {title ? <p className="wsch-bead-title">{title}</p> : null}
      <dl className="wsch-bead-fields">
        {status ? (
          <>
            <dt>Status</dt>
            <dd>{status}</dd>
          </>
        ) : null}
        {assignee ? (
          <>
            <dt>Assignee</dt>
            <dd>{assignee}</dd>
          </>
        ) : null}
        {row ? (
          <>
            <dt>Priority</dt>
            <dd>{row.band.label}</dd>
          </>
        ) : null}
      </dl>
      {textField(record, "description") ? (
        <p className="wsch-bead-body">{textField(record, "description")}</p>
      ) : null}
      {textField(record, "design") ? (
        <>
          <p className="wsch-bead-label">Design</p>
          <p className="wsch-bead-body">{textField(record, "design")}</p>
        </>
      ) : null}
      {record === null ? (
        <p className="wsch-bead-note">The tracker record for this bead has not loaded.</p>
      ) : null}
      {running && onJumpToSession ? (
        <button
          type="button"
          className="focus-ring wsch-bead-session"
          onClick={() => onJumpToSession(running.id, running.familiarId)}
        >
          <Icon name="ph:caret-right" width={12} height={12} aria-hidden />
          Open {assignee}&rsquo;s running session
        </button>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Navigator Surface — the Chart Room.
 *
 * Course-plotting over the Cave's real board. Every step in this room is a real
 * card from `/api/board`, every lane is a real board lane, and every move is a
 * real write. The one thing the board does not record is which step *waits on*
 * which, so that lives as the operator's chart overlay in the room's own
 * surface state and is drawn over the cards.
 *
 * Four readings of the same work — Flow (the lanes), Graph (dependency depth),
 * Orchestration (who and what it draws on), Table (sortable, editable, plus a
 * gantt and a board) — and one thing that is not a reading of it at all:
 * Decisions, the cards flagged as waiting on a person.
 *
 * Panels with no backing data say so. The room never renders an example.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon, type IconName } from "@/lib/icon";
import type { Card, CardStatus } from "@/lib/cave-board-types";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { useLatestAsyncData } from "@/lib/use-role-surfaces";
import { relativeTime } from "@/lib/relative-time";
import { publishBoardChanged } from "@/lib/board-cache-events";
import { useFocusTrap } from "@/lib/use-focus-trap";
import {
  SurfaceCanvas,
  SurfaceEmpty,
  SurfaceError,
  SurfaceLoading,
  SurfaceRoom,
} from "./surface-room";
import { NAVIGATOR_SURFACE_ID } from "./ids";
import { ChartDot } from "./chart-room-parts";
import { ChartRoomBand, type BandPanelId, type ProjectProgress } from "./chart-room-band";
import { ChartRoomChain, type ChainShape } from "./chart-room-chain";
import { ChartRoomDecisions } from "./chart-room-decisions";
import { ChartRoomFlow, type FlowDrag } from "./chart-room-flow";
import { ChartRoomGraph, type RouteVisibility } from "./chart-room-graph";
import { ChartRoomOrchestration } from "./chart-room-orchestration";
import { ChartRoomTable, type TableMode } from "./chart-room-table";
import { ChartRoomStepSheet } from "./chart-room-step-sheet";
import {
  CHART_STAGES,
  EMPTY_OVERLAY,
  chainOf,
  chainSummary,
  chartProposals,
  decisionsOwed,
  dependencyDepth,
  filterSteps,
  flowLayout,
  forgetStep,
  graphLayout,
  lockedSteps,
  normalizeOverlay,
  routeSet,
  setDependency,
  sortSteps,
  stageName,
  toChartSteps,
  type ChartCapability,
  type ChartLock,
  type ChartOverlay,
  type ChartProposal,
  type ChartProposalAction,
  type ChartSortKey,
  type ChartStageId,
  type ChartStateFilter,
  type ChartStep,
} from "./chart-room-model";
import "@/styles/globals/surface-chart-room.css";

const COLUMN_GAP = 24;
const NODE_HEIGHT = 100;
const NODE_GAP = 8;
const NODE_EXPANDED = NODE_HEIGHT + 78;
const GRAPH_NODE_W = 208;
const GRAPH_NODE_H = 96;

export type ChartRoomLens = "flow" | "graph" | "orch" | "list" | "decisions";

export type NavigatorState = {
  /** Project ids the room is scoped to; empty means every project. */
  scope: string[];
  lens: ChartRoomLens;
  tableMode: TableMode;
  selectedId: string | null;
  drawerOpen: boolean;
  helpOpen: boolean;
  briefOpen: boolean;
  bandPanel: BandPanelId | null;
  expandedNodes: string[];
  collapsedColumns: ChartStageId[];
  dismissedProposals: string[];
  /** The operator's chart: which card waits on which. */
  overlay: ChartOverlay;
  /** Latest lane counts — read by the registration manifest's status chip. */
  lastCounts: { running: number; blocked: number } | null;
};

export const NAVIGATOR_INITIAL_STATE: NavigatorState = {
  scope: [],
  lens: "flow",
  tableMode: "table",
  selectedId: null,
  drawerOpen: false,
  helpOpen: false,
  briefOpen: false,
  bandPanel: "owed",
  expandedNodes: [],
  collapsedColumns: [],
  dismissedProposals: [],
  overlay: EMPTY_OVERLAY,
  lastCounts: null,
};

const LANE_LABELS: Record<CardStatus, string> = {
  backlog: "Backlog",
  inbox: "Inbox",
  running: "Underway",
  review: "Review",
  blocked: "Blocked",
  done: "Done",
};

const LENSES: Array<{ id: ChartRoomLens; label: string }> = [
  { id: "flow", label: "Flow" },
  { id: "graph", label: "Graph" },
  { id: "orch", label: "Orchestration" },
  { id: "list", label: "Table" },
];

const HELP: Record<ChartRoomLens, Array<[IconName, string, string]>> = {
  flow: [
    ["ph:link", "Link a dependency", "Drag the dot on a step's right edge onto whatever waits on it."],
    ["ph:cursor-click", "Trace a chain", "Hover a step to light its whole chain; click to open it."],
    ["ph:arrows-left-right", "Move it", "Inside a step, walk the lane carousel. Every move writes the real card."],
    ["ph:caret-down", "See more", "Every step has a more toggle — what to do with it, without leaving the board."],
    ["ph:corners-out", "Run it wide", "Expand hides the briefing and gives the chart the whole room."],
    ["ph:arrow-arc-left", "Take it back", "Undo reverses the last chart edit or lane move. ⌘Z works too."],
  ],
  graph: [
    ["ph:columns", "Read the columns", "Laid out by dependency depth, not lane — column one can start today."],
    ["ph:cursor-click", "Trace, don't open", "A click lights the chain and dims the rest; the chain strip is the drilldown."],
    ["ph:steps", "Break it into steps", "The strip above shows the route root-first, and where it is held."],
    ["ph:hand-grabbing", "Pan and zoom", "Drag the background; Fit re-centres the whole graph."],
    ["ph:arrow-u-up-left", "Backwards edges", "A dotted edge means the flow runs the wrong way — a planning smell."],
    ["ph:arrows-out-simple", "Open a step", "Open step in the chain strip pulls up the full sheet."],
  ],
  orch: [
    ["ph:lock-simple", "Lock the map", "Click any node — familiar, step, capability, or something owed — to focus on it."],
    ["ph:arrows-down-up", "Lanes regroup", "Locking gathers the focused subgraph at the top of every lane."],
    ["ph:cursor-click", "Open a step", "Double-click any step node."],
    ["ph:wrench", "Real capabilities", "A card's own labels naming a real workflow or skill. Nothing is inferred."],
    ["ph:hand-palm", "Owed by you", "The last lane is every card flagged as waiting on a person."],
  ],
  list: [
    ["ph:arrows-down-up", "Sort", "Click a column header to sort; click again to reverse it."],
    ["ph:funnel", "Filter", "By text, or narrow to what needs you, what's linked, late, or running."],
    ["ph:pencil-simple", "Edit in place", "Project, lane, title and owner write the card. Waits on writes the chart."],
    ["ph:arrows-out-simple", "Open a step", "The expand icon on a row opens the full step."],
  ],
  decisions: [
    ["ph:scales", "What lands here", "Every card flagged as needing a human, most-blocking first."],
    ["ph:check", "Answering it", "Mark answered clears the flag on the real card, for every surface."],
    ["ph:note", "Framing", "The card's own notes. Where it has none, the ledger says so instead of inventing one."],
  ],
};

type UndoEntry =
  | { kind: "overlay"; overlay: ChartOverlay; label: string }
  | { kind: "stage"; id: string; stage: ChartStageId; label: string };

type AuditEntry = { id: string; iconName: IconName; text: string };

export function NavigatorSurface({ context }: { context: RoleSurfaceContext }) {
  const familiarId = context.activeFamiliar.id;
  const [state, patch] = useRoleSurfaceState<NavigatorState>(
    familiarId,
    NAVIGATOR_SURFACE_ID,
    NAVIGATOR_INITIAL_STATE,
  );
  const { announce } = useAnnouncer();

  // ── Sources ────────────────────────────────────────────────────────────────

  const fetchBoard = useCallback(async () => {
    const res = await fetch("/api/board", { cache: "no-store" });
    const json = res.ok ? ((await res.json()) as { ok?: boolean; cards?: Card[] }) : null;
    if (!json?.ok || !Array.isArray(json.cards)) throw new Error("bad response");
    return json.cards;
  }, []);
  const {
    data: cards,
    error: boardError,
    reload: loadBoard,
  } = useLatestAsyncData<Card[]>({
    scopeKey: familiarId,
    load: fetchBoard,
    errorMessage: "Couldn't load the board.",
  });

  const [projects, setProjects] = useState<CaveProject[]>([]);
  const [familiars, setFamiliars] = useState<Array<{ id: string; name: string; role?: string }>>([]);
  const [capabilities, setCapabilities] = useState<ChartCapability[]>([]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; projects?: CaveProject[] };
        if (live && json.ok && Array.isArray(json.projects)) setProjects(json.projects);
      } catch {
        /* the room still charts; a card's project falls back to its own id */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/familiars", { cache: "no-store" });
        const json = (await res.json()) as {
          ok?: boolean;
          familiars?: Array<{ id: string; name: string; role?: string }>;
        };
        if (live && json.ok && Array.isArray(json.familiars)) setFamiliars(json.familiars);
      } catch {
        /* the owner lane stays empty rather than inventing a roster */
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Capabilities are the repo's real workflows and skills. A card only links to
  // one when its own labels name it — nothing here is inferred.
  useEffect(() => {
    let live = true;
    void (async () => {
      const found: ChartCapability[] = [];
      try {
        const res = await fetch("/api/workflows", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; workflows?: Array<{ id: string; name?: string }> };
        for (const workflow of json.workflows ?? []) {
          found.push({ id: `workflow:${workflow.id}`, kind: "workflow", name: workflow.name ?? workflow.id });
        }
      } catch {
        /* no workflows reachable — the capability lane renders empty */
      }
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; skills?: Array<{ id?: string; name?: string }> };
        for (const skill of json.skills ?? []) {
          const name = skill.name ?? skill.id;
          if (name) found.push({ id: `skill:${name}`, kind: "skill", name });
        }
      } catch {
        /* same */
      }
      if (live) setCapabilities(found);
    })();
    return () => {
      live = false;
    };
  }, []);

  // ── Derived chart ──────────────────────────────────────────────────────────

  const today = new Date().toISOString().slice(0, 10);
  const liveIds = useMemo(() => (cards ?? []).map((card) => card.id), [cards]);

  // Cards get archived and deleted underneath the chart, so every read prunes
  // edges that no longer point at a real card rather than drawing to nowhere.
  const overlay = useMemo(() => normalizeOverlay(state.overlay, liveIds), [state.overlay, liveIds]);

  const allSteps = useMemo(() => toChartSteps(cards ?? [], overlay, today), [cards, overlay, today]);
  const scoped = useMemo(
    () =>
      state.scope.length === 0
        ? allSteps
        : allSteps.filter((step) => step.project != null && state.scope.includes(step.project)),
    [allSteps, state.scope],
  );

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const familiarById = useMemo(() => new Map(familiars.map((familiar) => [familiar.id, familiar])), [familiars]);
  const projectName = useCallback(
    (id: string | null) => (id == null ? "no project" : (projectById.get(id)?.name ?? id)),
    [projectById],
  );
  const projectColor = useCallback(
    (id: string | null) => (id == null ? null : (projectById.get(id)?.color ?? null)),
    [projectById],
  );
  const ownerName = useCallback(
    (id: string | null) => (id == null ? "unassigned" : (familiarById.get(id)?.name ?? id)),
    [familiarById],
  );

  const proposals = useMemo(
    () => chartProposals(scoped).filter((proposal) => !state.dismissedProposals.includes(proposal.id)),
    [scoped, state.dismissedProposals],
  );
  const decisions = useMemo(() => decisionsOwed(scoped), [scoped]);
  const overdueCount = useMemo(() => scoped.filter((step) => step.state === "overdue").length, [scoped]);

  useEffect(() => {
    if (cards == null) return;
    patch({
      lastCounts: {
        running: cards.filter((card) => card.status === "running").length,
        blocked: cards.filter((card) => card.status === "blocked").length,
      },
    });
  }, [cards, patch]);

  // ── Ephemeral room state ───────────────────────────────────────────────────

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [drag, setDrag] = useState<FlowDrag | null>(null);
  const [history, setHistory] = useState<UndoEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [answered, setAnswered] = useState<Array<{ id: string; title: string }>>([]);
  const [flipped, setFlipped] = useState<BandPanelId | null>(null);
  const [owedIndex, setOwedIndex] = useState(0);
  const [openDecision, setOpenDecision] = useState<string | null>(null);
  const [chainShape, setChainShape] = useState<ChainShape>("strip");
  const [chainOpen, setChainOpen] = useState(true);
  const [traceOnly, setTraceOnly] = useState(false);
  const [routeVisibility, setRouteVisibility] = useState<RouteVisibility>("dim");
  const [focusMode, setFocusMode] = useState(false);
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [lock, setLock] = useState<ChartLock | null>(null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ChartStateFilter>("all");
  const [sortKey, setSortKey] = useState<ChartSortKey>("stage");
  const [sortDirection, setSortDirection] = useState<1 | -1>(1);
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
  const [graphPanning, setGraphPanning] = useState(false);
  const [upstreamPickerOpen, setUpstreamPickerOpen] = useState(false);
  const [downstreamPickerOpen, setDownstreamPickerOpen] = useState(false);
  const [logSection, setLogSection] = useState<"done" | "edits" | "answered" | null>("done");
  const [openDone, setOpenDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [flowWidth, setFlowWidth] = useState(0);
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});

  const canvasElRef = useRef<HTMLDivElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A monotonic id, not the text: the same move made twice is two entries, and
  // two rows keyed alike would make React reuse one of them.
  const auditSeq = useRef(0);
  const note = useCallback((iconName: IconName, text: string) => {
    auditSeq.current += 1;
    setAudit((entries) => [{ id: `edit-${auditSeq.current}`, iconName, text }, ...entries].slice(0, 12));
  }, []);

  // ── Chart writes (the overlay) ─────────────────────────────────────────────

  const writeOverlay = useCallback(
    (next: ChartOverlay, label: string, iconName: IconName) => {
      setHistory((entries) => [{ kind: "overlay" as const, overlay, label }, ...entries].slice(0, 25));
      patch({ overlay: next });
      note(iconName, label);
    },
    [note, overlay, patch],
  );

  const linkSteps = useCallback(
    (stepId: string, needs: string | null) => {
      const step = allSteps.find((entry) => entry.id === stepId);
      const target = needs == null ? null : allSteps.find((entry) => entry.id === needs);
      if (!step) return;
      writeOverlay(
        setDependency(overlay, stepId, needs),
        needs == null
          ? `Unlinked “${step.title}”`
          : `Linked — “${step.title}” now waits on “${target?.title ?? needs}”`,
        needs == null ? "ph:scissors" : "ph:link",
      );
      announce(
        needs == null
          ? `Unlinked ${step.title}.`
          : `${step.title} now waits on ${target?.title ?? "another step"}.`,
      );
    },
    [allSteps, announce, overlay, writeOverlay],
  );

  // ── Board writes (real cards) ──────────────────────────────────────────────

  const patchCard = useCallback(
    async (id: string, body: Record<string, unknown>, success: string, failure: string) => {
      setSaving(true);
      setWriteError(null);
      try {
        const res = await fetch(`/api/board/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        publishBoardChanged();
        await loadBoard({ retainData: true });
        announce(success);
        return true;
      } catch {
        setWriteError(failure);
        announce(failure, "assertive");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [announce, loadBoard],
  );

  const moveStage = useCallback(
    async (id: string, stage: ChartStageId, options?: { record?: boolean }) => {
      const step = allSteps.find((entry) => entry.id === id);
      if (!step || step.stage === stage) return;
      if (options?.record !== false) {
        setHistory((entries) =>
          [
            {
              kind: "stage" as const,
              id,
              stage: step.stage,
              label: `Moved “${step.title}” to ${stageName(stage)}`,
            },
            ...entries,
          ].slice(0, 25),
        );
      }
      const ok = await patchCard(
        id,
        { status: stage },
        `Moved "${step.title}" to ${LANE_LABELS[stage]}.`,
        "Move failed — the board didn't accept the change.",
      );
      if (ok) note("ph:arrows-left-right", `Moved “${step.title}” to ${stageName(stage)}`);
    },
    [allSteps, note, patchCard],
  );

  const answerDecision = useCallback(
    async (id: string) => {
      const step = allSteps.find((entry) => entry.id === id);
      if (!step) return;
      const ok = await patchCard(
        id,
        { needsHuman: false },
        `Marked "${step.title}" answered.`,
        "Couldn't mark it answered — the board didn't accept the change.",
      );
      if (ok) {
        setAnswered((entries) => [{ id, title: step.title }, ...entries].slice(0, 12));
        note("ph:check", `Answered “${step.title}”`);
        setOpenDecision(null);
        setOwedIndex(0);
      }
    },
    [allSteps, note, patchCard],
  );

  const addStep = useCallback(
    async (stage: ChartStageId) => {
      if (adding) return;
      setAdding(true);
      setWriteError(null);
      try {
        const res = await fetch("/api/board", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "New step",
            familiarId,
            status: stage,
            projectId: state.scope.length === 1 ? state.scope[0] : undefined,
          }),
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const json = (await res.json()) as { ok?: boolean; card?: Card };
        publishBoardChanged();
        await loadBoard({ retainData: true });
        if (json.card?.id) patch({ selectedId: json.card.id });
        note("ph:plus", `Charted a step in ${stageName(stage)}`);
        announce(`Charted a step in ${LANE_LABELS[stage]}.`);
      } catch {
        const message = "Couldn't chart the step — the board didn't accept it.";
        setWriteError(message);
        announce(message, "assertive");
      } finally {
        setAdding(false);
      }
    },
    [adding, announce, familiarId, loadBoard, note, patch, state.scope],
  );

  const removeStep = useCallback(
    async (id: string) => {
      const step = allSteps.find((entry) => entry.id === id);
      if (!step) return;
      setSaving(true);
      setWriteError(null);
      try {
        const res = await fetch(`/api/board/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        publishBoardChanged();
        patch({ overlay: forgetStep(overlay, id), selectedId: null });
        await loadBoard({ retainData: true });
        note("ph:trash", `Removed “${step.title}”`);
        announce(`Removed "${step.title}" from the board.`);
      } catch {
        const message = "Couldn't remove it — the board didn't accept the change.";
        setWriteError(message);
        announce(message, "assertive");
      } finally {
        setSaving(false);
      }
    },
    [allSteps, announce, loadBoard, note, overlay, patch],
  );

  // Title edits coalesce: typing sends one write when you stop, not one per key.
  const editTitle = useCallback(
    (id: string, title: string) => {
      setTitleDrafts((drafts) => ({ ...drafts, [id]: title }));
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = setTimeout(() => {
        void patchCard(id, { title }, "Renamed the step.", "Rename failed — the board didn't accept it.").then(
          () =>
            setTitleDrafts((drafts) => {
              const next = { ...drafts };
              delete next[id];
              return next;
            }),
        );
      }, 700);
    },
    [patchCard],
  );
  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    [],
  );

  const withDraftTitles = useCallback(
    (steps: readonly ChartStep[]): ChartStep[] =>
      steps.map((step) => {
        const draft = titleDrafts[step.id];
        return draft === undefined ? step : { ...step, title: draft };
      }),
    [titleDrafts],
  );

  const undo = useCallback(() => {
    const [entry, ...rest] = history;
    if (!entry) return;
    setHistory(rest);
    if (entry.kind === "overlay") {
      patch({ overlay: entry.overlay });
      note("ph:arrow-arc-left", `Undid — ${entry.label}`);
      announce("Undid the last chart edit.");
    } else {
      void moveStage(entry.id, entry.stage, { record: false });
      note("ph:arrow-arc-left", `Undid — ${entry.label}`);
    }
  }, [announce, history, moveStage, note, patch]);

  const applyAction = useCallback(
    (action: ChartProposalAction) => {
      if (action.type === "cut-dependency") {
        linkSteps(action.stepId, null);
        return;
      }
      if (action.type === "move-stage") {
        void moveStage(action.stepId, action.stage);
        return;
      }
      patch({ lens: "flow", selectedId: action.stepId });
      setTraceOnly(false);
      setChainOpen(true);
    },
    [linkSteps, moveStage, patch],
  );

  // ── Selection, hover, route ────────────────────────────────────────────────

  const selected = useMemo(
    () => allSteps.find((step) => step.id === state.selectedId) ?? null,
    [allSteps, state.selectedId],
  );
  const focusId = state.selectedId ?? hoverId;
  const route = useMemo(() => (focusId == null ? null : routeSet(scoped, focusId)), [focusId, scoped]);
  const chain = useMemo(() => (selected ? chainOf(allSteps, selected.id) : []), [allSteps, selected]);
  const chainIds = useMemo(() => new Set(chain.map((step) => step.id)), [chain]);

  const select = useCallback(
    (id: string) => {
      patch({ selectedId: state.selectedId === id ? null : id });
      setTraceOnly(false);
      setChainOpen(true);
    },
    [patch, state.selectedId],
  );

  // ── Drag to link ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!drag || typeof window === "undefined") return;
    const from = drag.from;
    const move = (event: PointerEvent) => {
      const canvas = canvasElRef.current;
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      setDrag((current) =>
        current ? { ...current, x: event.clientX - box.left, y: event.clientY - box.top } : current,
      );
    };
    const up = (event: PointerEvent) => {
      const under = document.elementFromPoint?.(event.clientX, event.clientY) ?? null;
      const host = under instanceof Element ? under.closest("[data-step-id]") : null;
      const target = host?.getAttribute("data-step-id");
      if (target && target !== from) linkSteps(target, from);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, linkSteps]);

  const onPortDown = useCallback((id: string, event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const box = canvasElRef.current?.getBoundingClientRect();
    setDrag({ from: id, x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) });
  }, []);

  // ── Keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setScopeMenuOpen(false);
        setFlipped(null);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && history.length > 0) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history.length, undo]);

  // ── Flow measurement ───────────────────────────────────────────────────────

  const setCanvasEl = useCallback((node: HTMLDivElement | null) => {
    canvasElRef.current = node;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const host = node.closest(".cr-lens") ?? node.parentElement;
    if (!host) return;
    const measure = () => {
      const width = Math.max(0, Math.round(host.clientWidth - 28));
      setFlowWidth((current) => (Math.abs(width - current) > 2 ? width : current));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    resizeObserverRef.current = observer;
    measure();
  }, []);
  useEffect(() => () => resizeObserverRef.current?.disconnect(), []);

  // Columns divide the measured canvas so the chart always fills its width;
  // below the floor they keep 216px and the canvas scrolls instead.
  const columnWidth = flowWidth
    ? Math.max(
        216,
        Math.min(430, Math.floor((flowWidth - (CHART_STAGES.length - 1) * COLUMN_GAP) / CHART_STAGES.length)),
      )
    : 244;

  const expandedNodes = useMemo(() => new Set(state.expandedNodes), [state.expandedNodes]);
  const flowSteps = useMemo(() => withDraftTitles(scoped), [scoped, withDraftTitles]);
  const flow = useMemo(
    () =>
      flowLayout(flowSteps, {
        columnWidth,
        columnGap: COLUMN_GAP,
        nodeHeight: NODE_HEIGHT,
        nodeGap: NODE_GAP,
        expandedHeight: NODE_EXPANDED,
        expanded: expandedNodes,
        focusId,
      }),
    [columnWidth, expandedNodes, flowSteps, focusId],
  );

  const graph = useMemo(
    () =>
      graphLayout(scoped, {
        nodeWidth: GRAPH_NODE_W,
        nodeHeight: GRAPH_NODE_H,
        columnGap: 96,
        rowGap: 26,
        chain: chainIds,
      }),
    [chainIds, scoped],
  );

  // The connected component around the selection, for the chain diagram.
  const chainComponent = useMemo(() => {
    if (!selected) return { width: 10, height: 10, nodes: [], edges: [] };
    const NW = 182;
    const NH = 70;
    const CG = 52;
    const RG = 12;
    const seen = new Set([selected.id]);
    const queue = [selected.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      const node = allSteps.find((step) => step.id === id);
      const neighbours: string[] = [];
      if (node?.needs) neighbours.push(node.needs);
      for (const step of allSteps) if (step.needs === id) neighbours.push(step.id);
      for (const neighbour of neighbours) {
        if (!seen.has(neighbour) && seen.size < 16) {
          seen.add(neighbour);
          queue.push(neighbour);
        }
      }
    }
    const nodes = allSteps.filter((step) => seen.has(step.id));
    const depth = dependencyDepth(nodes);
    const columns: ChartStep[][] = [];
    for (const step of nodes) {
      const rank = depth[step.id] ?? 0;
      const column = columns[rank];
      if (column) column.push(step);
      else columns[rank] = [step];
    }
    const rows = Math.max(1, ...columns.map((column) => column?.length ?? 0));
    const width = Math.max(columns.length * NW + Math.max(0, columns.length - 1) * CG, 10);
    const height = Math.max(rows * NH + Math.max(0, rows - 1) * RG, 10);
    const at = new Map<string, { x: number; y: number }>();
    columns.forEach((column, columnIndex) => {
      const count = column?.length ?? 0;
      const span = count * NH + Math.max(0, count - 1) * RG;
      (column ?? []).forEach((step, rowIndex) => {
        at.set(step.id, { x: columnIndex * (NW + CG), y: (height - span) / 2 + rowIndex * (NH + RG) });
      });
    });
    const holdIndex = chain.findIndex((step) => step.state === "overdue" || step.state === "decision");
    const held = holdIndex >= 0 ? chain[holdIndex] : null;
    const edges = nodes.flatMap((step) => {
      const from = step.needs ? at.get(step.needs) : undefined;
      const to = at.get(step.id);
      if (!from || !to) return [];
      const source = nodes.find((other) => other.id === step.needs);
      const backwards = from.x >= to.x;
      const hot = source != null && (source.state === "overdue" || source.id === held?.id);
      const x1 = from.x + NW;
      const y1 = from.y + NH / 2;
      const x2 = to.x;
      const y2 = to.y + NH / 2;
      const mid = backwards ? x1 + 22 : x1 + (x2 - x1) / 2;
      return [
        {
          id: `${step.needs}->${step.id}`,
          hot,
          d: backwards
            ? `M${x1} ${y1} C${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`
            : `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
        },
      ];
    });
    return {
      width,
      height,
      nodes: nodes.map((step) => ({ step, ...(at.get(step.id) ?? { x: 0, y: 0 }) })),
      edges,
    };
  }, [allSteps, chain, selected]);

  // ── Table rows ─────────────────────────────────────────────────────────────

  const tableRows = useMemo(() => {
    const filtered = filterSteps(flowSteps, query, stateFilter, ownerName, projectName);
    return sortSteps(
      filtered,
      sortKey,
      sortDirection,
      ownerName,
      projectName,
      (id) => allSteps.find((step) => step.id === id)?.title ?? "",
    );
  }, [allSteps, flowSteps, ownerName, projectName, query, sortDirection, sortKey, stateFilter]);

  // ── Voyage log ─────────────────────────────────────────────────────────────

  const recentlyDone = useMemo(
    () =>
      (cards ?? [])
        .filter((card) => card.status === "done")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [cards],
  );

  // ── Stats ──────────────────────────────────────────────────────────────────

  const progress: ProjectProgress[] = useMemo(() => {
    const source =
      state.scope.length === 0 ? projects : projects.filter((project) => state.scope.includes(project.id));
    return source.map((project) => {
      const mine = allSteps.filter((step) => step.project === project.id);
      const shipped = mine.filter((step) => step.stage === "done").length;
      return {
        id: project.id,
        name: project.name,
        color: project.color ?? null,
        total: mine.length,
        shipped,
        late: mine.filter((step) => step.state === "overdue").length,
        running: mine.filter((step) => step.state === "running").length,
        waiting: mine.filter((step) => step.needs != null).length,
        percent: mine.length > 0 ? Math.max(6, Math.round((shipped / mine.length) * 100)) : 0,
      };
    });
  }, [allSteps, projects, state.scope]);

  // "A diff, not a feed" — only lines that actually moved, and only ones the
  // board can answer for. A line reading zero is dropped, never shown as a tick.
  const changes = useMemo(() => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const touched = (cards ?? []).filter((card) => card.updatedAt > yesterday);
    const rows: Array<{ n: string; label: string; tone: "up" | "warn" | "accent" | "plain" }> = [];
    const landed = touched.filter((card) => card.status === "done").length;
    if (landed > 0) rows.push({ n: `+${landed}`, label: "cards reached Done", tone: "up" });
    const moved = touched.length - landed;
    if (moved > 0) rows.push({ n: String(moved), label: "cards changed", tone: "plain" });
    if (overdueCount > 0) rows.push({ n: String(overdueCount), label: "steps overdue", tone: "warn" });
    if (decisions.length > 0) rows.push({ n: String(decisions.length), label: "decisions owed", tone: "accent" });
    return rows;
  }, [cards, decisions.length, overdueCount]);

  // ── Scope ──────────────────────────────────────────────────────────────────

  const picked = projects.filter((project) => state.scope.includes(project.id));
  const scopeLabel =
    picked.length === 0 ? "All projects" : picked.length === 1 ? picked[0].name : `${picked.length} projects`;

  const toggleScope = (id: string) => {
    patch({
      scope: state.scope.includes(id) ? state.scope.filter((entry) => entry !== id) : [...state.scope, id],
      selectedId: null,
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const lens = state.lens;
  const helpTips = HELP[lens];
  const helpColumns = Math.min(3, helpTips.length);
  const owedIndexSafe = Math.min(owedIndex, Math.max(decisions.length - 1, 0));
  const owed = decisions[owedIndexSafe] ?? null;
  const briefLine = owed
    ? `${owed.question}${owed.blocking.length > 0 ? ` — ${owed.blocking.length} step${owed.blocking.length > 1 ? "s" : ""} behind it` : ""}`
    : "Nothing owed. The chart is yours to run.";

  const lensBody = () => {
    if (boardError && cards == null) {
      return <SurfaceError title={boardError} hint="Check the Cave connection, then retry." onRetry={loadBoard} />;
    }
    if (cards == null) return <SurfaceLoading label="Loading the board…" />;
    if (scoped.length === 0) {
      return (
        <SurfaceEmpty
          iconName="ph:compass"
          title={state.scope.length === 0 ? "Nothing charted yet." : `Nothing in ${scopeLabel}.`}
          hint="Chart a step in any lane, or widen the project scope."
        />
      );
    }

    if (lens === "decisions") {
      return (
        <ChartRoomDecisions
          decisions={decisions}
          openId={openDecision}
          resolvedCount={answered.length}
          pendingId={saving ? openDecision : null}
          projectColor={projectColor}
          projectName={projectName}
          scopeLabel={scopeLabel}
          onToggle={(id) => setOpenDecision((current) => (current === id ? null : id))}
          onAnswer={(id) => void answerDecision(id)}
          onReveal={(id) => {
            patch({ lens: "flow", selectedId: id });
            setTraceOnly(false);
          }}
          onOpenStep={(id) => {
            patch({ selectedId: id });
            setTraceOnly(false);
          }}
        />
      );
    }

    if (lens === "graph") {
      return (
        <ChartRoomGraph
          steps={scoped}
          layout={graph}
          selectedId={state.selectedId}
          chain={chainIds}
          routeVisibility={routeVisibility}
          zoom={graphZoom}
          pan={graphPan}
          panning={graphPanning}
          nodeHeight={GRAPH_NODE_H}
          ownerName={ownerName}
          projectColor={projectColor}
          projectName={projectName}
          onTrace={(id) => {
            patch({ selectedId: state.selectedId === id ? null : id });
            setTraceOnly(true);
            setChainOpen(true);
          }}
          onZoomIn={() => setGraphZoom((zoom) => Math.min(1.6, Number((zoom + 0.15).toFixed(2))))}
          onZoomOut={() => setGraphZoom((zoom) => Math.max(0.5, Number((zoom - 0.15).toFixed(2))))}
          onFit={() => {
            setGraphZoom(1);
            setGraphPan({ x: 0, y: 0 });
          }}
          onPanStart={(event) => {
            if (typeof window === "undefined") return;
            if ((event.target as HTMLElement).closest("button")) return;
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const base = { ...graphPan };
            setGraphPanning(true);
            const move = (moveEvent: PointerEvent) =>
              setGraphPan({ x: base.x + (moveEvent.clientX - startX), y: base.y + (moveEvent.clientY - startY) });
            const up = () => {
              setGraphPanning(false);
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
      );
    }

    if (lens === "orch") {
      return (
        <ChartRoomOrchestration
          steps={scoped}
          familiars={familiars.map((familiar) => ({
            id: familiar.id,
            name: familiar.name,
            role: familiar.role ?? "familiar",
          }))}
          capabilities={capabilities}
          lock={lock}
          live={new Set(lockedSteps(scoped, lock, capabilities).map((step) => step.id))}
          expandedCanvas={focusMode}
          ownerName={ownerName}
          onLock={setLock}
          onOpenStep={(id) => {
            patch({ selectedId: id });
            setTraceOnly(false);
          }}
        />
      );
    }

    if (lens === "list") {
      if (tableRows.length === 0) {
        return <SurfaceEmpty title="No step matches that filter." hint="Clear the filter, or widen the scope." />;
      }
      return (
        <ChartRoomTable
          mode={state.tableMode}
          rows={tableRows}
          allSteps={allSteps}
          sortKey={sortKey}
          sortDirection={sortDirection}
          collapsedColumns={state.collapsedColumns}
          familiars={familiars}
          projects={projects}
          projectColor={projectColor}
          ownerName={ownerName}
          onSort={(key) => {
            if (key === sortKey) setSortDirection((direction) => (direction === 1 ? -1 : 1));
            else {
              setSortKey(key);
              setSortDirection(1);
            }
          }}
          onOpen={(id) => {
            patch({ selectedId: id });
            setTraceOnly(false);
          }}
          onTitle={editTitle}
          onProject={(id, projectId) =>
            void patchCard(
              id,
              { projectId: projectId === "" ? null : projectId },
              "Moved the step to another project.",
              "Couldn't change the project — the board didn't accept it.",
            )
          }
          onStage={(id, stage) => void moveStage(id, stage)}
          onOwner={(id, owner) =>
            void patchCard(
              id,
              { familiarId: owner === "" ? null : owner },
              "Reassigned the step.",
              "Couldn't reassign it — the board didn't accept it.",
            )
          }
          onNeeds={linkSteps}
          onRemove={(id) => void removeStep(id)}
          onToggleColumn={(stage) =>
            patch({
              collapsedColumns: state.collapsedColumns.includes(stage)
                ? state.collapsedColumns.filter((entry) => entry !== stage)
                : [...state.collapsedColumns, stage],
            })
          }
        />
      );
    }

    return (
      <ChartRoomFlow
        steps={flowSteps}
        layout={flow}
        columnWidth={columnWidth}
        nodeHeight={NODE_HEIGHT}
        expandedHeight={NODE_EXPANDED}
        selectedId={state.selectedId}
        expanded={expandedNodes}
        drag={drag}
        routeIds={route}
        canvasRef={setCanvasEl}
        ownerName={ownerName}
        projectColor={projectColor}
        projectName={projectName}
        addPending={adding}
        onSelect={select}
        onHover={setHoverId}
        onToggleExpanded={(id) =>
          patch({
            expandedNodes: state.expandedNodes.includes(id)
              ? state.expandedNodes.filter((entry) => entry !== id)
              : [...state.expandedNodes, id],
          })
        }
        onPortDown={onPortDown}
        onAddStep={(stage) => void addStep(stage)}
      />
    );
  };

  return (
    <SurfaceRoom
      accentHue={105}
      className="role-surface-room--chart"
      drawerTitle="Voyage log"
      drawerOpen={state.drawerOpen}
      onToggleDrawer={() => patch({ drawerOpen: !state.drawerOpen })}
      drawerSummary={`${recentlyDone.length} completed · ${audit.length} chart edits · ${answered.length} answered`}
      header={
        <header className="cr-head">
          <span className="cr-head__title">
            <Icon name="ph:compass" width={16} height={16} aria-hidden />
            <h2>Chart Room</h2>
          </span>
          <span className="cr-head__rule" />
          <nav className="cr-scope" aria-label="Project scope">
            <button
              type="button"
              className="cr-scope__trigger focus-ring"
              aria-haspopup="listbox"
              aria-expanded={scopeMenuOpen}
              onClick={() => setScopeMenuOpen((open) => !open)}
            >
              <ChartDot color={picked.length === 1 ? (picked[0].color ?? null) : null} large />
              <span className="cr-scope__name">{scopeLabel}</span>
              <span className="cr-mono">{scoped.length}</span>
              {overdueCount > 0 ? <span className="cr-pip cr-pip--warn" /> : null}
              <Icon
                name={scopeMenuOpen ? "ph:caret-up" : "ph:caret-down"}
                width={12}
                height={12}
                aria-hidden
                className="cr-scope__caret"
              />
            </button>
            {scopeMenuOpen ? (
              <div className="cr-scope__menu" role="listbox" aria-label="Choose a project">
                <button
                  type="button"
                  role="option"
                  aria-selected={state.scope.length === 0}
                  className="cr-scope__option focus-ring"
                  onClick={() => {
                    patch({ scope: [], selectedId: null });
                    setScopeMenuOpen(false);
                  }}
                >
                  <ChartDot color={null} large />
                  <span className="cr-scope__option-name">All projects</span>
                  <span className="cr-mono">{allSteps.length}</span>
                </button>
                {projects.map((project) => {
                  const mine = allSteps.filter((step) => step.project === project.id);
                  const late = mine.filter((step) => step.state === "overdue").length;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={state.scope.includes(project.id)}
                      className="cr-scope__option focus-ring"
                      onClick={() => toggleScope(project.id)}
                    >
                      <ChartDot color={project.color ?? null} large />
                      <span className="cr-scope__option-name">{project.name}</span>
                      {late > 0 ? (
                        <span className="cr-count" data-tone="warn">
                          {late} late
                        </span>
                      ) : null}
                      <span className="cr-mono">{mine.length}</span>
                      {state.scope.includes(project.id) ? (
                        <Icon name="ph:check" width={11} height={11} aria-hidden />
                      ) : null}
                    </button>
                  );
                })}
                <p className="cr-scope__note">
                  {projects.length === 0
                    ? "No projects registered yet, so every card charts as one scope."
                    : "Pick several to compare projects side by side. Scopes the briefing, the chart, and the ledger."}
                </p>
              </div>
            ) : null}
            {state.scope.length > 0 ? (
              <button
                type="button"
                className="cr-scope__clear focus-ring"
                onClick={() => {
                  patch({ scope: [], selectedId: null });
                  setScopeMenuOpen(false);
                }}
              >
                <Icon name="ph:x" width={10} height={10} aria-hidden /> All projects
              </button>
            ) : null}
          </nav>
          <span className="cr-head__status">
            <span className="cr-mono">
              {state.scope.length === 0
                ? `${allSteps.length} steps across ${projects.length} project${projects.length === 1 ? "" : "s"}`
                : `${scoped.length} steps in ${picked.map((project) => project.name).join(" + ")}`}
            </span>
            <span>
              <span className={decisions.length > 0 ? "cr-pip cr-pip--owed" : "cr-pip cr-pip--clear"} />
              {decisions.length > 0
                ? `${decisions.length} decision${decisions.length > 1 ? "s" : ""} owed`
                : "no decision owed"}
            </span>
            <span>
              <span className={overdueCount > 0 ? "cr-pip cr-pip--warn" : "cr-pip cr-pip--clear"} />
              {overdueCount > 0 ? `${overdueCount} overdue step${overdueCount > 1 ? "s" : ""}` : "nothing overdue"}
            </span>
          </span>
        </header>
      }
      drawer={
        <div className="cr-log">
          <section className="cr-log__section" data-open={logSection === "done"}>
            <button
              type="button"
              className="cr-log__head focus-ring"
              aria-expanded={logSection === "done"}
              onClick={() => setLogSection((current) => (current === "done" ? null : "done"))}
            >
              <Icon
                name={logSection === "done" ? "ph:caret-down" : "ph:caret-right"}
                width={11}
                height={11}
                aria-hidden
              />
              <Icon name="ph:flag-checkered" width={13} height={13} aria-hidden />
              <span className="cr-eyebrow">Recently completed</span>
              <span className="cr-mono">{recentlyDone.length}</span>
              <span className="cr-log__hint">
                {recentlyDone[0] ? `latest — ${recentlyDone[0].title}` : "nothing completed yet"}
              </span>
            </button>
            {logSection === "done" ? (
              boardError ? (
                <SurfaceError
                  title={boardError}
                  hint="Check the Cave connection, then retry."
                  onRetry={loadBoard}
                  live={false}
                />
              ) : cards == null ? (
                <SurfaceLoading label="Loading recently completed cards…" live={false} />
              ) : recentlyDone.length === 0 ? (
                <SurfaceEmpty title="Nothing completed yet." />
              ) : (
                <ul aria-label="Recently completed cards">
                  {recentlyDone.map((card) => {
                    const open = openDone === card.id;
                    const unblocked = allSteps.filter((step) => step.needs === card.id);
                    return (
                      <li key={card.id} className="cr-done__item" data-open={open}>
                        <button
                          type="button"
                          className="cr-done__row focus-ring"
                          aria-expanded={open}
                          onClick={() => setOpenDone((current) => (current === card.id ? null : card.id))}
                        >
                          <ChartDot color={projectColor(card.projectId ?? null)} />
                          <span className="cr-chain__title">{card.title}</span>
                          <span className="cr-chip">{relativeTime(card.updatedAt)}</span>
                          <Icon
                            name={open ? "ph:caret-up" : "ph:caret-down"}
                            width={11}
                            height={11}
                            aria-hidden
                          />
                        </button>
                        {open ? (
                          <div className="cr-done__detail">
                            <span className="cr-done__facts">
                              <span>
                                <Icon name="ph:user-circle" width={10} height={10} aria-hidden />
                                {ownerName(card.familiarId)}
                              </span>
                              <span>
                                <Icon name="ph:calendar-check" width={10} height={10} aria-hidden />
                                {relativeTime(card.updatedAt)}
                              </span>
                            </span>
                            {card.notes.trim() !== "" ? <span className="cr-help__body">{card.notes}</span> : null}
                            <span className="cr-done__facts">
                              <span className="cr-eyebrow">Unblocked</span>
                              {unblocked.length === 0 ? (
                                <span className="cr-mono">nothing was waiting on it</span>
                              ) : (
                                unblocked.map((step) => (
                                  <span key={step.id} className="cr-chip">
                                    {step.title}
                                  </span>
                                ))
                              )}
                            </span>
                            <span className="cr-done__facts">
                              <button
                                type="button"
                                className="cr-btn focus-ring"
                                onClick={() => void moveStage(card.id, "running")}
                              >
                                <Icon name="ph:arrow-counter-clockwise" width={10} height={10} aria-hidden />
                                Reopen in Underway
                              </button>
                              <button
                                type="button"
                                className="cr-btn focus-ring"
                                onClick={() => context.focusCard(card.id)}
                              >
                                <Icon name="ph:kanban" width={10} height={10} aria-hidden /> Board
                              </button>
                            </span>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : null}
          </section>

          <section className="cr-log__section" data-open={logSection === "edits"}>
            <button
              type="button"
              className="cr-log__head focus-ring"
              aria-expanded={logSection === "edits"}
              onClick={() => setLogSection((current) => (current === "edits" ? null : "edits"))}
            >
              <Icon
                name={logSection === "edits" ? "ph:caret-down" : "ph:caret-right"}
                width={11}
                height={11}
                aria-hidden
              />
              <Icon name="ph:arrow-u-up-left" width={13} height={13} aria-hidden />
              <span className="cr-eyebrow">Chart edits this session</span>
              <span className="cr-mono">{audit.length}</span>
              <span className="cr-log__hint">{audit[0]?.text ?? "nothing rearranged yet"}</span>
            </button>
            {logSection === "edits" ? (
              audit.length === 0 ? (
                <SurfaceEmpty title="Nothing rearranged yet." hint="Moves and links land here as you make them." />
              ) : (
                <ul>
                  {audit.map((entry) => (
                    <li key={entry.id} className="cr-audit">
                      <Icon name={entry.iconName} width={11} height={11} aria-hidden />
                      <span>{entry.text}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>

          <section className="cr-log__section" data-open={logSection === "answered"}>
            <button
              type="button"
              className="cr-log__head focus-ring"
              aria-expanded={logSection === "answered"}
              onClick={() => setLogSection((current) => (current === "answered" ? null : "answered"))}
            >
              <Icon
                name={logSection === "answered" ? "ph:caret-down" : "ph:caret-right"}
                width={11}
                height={11}
                aria-hidden
              />
              <Icon name="ph:path" width={13} height={13} aria-hidden />
              <span className="cr-eyebrow">Decisions answered</span>
              <span className="cr-mono">{answered.length}</span>
              <span className="cr-log__hint">
                {answered[0] ? `latest — ${answered[0].title}` : "nothing answered this session"}
              </span>
            </button>
            {logSection === "answered" ? (
              answered.length === 0 ? (
                <SurfaceEmpty
                  title="Nothing answered this session."
                  hint="Clearing a card's needs-a-human flag records it here."
                />
              ) : (
                <ul>
                  {answered.map((entry) => (
                    <li key={entry.id} className="cr-audit">
                      <Icon name="ph:check" width={11} height={11} aria-hidden />
                      <span>{entry.title}</span>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>
        </div>
      }
    >
      <SurfaceCanvas label="Chart Room">
        <div className="cr-shell">
          {boardError && cards != null ? (
            <SurfaceError
              title={boardError}
              hint="Showing the last loaded board. Retry when the Cave connection returns."
              onRetry={loadBoard}
            />
          ) : null}
          {writeError ? <p className="cr-note">{writeError}</p> : null}

          {!focusMode ? (
            <div className="cr-disclosure">
              <button
                type="button"
                className="cr-disclosure__toggle focus-ring"
                aria-expanded={state.helpOpen}
                onClick={() => patch({ helpOpen: !state.helpOpen })}
              >
                <Icon
                  name={state.helpOpen ? "ph:caret-down" : "ph:caret-right"}
                  width={11}
                  height={11}
                  aria-hidden
                />
                <span className="cr-eyebrow">How to work this room</span>
                <span className="cr-disclosure__fill" />
                <span className="cr-mono">
                  {lens === "flow"
                    ? "drag, link, reorder"
                    : lens === "graph"
                      ? "trace, pan, drill in"
                      : lens === "orch"
                        ? "lock onto anything"
                        : lens === "decisions"
                          ? "answer what is owed"
                          : "sort, filter, edit inline"}
                </span>
              </button>
              {state.helpOpen ? (
                <div className="cr-overlay">
                  <div className="cr-help__grid" style={{ "--cr-help-cols": String(helpColumns) } as CSSProperties}>
                    {helpTips.map(([iconName, title, body]) => (
                      <span key={title} className="cr-help__tip">
                        <span className="cr-help__badge">
                          <Icon name={iconName} width={12} height={12} aria-hidden />
                        </span>
                        <span className="cr-help__text">
                          <span className="cr-help__title">{title}</span>
                          <span className="cr-help__body">{body}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                  {lens === "flow" ? (
                    <div className="cr-legend">
                      <span className="cr-eyebrow">Edges</span>
                      <span className="cr-legend__item">
                        <svg width="34" height="8" viewBox="0 0 34 8" fill="none" aria-hidden>
                          <path
                            className="cr-edge"
                            data-tone="live"
                            d="M1 4 H33"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                        waiting on live work
                      </span>
                      <span className="cr-legend__item">
                        <svg width="34" height="8" viewBox="0 0 34 8" fill="none" aria-hidden>
                          <path
                            className="cr-edge"
                            data-tone="late"
                            d="M1 4 H33"
                            strokeWidth="1.8"
                            strokeDasharray="5 4"
                            strokeLinecap="round"
                          />
                        </svg>
                        waiting on something overdue
                      </span>
                      <span className="cr-legend__item">
                        <svg width="34" height="8" viewBox="0 0 34 8" fill="none" aria-hidden>
                          <path
                            className="cr-edge"
                            data-tone="backwards"
                            d="M1 4 H33"
                            strokeWidth="1.4"
                            strokeDasharray="2 4"
                            strokeLinecap="round"
                          />
                        </svg>
                        the chart runs backwards here
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {!focusMode ? (
            <ChartRoomBand
              open={state.briefOpen}
              openPanel={state.bandPanel}
              briefLine={briefLine}
              proposals={proposals}
              decisions={decisions}
              owedIndex={owedIndexSafe}
              overdueCount={overdueCount}
              changes={changes}
              progress={progress}
              flipped={flipped}
              answering={saving}
              projectColor={projectColor}
              projectName={projectName}
              onToggleOpen={() => patch({ briefOpen: !state.briefOpen })}
              onOpenPanel={(panel) => {
                patch({ bandPanel: state.bandPanel === panel ? null : panel });
                setFlipped(null);
              }}
              onFlip={setFlipped}
              onOwedPrev={() =>
                setOwedIndex((index) => (index - 1 + decisions.length) % Math.max(decisions.length, 1))
              }
              onOwedNext={() => setOwedIndex((index) => (index + 1) % Math.max(decisions.length, 1))}
              onAnswer={(id) => void answerDecision(id)}
              onReveal={(id) => {
                patch({ lens: "flow", selectedId: id, briefOpen: false });
                setTraceOnly(false);
              }}
              onCompare={() => {
                patch({ lens: "decisions", briefOpen: false });
                setOpenDecision(owed?.stepId ?? null);
              }}
              onOpenStats={() => setStatsOpen(true)}
              onApplyProposal={(proposal: ChartProposal) => {
                if (proposal.action) applyAction(proposal.action);
              }}
              onShowProposal={(proposal: ChartProposal) => {
                patch({ lens: "flow", selectedId: proposal.stepId, briefOpen: false });
                setTraceOnly(false);
              }}
              onDismissProposal={(proposal: ChartProposal) =>
                patch({ dismissedProposals: [...state.dismissedProposals, proposal.id] })
              }
            />
          ) : null}

          <section className="cr-lens" aria-label="Chart">
            <div className="cr-lens__bar">
              <span className="cr-lens__head">
                <Icon name="ph:flow-arrow" width={13} height={13} aria-hidden />
                <span className="cr-eyebrow">Chart</span>
              </span>
              <span className="cr-seg" role="group" aria-label="Chart lens">
                {LENSES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="cr-seg__btn focus-ring"
                    aria-pressed={lens === entry.id}
                    onClick={() => patch({ lens: entry.id })}
                  >
                    {entry.label}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className="cr-tab-decisions focus-ring"
                aria-pressed={lens === "decisions"}
                title="Open what is owed — a separate object from the chart, not another view of it"
                onClick={() => patch({ lens: lens === "decisions" ? "flow" : "decisions" })}
              >
                <Icon name="ph:scales" width={12} height={12} aria-hidden />
                Decisions
                <span className="cr-tab-decisions__count" data-empty={decisions.length === 0}>
                  {decisions.length}
                </span>
              </button>
              <span className="cr-lens__spacer" />
              {lens === "list" ? (
                <>
                  <span className="cr-filter">
                    <Icon name="ph:magnifying-glass" width={12} height={12} aria-hidden />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search steps…"
                      aria-label="Search steps"
                    />
                  </span>
                  <span className="cr-seg" role="group" aria-label="Filter by state">
                    {(
                      [
                        ["all", "All"],
                        ["attention", "Needs you"],
                        ["linked", "Linked"],
                        ["overdue", "Late"],
                        ["running", "Running"],
                      ] as Array<[ChartStateFilter, string]>
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className="cr-seg__btn focus-ring"
                        aria-pressed={stateFilter === value}
                        onClick={() => setStateFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <span className="cr-seg" role="group" aria-label="Table shape">
                    {(
                      [
                        ["table", "Table", "ph:table"],
                        ["gantt", "Gantt", "ph:chart-bar-horizontal"],
                        ["board", "Board", "ph:kanban"],
                      ] as Array<[TableMode, string, IconName]>
                    ).map(([value, label, iconName]) => (
                      <button
                        key={value}
                        type="button"
                        className="cr-seg__btn focus-ring"
                        aria-pressed={state.tableMode === value}
                        onClick={() => patch({ tableMode: value })}
                      >
                        <Icon name={iconName} width={11} height={11} aria-hidden />
                        {label}
                      </button>
                    ))}
                  </span>
                </>
              ) : null}
              {lens === "graph" && selected ? (
                <span className="cr-seg" role="group" aria-label="Other routes">
                  {(
                    [
                      ["dim", "Dim"],
                      ["hide", "Hide"],
                      ["show", "Show"],
                    ] as Array<[RouteVisibility, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="cr-seg__btn focus-ring"
                      aria-pressed={routeVisibility === value}
                      onClick={() => setRouteVisibility(value)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              ) : null}
              {lens === "orch" && lock ? (
                <button type="button" className="cr-btn cr-btn--on focus-ring" onClick={() => setLock(null)}>
                  <Icon name="ph:lock-simple" width={11} height={11} aria-hidden /> Locked
                  <Icon name="ph:x" width={10} height={10} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="cr-btn focus-ring"
                disabled={history.length === 0}
                title={
                  history.length > 0
                    ? `Undo the last chart edit (${history.length} in this session) — ⌘Z`
                    : "Nothing to undo yet"
                }
                onClick={undo}
              >
                <Icon name="ph:arrow-arc-left" width={11} height={11} aria-hidden /> Undo
              </button>
              <button
                type="button"
                className={focusMode ? "cr-btn cr-btn--on focus-ring" : "cr-btn focus-ring"}
                title={focusMode ? "Bring the briefing back" : "Hide the briefing and run the chart full width"}
                onClick={() => setFocusMode((mode) => !mode)}
              >
                <Icon name={focusMode ? "ph:corners-in" : "ph:corners-out"} width={11} height={11} aria-hidden />
                {focusMode ? "Exit" : "Expand"}
              </button>
              <button
                type="button"
                className="cr-btn focus-ring"
                title="Discard this session's links — the board's own cards are untouched"
                disabled={Object.keys(overlay.dependsOn).length === 0}
                onClick={() => {
                  writeOverlay(EMPTY_OVERLAY, "Cleared every link in the chart", "ph:arrow-counter-clockwise");
                  announce("Cleared the chart's links.");
                }}
              >
                <Icon name="ph:arrow-counter-clockwise" width={11} height={11} aria-hidden /> Clear links
              </button>
            </div>

            {selected && chainOpen && chain.length > 1 && lens !== "decisions" ? (
              <ChartRoomChain
                chain={chain}
                component={chainComponent}
                shape={chainShape}
                selectedId={state.selectedId}
                summary={chainSummary(chain)}
                projectColor={projectColor}
                onShape={setChainShape}
                onSelect={(id) => patch({ selectedId: id })}
                onOpenStep={() => setTraceOnly(false)}
                onClose={() => setChainOpen(false)}
              />
            ) : null}

            {lensBody()}
          </section>
        </div>
      </SurfaceCanvas>

      {statsOpen ? (
        <StatsModal
          progress={progress}
          changes={changes}
          totalSteps={allSteps.length}
          overdueCount={overdueCount}
          onClose={() => setStatsOpen(false)}
        />
      ) : null}

      {selected && !traceOnly ? (
        <ChartRoomStepSheet
          step={withDraftTitles([selected])[0]}
          steps={allSteps}
          familiars={familiars}
          projects={projects}
          upstreamOpen={upstreamPickerOpen}
          downstreamOpen={downstreamPickerOpen}
          saving={saving}
          projectColor={projectColor}
          onClose={() => patch({ selectedId: null })}
          onTitle={(title) => editTitle(selected.id, title)}
          onStage={(stage) => void moveStage(selected.id, stage)}
          onOwner={(owner) =>
            void patchCard(
              selected.id,
              { familiarId: owner === "" ? null : owner },
              "Reassigned the step.",
              "Couldn't reassign it — the board didn't accept it.",
            )
          }
          onProject={(projectId) =>
            void patchCard(
              selected.id,
              { projectId: projectId === "" ? null : projectId },
              "Moved the step to another project.",
              "Couldn't change the project — the board didn't accept it.",
            )
          }
          onNeeds={(needs) => {
            linkSteps(selected.id, needs);
            setUpstreamPickerOpen(false);
          }}
          onConnect={(dependantId) => {
            linkSteps(dependantId, selected.id);
            setDownstreamPickerOpen(false);
          }}
          onCut={(dependantId) => linkSteps(dependantId, null)}
          onSelect={(id) => patch({ selectedId: id })}
          onToggleUpstream={() => {
            setUpstreamPickerOpen((open) => !open);
            setDownstreamPickerOpen(false);
          }}
          onToggleDownstream={() => {
            setDownstreamPickerOpen((open) => !open);
            setUpstreamPickerOpen(false);
          }}
          onRecommendation={applyAction}
          onDelete={() => void removeStep(selected.id)}
          onFocusCard={() => context.focusCard(selected.id)}
        />
      ) : null}
    </SurfaceRoom>
  );
}

/** Every project at a size that needs no scroll — the band panel shows five. */
function StatsModal({
  progress,
  changes,
  totalSteps,
  overdueCount,
  onClose,
}: {
  progress: readonly ProjectProgress[];
  changes: ReadonlyArray<{ n: string; label: string; tone: "up" | "warn" | "accent" | "plain" }>;
  totalSteps: number;
  overdueCount: number;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef, { onEscape: onClose });

  return (
    <div className="cr-modal">
      <button type="button" className="cr-modal__scrim" aria-label="Close project stats" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Project stats"
        className="cr-modal__dialog cr-modal__dialog--stats"
      >
        <header className="cr-modal__head">
          <Icon name="ph:chart-line-up" width={15} height={15} aria-hidden />
          <h3 className="cr-modal__title">Project stats</h3>
          <span className="cr-mono">
            {totalSteps} steps across {progress.length} project{progress.length === 1 ? "" : "s"} · {overdueCount}{" "}
            overdue
          </span>
          <span className="cr-lens__spacer" />
          <button type="button" className="cr-icon-btn focus-ring" aria-label="Close" onClick={onClose}>
            <Icon name="ph:x" width={14} height={14} aria-hidden />
          </button>
        </header>
        <div className="cr-modal__body">
          <div className="cr-stats__grid">
            <div className="cr-stats__col">
              <span className="cr-eyebrow">Since yesterday</span>
              {changes.length === 0 ? (
                <span className="cr-help__body">Nothing moved since you were last here.</span>
              ) : (
                <ul>
                  {changes.map((change) => (
                    <li key={change.label} className="cr-change">
                      <span className="cr-change__n" data-tone={change.tone === "plain" ? undefined : change.tone}>
                        {change.n}
                      </span>
                      <span>{change.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="cr-stats__col">
              <span className="cr-eyebrow">Progress to done</span>
              {progress.length === 0 ? (
                <span className="cr-help__body">No projects registered yet.</span>
              ) : (
                <ul>
                  {progress.map((project) => (
                    <li key={project.id} className="cr-progress">
                      <span className="cr-node__top">
                        <ChartDot color={project.color} large />
                        <span className="cr-chain__title">{project.name}</span>
                        <span className="cr-mono">
                          {project.total === 0
                            ? "nothing charted"
                            : `${project.shipped} done · ${project.running} running · ${project.waiting} waiting`}
                        </span>
                        <span className="cr-mono">
                          {project.late > 0 ? `${project.late} late` : `${project.percent}%`}
                        </span>
                      </span>
                      <span className="cr-progress__track">
                        <span
                          className="cr-progress__bar"
                          data-late={project.late > 0}
                          style={
                            {
                              "--cr-pct": `${project.percent}%`,
                              ...(project.late > 0 || !project.color ? {} : { "--cr-bar": project.color }),
                            } as CSSProperties
                          }
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

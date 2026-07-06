"use client";

import "@/styles/board.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { type WipLimits, readWipLimits, writeWipLimits, setWipLimit } from "@/lib/board-wip";
import { useRefreshOnFocus } from "@/lib/use-refresh-on-focus";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { Icon } from "@/lib/icon";
import { type Card, type CardStatus, type CardPriority, STATUSES, PRIORITIES } from "@/lib/cave-board-types";
import { cardMatchesBoardSearch } from "@/lib/board-search";
import { arrayContentEqual } from "@/lib/array-content-equal";
import { applyCardOps, hasCardOps, type CardPatch } from "@/lib/board-card-ops";
import { useAnnouncer } from "@/components/ui/live-region";
import { useMultiSelect } from "@/lib/use-multi-select";
import { SelectionToolbar } from "@/components/ui/selection-toolbar";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { UndoToast } from "@/components/ui/undo-toast";
import { useUndoDelete } from "@/lib/use-undo-delete";
import { familiarInScope } from "@/lib/familiar-multiselect";
import { BoardKanban } from "@/components/board-kanban";
import { BoardGantt } from "@/components/board-gantt";
import { BoardTable, type GroupBy } from "@/components/board-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StandardSelect } from "@/components/ui/select";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";
import { BoardCardStack } from "@/components/board-card-stack";
import { BoardInspector } from "@/components/board-inspector";
import { useIsMobile } from "@/lib/use-viewport";
import { chatProjectById } from "@/lib/chat-projects";
import { useProjects } from "@/lib/use-projects";

type ViewMode = "kanban" | "table" | "gantt";

function loadPref<T extends string>(key: string, fallback: T, valid: T[]): T {
  if (typeof window === "undefined") return fallback;
  const v = localStorage.getItem(key) as T | null;
  return v !== null && valid.includes(v) ? v : fallback;
}

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  /** Multiselect scope (empty = All). When ≥2 are selected the board filters to
   *  the union; `activeFamiliarId` stays the single-primary for chrome. */
  scopeFamiliarIds?: ReadonlySet<string>;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenUrl?: (url: string) => void;
};

// First-load placeholder that previews the kanban structure (ghost columns +
// cards) instead of a bare spinner, matching the app-wide skeleton convention
// (schedules/chat/board-inspector). Reuses the real column classes so
// it's pixel-matched and theme-aware; the shimmer comes from <Skeleton>.
function BoardKanbanSkeleton() {
  return (
    <div className="board-kanban-rail-wrap" aria-hidden>
      <div className="board-kanban-rail">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="board-kanban-column">
            <div className="board-kanban-column-header">
              <Skeleton variant="avatar" width={7} height={7} />
              <Skeleton variant="text" width={88} />
            </div>
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 3 - (col % 2) }).map((_, card) => (
                <Skeleton key={card} variant="card" height={66} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardView({ familiars, sessions, activeFamiliarId, scopeFamiliarIds, onJumpToSession, onOpenUrl }: Props) {
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<Card[]>([]);
  // Deferred + undoable task deletion: cards hide immediately, the DELETEs fire
  // only after the undo window, and Undo restores them (mirrors chat/projects).
  const { pending: deletePending, scheduleDelete: scheduleCardDelete, undo: undoCardDelete, commit: commitCardDelete } = useUndoDelete<Card[]>();
  const [error, setError] = useState<string | null>(null);
  // Distinguish "still loading" from "loaded and empty" so the empty-state
  // CTA doesn't flash on every open before the first GET resolves.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Transient feedback when an optimistic mutation fails and is reverted.
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadPref("cave:board:viewMode", "kanban", ["kanban", "table", "gantt"]));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref("cave:board:groupBy", "status", ["status", "familiar", "project"]));
  // Per-status WIP limits (loaded after mount to avoid SSR localStorage access).
  const [wipLimits, setWipLimits] = useState<WipLimits>({});
  useEffect(() => { setWipLimits(readWipLimits()); }, []);
  const setWipLimitFor = useCallback((status: CardStatus, limit: number | null) => {
    setWipLimits((prev) => {
      const next = setWipLimit(prev, status, limit);
      writeWipLimits(next);
      return next;
    });
  }, []);
  // Gantt has its own grouping: by project (one bar per task) or by task (one
  // bar per checklist step). Separate from the kanban/table groupBy above.
  const [ganttGroup, setGanttGroup] = useState<"project" | "task" | "familiar">(() => loadPref("cave:board:ganttGroup", "project", ["project", "task", "familiar"]) as "project" | "task" | "familiar");
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");
  const [chatLinkingId, setChatLinkingId] = useState<string | null>(null);
  const [chatLinkError, setChatLinkError] = useState<string | null>(null);
  const { projects } = useProjects();

  // "Clear done" flow: an inline confirm gate, and a transient undo banner that
  // snapshots the cleared cards so they can be re-created via POST.
  const [clearConfirm, setClearConfirm] = useState(false);
  const [clearedBanner, setClearedBanner] = useState<{ snapshot: Card[] } | null>(null);
  // Transient undo for a gantt drag/drop reschedule — snapshots the prior dates
  // so an accidental drag is one click to revert.
  // Async CRUD results are announced for AT: the visual toasts/banners are
  // aria-silent, and only kanban's drag flow had an announcer before.
  const { announce } = useAnnouncer();
  const [rescheduleUndo, setRescheduleUndo] = useState<{ id: string; title: string; prev: Partial<Card> } | null>(null);

  // `quiet` is for background polls: a transient poll failure must not blank
  // the board (setCards([])) or flash an error — leave the last-good cards in
  // place. Explicit loads (mount, focus, reload event) stay loud. Callers that
  // pass an event (e.g. useRefreshOnFocus) read as not-quiet, which is correct.
  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = opts?.quiet === true;
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as Card[];
        // Poll ticks rebuild an identical array most of the time; keep the
        // previous reference when content is unchanged so an idle board
        // doesn't re-render every card/row/bar for nothing (same convention
        // as workspace.tsx's poll over this endpoint).
        setCards((prev) => (arrayContentEqual(prev, loaded) ? prev : loaded));
        setError(null);
      } else if (!quiet) {
        setCards([]);
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      if (!quiet) {
        setCards([]);
        setError(err instanceof Error ? err.message : "load failed");
      }
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // "/" jumps to the task search (GitHub-style) while the board is shown,
  // unless the user is already typing in a field or holding a modifier.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const el = searchRef.current;
      if (!el) return;
      e.preventDefault();
      el.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { localStorage.setItem("cave:board:viewMode", viewMode); }, [viewMode]);
  // The command palette can switch the board view directly (e.g. "Board: Gantt
  // timeline"); honor it live when the board is already mounted.
  useEffect(() => {
    const onSetView = (e: Event) => {
      const v = (e as CustomEvent<{ view?: string }>).detail?.view;
      if (v === "kanban" || v === "table" || v === "gantt") setViewMode(v);
    };
    window.addEventListener("cave:board:set-view", onSetView);
    return () => window.removeEventListener("cave:board:set-view", onSetView);
  }, []);
  useEffect(() => { localStorage.setItem("cave:board:groupBy", groupBy); }, [groupBy]);
  useEffect(() => { localStorage.setItem("cave:board:ganttGroup", ganttGroup); }, [ganttGroup]);

  // External create paths dispatch `cave:board:reload` after POST so the board
  // picks up the new card without a full surface remount.
  useEffect(() => {
    const onReload = () => { void load(); };
    window.addEventListener("cave:board:reload", onReload);
    return () => window.removeEventListener("cave:board:reload", onReload);
  }, [load]);

  // Re-sync when the app regains focus, so a familiar finishing a task (or any
  // change made while the window was in the background) doesn't sit stale until
  // a manual reload — most visibly in the installed desktop app, where the OS
  // window manager doesn't fire the web visibility events that browser tabs do.
  useRefreshOnFocus(load);

  // Light background poll so a card that flips status (e.g. a familiar moving a
  // task running -> done) reflects without a manual reload while the board is
  // open. Quiet (never blanks on a transient failure), suspended on hidden tabs
  // and while typing, and paused whenever the user is mid-interaction — an open
  // modal/inspector, a pending undo, or a confirm gate — so a reload can't
  // clobber an optimistic edit or yank cards out from under a drag.
  const interacting =
    modalOpen ||
    selectedCardId !== null ||
    clearConfirm ||
    clearedBanner !== null ||
    rescheduleUndo !== null ||
    (deletePending?.item?.length ?? 0) > 0;
  usePausablePoll(
    () => { void load({ quiet: true }); },
    15_000,
    { enabled: !interacting, pauseWhileInputActive: true },
  );

  // Honour `#card-<id>` in the URL: workspace's `focus-card` palette intent
  // (e.g. the Task chip in chat-view) routes to /?…#card-<id>; we pick that
  // up here and open the inspector for the matching card. We wait until the
  // target card has loaded into `cards` before consuming the hash — otherwise
  // the cleanup effect just below would null `selectedCardId` on the next
  // render because the card isn't in the (empty) cards array yet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const match = /^#card-(.+)$/.exec(window.location.hash);
      if (!match) return;
      const id = decodeURIComponent(match[1]);
      if (!cards.some((c) => c.id === id)) return;
      setSelectedCardId(id);
      history.replaceState(null, "", window.location.pathname + window.location.search);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [cards]);

  const familiarsById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const filtered = useMemo(() => {
    // Hide cards whose delete is pending in the undo window (restored on Undo).
    const hidden = new Set((deletePending?.item ?? []).map((c) => c.id));
    return cards.filter(
      (c) =>
        !hidden.has(c.id) &&
        (scopeFamiliarIds
          ? familiarInScope(scopeFamiliarIds, c.familiarId)
          : activeFamiliarId === null || c.familiarId === activeFamiliarId) &&
        cardMatchesBoardSearch(c, searchQuery, familiarsById),
    );
  }, [cards, familiarsById, searchQuery, activeFamiliarId, scopeFamiliarIds, deletePending]);

  // Done cards in the CURRENT scope (the filtered set the user is viewing) —
  // the exact set "Clear done" operates on.
  const doneCards = useMemo(() => filtered.filter((c) => c.status === "done"), [filtered]);

  // The undo banner is transient — auto-dismiss ~5s after a clear.
  useEffect(() => {
    if (!clearedBanner) return;
    const t = window.setTimeout(() => setClearedBanner(null), 5000);
    return () => window.clearTimeout(t);
  }, [clearedBanner]);

  // The reschedule-undo banner is transient too.
  useEffect(() => {
    if (!rescheduleUndo) return;
    const t = window.setTimeout(() => setRescheduleUndo(null), 5000);
    return () => window.clearTimeout(t);
  }, [rescheduleUndo]);

  // Familiar grouping is redundant once the board is scoped to a single
  // familiar — fall back to status there. Status and project grouping stay
  // meaningful regardless of the familiar scope.
  const effectiveGroupBy: GroupBy = activeFamiliarId !== null && groupBy === "familiar" ? "status" : groupBy;
  // Familiar grouping is meaningless once the board is scoped to one familiar.
  const effectiveGanttGroup = ganttGroup === "familiar" && activeFamiliarId !== null ? "project" : ganttGroup;
  // Grouping applies to both the kanban (swimlanes) and table views; hidden on
  // phones, where BoardCardStack replaces both surfaces.
  const showGroupToggle = !isMobile;

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId) ?? null, [cards, selectedCardId]);

  useEffect(() => {
    if (selectedCardId && !cards.some((c) => c.id === selectedCardId)) setSelectedCardId(null);
  }, [cards, selectedCardId]);

  const lifecycleForStatus = (status: CardStatus) => {
    if (status === "running") return "running" as const;
    if (status === "review") return "review" as const;
    if (status === "blocked") return "failed" as const;
    if (status === "done") return "completed" as const;
    return "queued" as const;
  };

  const patchCard = async (id: string, patch: CardPatch, armUndo = true) => {
    if ("cwd" in patch || "projectId" in patch) setChatLinkError(null);
    // A date-only patch is a gantt reschedule — snapshot the prior dates so it
    // can be undone in one click (skipped when the patch IS an undo).
    const keys = Object.keys(patch).filter((k) => k !== "ops");
    const isReschedule = armUndo && keys.length > 0 && keys.every((k) => k === "startDate" || k === "endDate");
    if (isReschedule) {
      const before = cards.find((c) => c.id === id);
      if (before) {
        // A second reschedule of the same card inside the 5s banner window must
        // NOT overwrite the snapshot — Undo should restore the ORIGINAL dates,
        // not the intermediate position.
        setRescheduleUndo((pending) =>
          pending && pending.id === id
            ? pending
            : {
                id,
                title: before.title,
                prev: { startDate: before.startDate ?? null, endDate: before.endDate ?? null },
              });
        const range = [patch.startDate, patch.endDate].filter(Boolean).join(" to ");
        announce(`Rescheduled '${before.title}'${range ? ` — ${range}` : ""}. Undo available.`);
      }
    }
    setCards((prev) => prev.map((c) => {
      if (c.id !== id) return c;
      const { ops, ...plain } = patch;
      // Same resolution the server runs under its lock — optimistic view and
      // persisted result can't drift.
      return hasCardOps(ops)
        ? { ...c, ...plain, ...applyCardOps(c, ops, new Date().toISOString()) }
        : { ...c, ...plain };
    }));
    try {
      const res = await fetch(`/api/board/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const json = await res.json();
      if (!json.ok) {
        // Revert to the server copy and tell the user — an optimistic change
        // that silently snaps back reads as a glitch.
        setActionError(json.error ? `Couldn't save changes — ${json.error}` : "Couldn't save changes — reverted to the server copy.");
        await load();
      } else {
        setActionError(null);
        if (json.card) setCards((prev) => prev.map((c) => (c.id === id ? (json.card as Card) : c)));
      }
    } catch {
      setActionError("Couldn't reach the server — your change was reverted.");
      await load();
    }
  };

  const moveCardToStatus = (id: string, status: CardStatus) => {
    const patch: Partial<Card> = { status, lifecycle: lifecycleForStatus(status), needsHuman: status === "blocked" };
    if (status === "running") (patch as Record<string, unknown>).runningSince = new Date().toISOString();
    const title = cards.find((c) => c.id === id)?.title;
    if (title) announce(`Moved '${title}' to ${status.charAt(0).toUpperCase()}${status.slice(1)}.`);
    void patchCard(id, patch);
  };

  const create = async (draft: NewCardDraft) => {
    const res = await fetch("/api/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "create failed");
    announce(`Created task '${draft.title.trim()}'.`);
    await load();
  };

  // Inline quick-add from a kanban column: title-only card in that column's
  // status, scoped to the swimlane it was dropped under (familiar/project) or
  // the active familiar when ungrouped.
  const quickAdd = async (
    status: CardStatus,
    title: string,
    lane: { familiarId?: string | null; projectId?: string | null },
  ) => {
    await create({
      title: title.trim(),
      notes: "",
      status,
      priority: "medium",
      familiarId: lane.familiarId !== undefined ? lane.familiarId : (activeFamiliarId ?? null),
      sessionId: null,
      projectId: lane.projectId !== undefined ? lane.projectId : null,
      cwd: null,
      links: [],
      labels: [],
      startDate: null,
      endDate: null,
      template: null,
    });
  };

  // Schedule a deferred, undoable delete of one or more cards. The cards hide at
  // once (via the `filtered` exclusion), and the actual DELETEs fire only when
  // the undo window lapses; Undo just drops the timer and the cards reappear.
  const deleteCards = useCallback((toRemove: Card[]) => {
    if (toRemove.length === 0) return;
    const idSet = new Set(toRemove.map((c) => c.id));
    if (selectedCardId && idSet.has(selectedCardId)) setSelectedCardId(null);
    setClearedBanner(null); // one bottom undo affordance at a time
    announce(`Deleted ${toRemove.length} task${toRemove.length === 1 ? "" : "s"}. Undo available.`);
    scheduleCardDelete(
      toRemove,
      `${toRemove.length} task${toRemove.length === 1 ? "" : "s"}`,
      async () => {
        // Commit: drop from local state, then fire the DELETEs. Both the unhide
        // (pending → null) and this removal batch, so the cards never flash back.
        setCards((prev) => prev.filter((c) => !idSet.has(c.id)));
        const results = await Promise.all(
          toRemove.map(async (c) => {
            try {
              const res = await fetch(`/api/board/${c.id}`, { method: "DELETE" });
              return (await res.json()).ok as boolean;
            } catch { return false; }
          }),
        );
        const failed = results.filter((ok) => !ok).length;
        if (failed > 0) {
          setActionError(`Couldn't delete ${failed} of ${toRemove.length} task${toRemove.length === 1 ? "" : "s"} — reverted those.`);
          await load();
        } else {
          setActionError(null);
        }
      },
    );
  }, [selectedCardId, scheduleCardDelete, load]);

  const removeCard = async (id: string) => {
    const card = cards.find((c) => c.id === id);
    if (card) deleteCards([card]);
  };

  // ── Bulk select (kanban + table) ────────────────────────────────────────────
  const cardSelect = useMultiSelect(filtered, (c) => c.id);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const selectedCards = () => cardSelect.selectedFrom(filtered);
  // Existing labels across the board → datalist autocomplete for the bulk
  // add-label control (NOT a filter row — label filtering is search syntax).
  const bulkLabelOptions = useMemo(
    () => [...new Set(cards.flatMap((c) => c.labels))].sort(),
    [cards],
  );

  const bulkMove = async (status: CardStatus) => {
    const ids = selectedCards().map((c) => c.id);
    if (ids.length === 0) { cardSelect.exit(); return; }
    setBulkBusy(true);
    await Promise.all(ids.map((id) => moveCardToStatus(id, status)));
    setBulkBusy(false);
    cardSelect.exit();
  };

  const bulkAssign = async (familiarId: string) => {
    const ids = selectedCards().map((c) => c.id);
    if (ids.length === 0) { cardSelect.exit(); return; }
    setBulkBusy(true);
    await Promise.all(ids.map((id) => patchCard(id, { familiarId })));
    setBulkBusy(false);
    cardSelect.exit();
  };

  const bulkSetPriority = async (priority: CardPriority) => {
    const ids = selectedCards().map((c) => c.id);
    if (ids.length === 0) { cardSelect.exit(); return; }
    setBulkBusy(true);
    await Promise.all(ids.map((id) => patchCard(id, { priority })));
    setBulkBusy(false);
    cardSelect.exit();
  };

  // Add one label to every selected card (skip cards that already have it).
  const bulkAddLabel = async (raw: string) => {
    const label = raw.trim();
    const sel = selectedCards();
    if (!label || sel.length === 0) { if (sel.length === 0) cardSelect.exit(); return; }
    setBulkBusy(true);
    await Promise.all(
      sel
        .filter((c) => !c.labels.includes(label))
        .map((c) => patchCard(c.id, { labels: [...c.labels, label] })),
    );
    setBulkBusy(false);
    setLabelDraft("");
    cardSelect.exit();
  };

  const bulkDelete = () => {
    const sel = selectedCards();
    if (sel.length === 0) { cardSelect.exit(); return; }
    cardSelect.exit();
    // Deferred + undoable — no native confirm; the undo toast is the safety net.
    deleteCards(sel);
  };

  const STATUS_LABELS: Record<CardStatus, string> = {
    backlog: "Backlog", inbox: "Inbox", running: "Running",
    review: "Review", blocked: "Blocked", done: "Done",
  };
  const PRIORITY_LABELS: Record<CardPriority, string> = {
    urgent: "Urgent", high: "High", medium: "Medium", low: "Low",
  };

  const handleClearDone = async () => {
    const snapshot = doneCards;
    setClearConfirm(false);
    if (snapshot.length === 0) return;
    const ids = new Set(snapshot.map((c) => c.id));
    // Optimistic remove + drop selection if it pointed at a cleared card.
    setCards((prev) => prev.filter((c) => !ids.has(c.id)));
    if (selectedCardId && ids.has(selectedCardId)) setSelectedCardId(null);
    // Fire deletes in parallel; collect the cards whose delete failed.
    const results = await Promise.all(
      snapshot.map(async (c) => {
        try {
          const res = await fetch(`/api/board/${c.id}`, { method: "DELETE" });
          const json = await res.json();
          return json.ok ? null : c;
        } catch {
          return c;
        }
      }),
    );
    const failed = results.filter((c): c is Card => c !== null);
    const cleared = snapshot.filter((c) => !failed.some((f) => f.id === c.id));
    if (failed.length > 0) {
      // Resync from the server (failed cards reappear, cleared stay gone), then
      // surface the banner — mirrors the patchCard failure path.
      setActionError(
        `Couldn't clear ${failed.length} of ${snapshot.length} done task${snapshot.length === 1 ? "" : "s"} — reverted those.`,
      );
      await load();
    } else {
      setActionError(null);
    }
    if (cleared.length > 0) {
      setClearedBanner({ snapshot: cleared });
      announce(`Cleared ${cleared.length} done task${cleared.length === 1 ? "" : "s"}. Undo available.`);
    }
  };

  const handleUndoClear = async () => {
    const banner = clearedBanner;
    if (!banner) return;
    setClearedBanner(null);
    announce(`Restored ${banner.snapshot.length} cleared task${banner.snapshot.length === 1 ? "" : "s"}.`);
    try {
      await Promise.all(
        banner.snapshot.map((c) =>
          fetch("/api/board", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title: c.title,
              notes: c.notes,
              status: c.status,
              priority: c.priority,
              familiarId: c.familiarId,
              sessionId: c.sessionId,
              cwd: c.cwd,
              projectId: c.projectId,
              links: c.links,
              github: c.github,
              labels: c.labels,
              startDate: c.startDate,
              endDate: c.endDate,
              template: c.template,
              steps: c.steps.map((s) => ({ text: s.text })),
            }),
          }),
        ),
      );
    } catch {
      setActionError("Couldn't restore all cleared tasks — reload to check.");
    }
    await load();
  };

  // Revert a gantt reschedule to its snapshotted dates (without re-arming undo).
  const handleUndoReschedule = () => {
    const u = rescheduleUndo;
    if (!u) return;
    setRescheduleUndo(null);
    announce(`Restored '${u.title}' to its previous dates.`);
    void patchCard(u.id, u.prev, false);
  };

  const startTaskChat = async (id: string, projectRoot?: string) => {
    const card = cards.find((candidate) => candidate.id === id);
    const fallbackFamiliarId = card?.familiarId ?? activeFamiliarId ?? familiars[0]?.id ?? null;
    setChatLinkingId(id);
    setChatLinkError(null);
    try {
      const res = await fetch(`/api/board/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          familiarId: fallbackFamiliarId,
          ...(projectRoot ? { projectRoot } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "failed to open task chat");
      if (json.card) {
        setCards((prev) => prev.map((candidate) => candidate.id === id ? json.card : candidate));
      }
      onJumpToSession?.(json.sessionId, json.familiarId);
    } catch (err) {
      setChatLinkError(err instanceof Error ? err.message : "failed to open task chat");
    } finally {
      setChatLinkingId(null);
    }
  };

  const onOpenTaskChat = async (id: string) => {
    const card = cards.find((candidate) => candidate.id === id);
    const project = card?.projectId ? chatProjectById(card.projectId, projects) : null;
    if (project) {
      await startTaskChat(id, project.root);
      return;
    }
    if (card && !card.sessionId && !card.cwd) {
      setChatLinkError("Choose a project for this task before starting chat, or open Projects to create one.");
      return;
    }
    await startTaskChat(id);
  };

  return (
    <section className="board-shell">
      {/* Header */}
      <header className="board-header">
        <span className="board-header-title">Tasks</span>
        <div className="board-search-wrap">
          <Icon name="ph:magnifying-glass" width={13} className="board-search-icon" />
          <label className="sr-only" htmlFor="board-search">Search tasks</label>
          <input
            ref={searchRef}
            id="board-search"
            className="board-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && searchQuery) {
                e.preventDefault();
                setSearchQuery("");
              }
            }}
            placeholder='Search tasks or type is:open cwd:coven-cave url:github'
          />
          {!searchQuery ? (
            <kbd aria-hidden className="board-search-kbd">/</kbd>
          ) : null}
          {searchQuery ? (
            <button
              type="button"
              className="board-search-clear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear task search"
            >
              <Icon name="ph:x-bold" width={10} />
            </button>
          ) : null}
        </div>
        <div className="board-header-controls">
          {/* Grouping drives status columns (kanban) / status rows (table) when
              "Status", and swimlanes / grouped rows when "Familiar" or
              "Project". The Familiar option is dropped while the board is
              already scoped to one familiar, where it would be redundant. */}
          {showGroupToggle ? (
            <div className="board-group-toggle" role="group" aria-label={viewMode === "gantt" ? "Group Gantt by" : "Group tasks by"}>
            {viewMode === "gantt" ? (
              <>
                <button
                  type="button"
                  className={`board-group-toggle-btn${effectiveGanttGroup === "project" ? " board-group-toggle-btn--active" : ""}`}
                  onClick={() => setGanttGroup("project")}
                  aria-pressed={effectiveGanttGroup === "project"}
                >
                  Project
                </button>
                <button
                  type="button"
                  className={`board-group-toggle-btn${effectiveGanttGroup === "task" ? " board-group-toggle-btn--active" : ""}`}
                  onClick={() => setGanttGroup("task")}
                  aria-pressed={effectiveGanttGroup === "task"}
                >
                  Task
                </button>
                {activeFamiliarId === null ? (
                  <button
                    type="button"
                    className={`board-group-toggle-btn${effectiveGanttGroup === "familiar" ? " board-group-toggle-btn--active" : ""}`}
                    onClick={() => setGanttGroup("familiar")}
                    aria-pressed={effectiveGanttGroup === "familiar"}
                  >
                    Familiar
                  </button>
                ) : null}
              </>
            ) : (
              <>
            <button
              type="button"
              className={`board-group-toggle-btn${effectiveGroupBy === "status" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("status")}
              aria-pressed={effectiveGroupBy === "status"}
            >
              Status
            </button>
            {activeFamiliarId === null ? (
              <button
                type="button"
                className={`board-group-toggle-btn${effectiveGroupBy === "familiar" ? " board-group-toggle-btn--active" : ""}`}
                onClick={() => setGroupBy("familiar")}
                aria-pressed={effectiveGroupBy === "familiar"}
              >
                Familiar
              </button>
            ) : null}
            <button
              type="button"
              className={`board-group-toggle-btn${effectiveGroupBy === "project" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("project")}
              aria-pressed={effectiveGroupBy === "project"}
            >
              Project
            </button>
              </>
            )}
            </div>
          ) : null}

          {/* Kanban/Table toggle — hidden on phones; BoardCardStack
              replaces both at <768px (see render branch below). */}
          <div className="board-view-toggle hidden md:flex" role="group" aria-label="Tasks view mode">
            <button type="button" aria-label="Kanban view"
              className={`board-view-toggle-btn${viewMode === "kanban" ? " board-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("kanban")}>
              <Icon name="ph:columns" width={14} />
            </button>
            <button type="button" aria-label="Table view"
              className={`board-view-toggle-btn${viewMode === "table" ? " board-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("table")}>
              <Icon name="ph:rows" width={14} />
            </button>
            <button type="button" aria-label="Timeline view"
              className={`board-view-toggle-btn${viewMode === "gantt" ? " board-view-toggle-btn--active" : ""}`}
              onClick={() => setViewMode("gantt")}>
              <Icon name="ph:chart-bar-bold" width={14} />
            </button>
          </div>

          {/* Chrome budget (§8): Select-multiple and Clear-done are occasional
              verbs — they live in the overflow menu. The destructive clear
              still routes through the inline confirm group, which temporarily
              replaces the menu while deciding. */}
          {clearConfirm ? (
            <div className="board-clear-confirm" role="group" aria-label="Confirm clear done tasks">
              <button
                type="button"
                className="board-toolbar-btn board-toolbar-btn--danger"
                onClick={() => void handleClearDone()}
              >
                <Icon name="ph:trash" width={13} />
                Clear {doneCards.length} done
              </button>
              <button
                type="button"
                className="board-toolbar-btn"
                onClick={() => setClearConfirm(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <OverflowMenu ariaLabel="More task actions">
              {!isMobile && (viewMode === "kanban" || viewMode === "table") && filtered.length > 0 && !cardSelect.selectMode ? (
                <PopoverItem
                  icon="ph:check-square"
                  onSelect={() => cardSelect.setSelectMode(true)}
                  title="Select multiple tasks"
                >
                  Select multiple
                </PopoverItem>
              ) : null}
              <PopoverItem
                icon="ph:trash"
                danger
                disabled={doneCards.length === 0}
                onSelect={() => setClearConfirm(true)}
                title="Remove all done tasks in view"
              >
                Clear done
              </PopoverItem>
            </OverflowMenu>
          )}

          <button
            type="button"
            className="board-new-card-btn"
            onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}
          >
            + New task
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-danger)_10%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-danger)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{error}</span>
          </span>
          <button
            type="button"
            onClick={() => void load()}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--color-danger)_38%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:arrow-clockwise" width={12} aria-hidden />
            Retry
          </button>
        </div>
      )}
      {chatLinkError && (
        <div
          role="alert"
          className="flex items-center gap-1.5 border-b border-[color-mix(in_oklch,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-warning)]"
        >
          <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate">{chatLinkError}</span>
        </div>
      )}
      {clearedBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-success)_30%,transparent)] bg-[color-mix(in_oklch,var(--color-success)_10%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:check-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              Cleared {clearedBanner.snapshot.length} done task{clearedBanner.snapshot.length === 1 ? "" : "s"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void handleUndoClear()}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--text-muted)_38%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:arrow-counter-clockwise" width={12} aria-hidden />
            Undo
          </button>
        </div>
      )}
      {rescheduleUndo && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--accent-presence)_30%,transparent)] bg-[color-mix(in_oklch,var(--accent-presence)_10%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--text-secondary)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:calendar-blank" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              Rescheduled “{rescheduleUndo.title}”
            </span>
          </span>
          <button
            type="button"
            onClick={handleUndoReschedule}
            className="focus-ring inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[color-mix(in_oklch,var(--text-muted)_38%,transparent)] bg-[var(--bg-base)]/35 px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--bg-raised)]"
          >
            <Icon name="ph:arrow-counter-clockwise" width={12} aria-hidden />
            Undo
          </button>
        </div>
      )}
      {actionError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-[color-mix(in_oklch,var(--color-warning)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_12%,var(--bg-base))] px-5 py-1.5 text-xs text-[var(--color-warning)]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Icon name="ph:warning-circle" width={13} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{actionError}</span>
          </span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            aria-label="Dismiss"
            className="focus-ring shrink-0 rounded p-0.5 text-[var(--color-warning)] transition-opacity hover:opacity-70"
          >
            <Icon name="ph:x-bold" width={11} aria-hidden />
          </button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {cardSelect.selectMode && (
          <div className="px-5 pt-3">
            <SelectionToolbar
              allSelected={cardSelect.allSelected(filtered)}
              count={cardSelect.selectedCount}
              onToggleSelectAll={() => cardSelect.toggleSelectAll(filtered)}
              onCancel={cardSelect.exit}
            >
              <label className="sr-only" htmlFor="board-bulk-move">Move selected tasks to status</label>
              <StandardSelect<CardStatus | "">
                id="board-bulk-move"
                label="Move selected tasks to status"
                disabled={bulkBusy || cardSelect.selectedCount === 0}
                value=""
                onChange={(next) => { if (next) void bulkMove(next); }}
                className="h-6 box-border rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1.5 text-[11px] text-[var(--text-secondary)] disabled:opacity-50"
                options={[
                  { value: "", label: "Move to...", disabled: true },
                  ...STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
                ]}
                placeholder="Move to..."
              />
              <label className="sr-only" htmlFor="board-bulk-assign">Assign selected tasks to a familiar</label>
              <StandardSelect
                id="board-bulk-assign"
                label="Assign selected tasks to a familiar"
                disabled={bulkBusy || cardSelect.selectedCount === 0}
                value=""
                onChange={(next) => { if (next) void bulkAssign(next); }}
                className="h-6 box-border rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1.5 text-[11px] text-[var(--text-secondary)] disabled:opacity-50"
                options={[
                  { value: "", label: "Assign to...", disabled: true },
                  ...familiars.map((f) => ({ value: f.id, label: f.display_name })),
                ]}
                placeholder="Assign to..."
              />
              <label className="sr-only" htmlFor="board-bulk-priority">Set priority of selected tasks</label>
              <StandardSelect<CardPriority | "">
                id="board-bulk-priority"
                label="Set priority of selected tasks"
                disabled={bulkBusy || cardSelect.selectedCount === 0}
                value=""
                onChange={(next) => { if (next) void bulkSetPriority(next); }}
                className="h-6 box-border rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1.5 text-[11px] text-[var(--text-secondary)] disabled:opacity-50"
                options={[
                  { value: "", label: "Priority...", disabled: true },
                  ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] })),
                ]}
                placeholder="Priority..."
              />
              <form
                className="inline-flex items-center gap-1"
                onSubmit={(e) => { e.preventDefault(); void bulkAddLabel(labelDraft); }}
              >
                <input
                  list="board-bulk-label-options"
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  placeholder="Add label…"
                  aria-label="Add a label to selected tasks"
                  disabled={bulkBusy || cardSelect.selectedCount === 0}
                  className="focus-ring h-6 box-border w-24 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-50"
                />
                <datalist id="board-bulk-label-options">
                  {bulkLabelOptions.map((l) => <option key={l} value={l} />)}
                </datalist>
                <button
                  type="submit"
                  disabled={bulkBusy || cardSelect.selectedCount === 0 || !labelDraft.trim()}
                  title="Add this label to the selected tasks"
                  className="focus-ring h-6 box-border inline-flex items-center gap-1 rounded border border-[var(--border-hairline)] bg-[var(--bg-base)] px-1.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                >
                  <Icon name="ph:tag-bold" width={11} aria-hidden />
                  Label
                </button>
              </form>
              <button
                type="button"
                disabled={bulkBusy || cardSelect.selectedCount === 0}
                onClick={() => void bulkDelete()}
                className="focus-ring h-6 box-border inline-flex items-center gap-1 rounded border border-[var(--color-danger)]/50 bg-[var(--color-danger)]/10 px-1.5 text-[11px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 disabled:opacity-50"
              >
                <Icon name="ph:trash-bold" width={11} aria-hidden />
                {bulkBusy ? "Working…" : `Delete${cardSelect.selectedCount ? ` ${cardSelect.selectedCount}` : ""}`}
              </button>
            </SelectionToolbar>
          </div>
        )}
        {!hasLoaded && !error ? (
          <div className="h-full min-h-0" role="status" aria-label="Loading tasks">
            {viewMode === "kanban" ? (
              <BoardKanbanSkeleton />
            ) : (
              <div className="p-4">
                <SkeletonRows count={8} />
              </div>
            )}
          </div>
        ) : cards.length === 0 && !error ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md rounded-xl border border-dashed border-[var(--border-hairline)] bg-[var(--bg-raised)]/35 p-6 text-center">
              <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] text-[var(--text-muted)]">
                <Icon name="ph:kanban" width={18} aria-hidden />
              </span>
              <h2 className="text-[14px] font-semibold text-[var(--text-primary)]">Queue your first task</h2>
              <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">
                The board collects work in flight across your familiars. Add a task and assign it to whoever should pick it up &mdash; chat threads can link back to it later.
              </p>
              <button
                type="button"
                onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-[var(--accent-presence-foreground)] transition-opacity hover:opacity-85"
              >
                <Icon name="ph:plus-bold" width={12} />
                New task
              </button>
            </div>
          </div>
        ) : filtered.length === 0 && !error ? (
          // The board has cards, but the active search/scope hides them all.
          // Every view mode lands here so the kanban no longer silently shows
          // empty columns when nothing matches.
          <div className="flex h-full items-center justify-center p-6">
            {searchQuery.trim() ? (
              <EmptyState
                icon="ph:magnifying-glass"
                headline="No tasks match your search"
                subtitle={`Nothing matches “${searchQuery.trim()}”. Try a different term or clear the search.`}
                actions={
                  <Button leadingIcon="ph:x" onClick={() => setSearchQuery("")}>
                    Clear search
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="ph:kanban"
                headline="No tasks for this familiar yet"
                subtitle="Switch scope from the familiar menu, or add a task for this one."
                actions={
                  <Button
                    leadingIcon="ph:plus"
                    onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}
                  >
                    New task
                  </Button>
                }
              />
            )}
          </div>
        ) : isMobile ? (
          <BoardCardStack cards={filtered} familiars={familiars} sessions={sessions}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onMoveStatus={moveCardToStatus}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : viewMode === "kanban" ? (
          <BoardKanban cards={filtered} familiars={familiars} projects={projects} sessions={sessions}
            groupBy={effectiveGroupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} onMoveStatus={moveCardToStatus}
            selectMode={cardSelect.selectMode} isSelected={cardSelect.isSelected} onToggleSelect={cardSelect.toggle}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            wipLimits={wipLimits} onSetWipLimit={setWipLimitFor}
            onQuickAdd={quickAdd}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : viewMode === "gantt" ? (
          <BoardGantt cards={filtered} familiars={familiars} projects={projects}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onPatch={patchCard}
            groupMode={effectiveGanttGroup} />
        ) : (
          <BoardTable cards={filtered} familiars={familiars} projects={projects}
            groupBy={effectiveGroupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            selectMode={cardSelect.selectMode} isSelected={cardSelect.isSelected} onToggleSelect={cardSelect.toggle}
            onPatch={patchCard} />
        )}
      </div>

      {/* Inspector drawer */}
      {selectedCard && (
        <BoardInspector
          // Remount per card: the drawer's title/notes are uncontrolled
          // (defaultValue + save-on-blur), so switching cards while open must
          // reset them — otherwise a blur writes card A's text onto card B.
          key={selectedCard.id}
          card={selectedCard} familiars={familiars} sessions={sessions} projects={projects}
          onClose={() => setSelectedCardId(null)}
          onPatch={patchCard}
          onMoveStatus={moveCardToStatus}
          onDelete={removeCard}
          onCardReplaced={(next) => setCards((prev) => prev.map((c) => (c.id === next.id ? next : c)))}
          onJumpToSession={onJumpToSession}
          onOpenTaskChat={onOpenTaskChat}
          onOpenUrl={onOpenUrl}
          chatLinking={chatLinkingId === selectedCard.id}
          chatLinkError={chatLinkingId === null && !selectedCard.sessionId ? chatLinkError : null}
        />
      )}

      <NewCardModal open={modalOpen} onClose={() => setModalOpen(false)}
        familiars={familiars} sessions={sessions} projects={projects}
        defaultStatus={modalDefaultStatus} defaultFamiliarId={activeFamiliarId}
        onCreate={create} />
      {deletePending ? (
        <UndoToast
          key={deletePending.id}
          message={`Deleted ${deletePending.label}`}
          undoAriaLabel="Undo delete"
          onUndo={() => { announce(`Restored ${deletePending.label}.`); undoCardDelete(); }}
          onDismiss={commitCardDelete}
        />
      ) : null}
    </section>
  );
}

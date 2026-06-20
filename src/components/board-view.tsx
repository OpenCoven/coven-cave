"use client";

import "@/styles/board.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { DEMO_MODE_EVENT, isDemoModeEnabled } from "@/lib/demo-mode";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";
import { type Card, type CardStatus } from "@/lib/cave-board-types";
import { cardMatchesBoardSearch } from "@/lib/board-search";
import { BoardKanban } from "@/components/board-kanban";
import { BoardGantt } from "@/components/board-gantt";
import { BoardTable, type GroupBy } from "@/components/board-table";
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
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenUrl?: (url: string) => void;
};

export function BoardView({ familiars, sessions, activeFamiliarId, onJumpToSession, onOpenUrl }: Props) {
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Distinguish "still loading" from "loaded and empty" so the empty-state
  // CTA doesn't flash on every open before the first GET resolves.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Transient feedback when an optimistic mutation fails and is reverted.
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadPref("cave:board:viewMode", "kanban", ["kanban", "table", "gantt"]));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref("cave:board:groupBy", "status", ["status", "familiar", "project"]));
  const [searchQuery, setSearchQuery] = useState("");
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

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as Card[];
        // Demo mode only seeds when the API actually returned ok+empty.
        // On error, fall through so the user sees the failure.
        setCards(isDemoModeEnabled() && loaded.length === 0 ? DEMO_BOARD_CARDS : loaded);
        setError(null);
      } else {
        setCards([]);
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      setCards([]);
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const onDemoModeChange = () => { void load(); };
    window.addEventListener(DEMO_MODE_EVENT, onDemoModeChange);
    return () => window.removeEventListener(DEMO_MODE_EVENT, onDemoModeChange);
  }, [load]);
  useEffect(() => { localStorage.setItem("cave:board:viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("cave:board:groupBy", groupBy); }, [groupBy]);

  // External create paths dispatch `cave:board:reload` after POST so the board
  // picks up the new card without a full surface remount.
  useEffect(() => {
    const onReload = () => { void load(); };
    window.addEventListener("cave:board:reload", onReload);
    return () => window.removeEventListener("cave:board:reload", onReload);
  }, [load]);

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
  const filtered = useMemo(
    () =>
      cards.filter(
        (c) =>
          (activeFamiliarId === null || c.familiarId === activeFamiliarId) &&
          cardMatchesBoardSearch(c, searchQuery, familiarsById),
      ),
    [cards, familiarsById, searchQuery, activeFamiliarId],
  );

  const stats = useMemo(() => ({
    total: filtered.length,
    running: filtered.filter((c) => c.status === "running").length,
    blocked: filtered.filter((c) => c.status === "blocked" || c.needsHuman).length,
  }), [filtered]);

  // Done cards in the CURRENT scope (the filtered set the user is viewing) —
  // the exact set "Clear done" operates on.
  const doneCards = useMemo(() => filtered.filter((c) => c.status === "done"), [filtered]);

  // The undo banner is transient — auto-dismiss ~5s after a clear.
  useEffect(() => {
    if (!clearedBanner) return;
    const t = window.setTimeout(() => setClearedBanner(null), 5000);
    return () => window.clearTimeout(t);
  }, [clearedBanner]);

  // Familiar grouping is redundant once the board is scoped to a single
  // familiar — fall back to status there. Status and project grouping stay
  // meaningful regardless of the familiar scope.
  const effectiveGroupBy: GroupBy = activeFamiliarId !== null && groupBy === "familiar" ? "status" : groupBy;
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

  const patchCard = async (id: string, patch: Partial<Card>) => {
    if ("cwd" in patch || "projectId" in patch) setChatLinkError(null);
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
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
      }
    } catch {
      setActionError("Couldn't reach the server — your change was reverted.");
      await load();
    }
  };

  const moveCardToStatus = (id: string, status: CardStatus) => {
    const patch: Partial<Card> = { status, lifecycle: lifecycleForStatus(status), needsHuman: status === "blocked" };
    if (status === "running") (patch as Record<string, unknown>).runningSince = new Date().toISOString();
    void patchCard(id, patch);
  };

  const create = async (draft: NewCardDraft) => {
    const res = await fetch("/api/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "create failed");
    await load();
  };

  const removeCard = async (id: string) => {
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) { if (selectedCardId === id) setSelectedCardId(null); await load(); }
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
    if (cleared.length > 0) setClearedBanner({ snapshot: cleared });
  };

  const handleUndoClear = async () => {
    const banner = clearedBanner;
    if (!banner) return;
    setClearedBanner(null);
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
    if (card && !card.sessionId && !card.cwd) {
      const project = card.projectId ? chatProjectById(card.projectId, projects) : null;
      if (project) {
        await startTaskChat(id, project.root);
        return;
      }
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
            id="board-search"
            className="board-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='Search tasks or type is:open cwd:coven-cave url:github'
          />
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
            <div className="board-group-toggle" role="group" aria-label="Group tasks by">
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
            <button
              type="button"
              className="board-toolbar-btn"
              onClick={() => setClearConfirm(true)}
              disabled={doneCards.length === 0}
              title="Remove all done tasks in view"
            >
              <Icon name="ph:trash" width={13} />
              Clear done
            </button>
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
        {!hasLoaded && !error ? (
          <div className="flex h-full items-center justify-center p-6" role="status" aria-label="Loading tasks">
            <Icon name="ph:circle-notch-bold" width={20} className="animate-spin text-[var(--text-muted)]" aria-hidden />
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
                className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent-presence)] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-85"
              >
                <Icon name="ph:plus-bold" width={12} />
                New task
              </button>
            </div>
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
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : viewMode === "gantt" ? (
          <BoardGantt cards={filtered}
            selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} />
        ) : (
          <BoardTable cards={filtered} familiars={familiars} projects={projects}
            groupBy={effectiveGroupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId}
            onPatch={patchCard} />
        )}
      </div>

      {/* Inspector drawer */}
      {selectedCard && (
        <BoardInspector card={selectedCard} familiars={familiars} sessions={sessions} projects={projects}
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
    </section>
  );
}

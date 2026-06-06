"use client";

import "@/styles/board.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_MODE, DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";
import { type Card, type CardStatus } from "@/lib/cave-board-types";
import { cardMatchesBoardSearch } from "@/lib/board-search";
import { BoardKanban } from "@/components/board-kanban";
import { BoardTable, type GroupBy } from "@/components/board-table";
import { BoardInspector } from "@/components/board-inspector";

type ViewMode = "kanban" | "table";

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
};

export function BoardView({ familiars, sessions, activeFamiliarId, onJumpToSession }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadPref("cave:board:viewMode", "kanban", ["kanban", "table"]));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref("cave:board:groupBy", "status", ["status", "familiar", "priority", "none"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");
  const [chatLinkingId, setChatLinkingId] = useState<string | null>(null);
  const [chatLinkError, setChatLinkError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as Card[];
        setCards(DEMO_MODE && loaded.length === 0 ? DEMO_BOARD_CARDS : loaded);
        setError(null);
      } else {
        setCards(DEMO_MODE ? DEMO_BOARD_CARDS : []);
        setError(DEMO_MODE ? null : (json.error ?? "load failed"));
      }
    } catch (err) {
      setCards(DEMO_MODE ? DEMO_BOARD_CARDS : []);
      setError(DEMO_MODE ? null : (err instanceof Error ? err.message : "load failed"));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem("cave:board:viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("cave:board:groupBy", groupBy); }, [groupBy]);

  const familiarsById = useMemo(() => new Map(familiars.map((f) => [f.id, f])), [familiars]);
  const filtered = useMemo(
    () => cards.filter((c) => cardMatchesBoardSearch(c, searchQuery, familiarsById)),
    [cards, familiarsById, searchQuery],
  );

  const stats = useMemo(() => ({
    total: filtered.length,
    running: cards.filter((c) => c.status === "running").length,
    blocked: cards.filter((c) => c.status === "blocked" || c.needsHuman).length,
  }), [cards, filtered]);

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
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const res = await fetch(`/api/board/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const json = await res.json();
    if (!json.ok) await load();
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

  const onOpenTaskChat = async (id: string) => {
    const card = cards.find((candidate) => candidate.id === id);
    const fallbackFamiliarId = card?.familiarId ?? activeFamiliarId ?? familiars[0]?.id ?? null;
    setChatLinkingId(id);
    setChatLinkError(null);
    try {
      const res = await fetch(`/api/board/${id}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ familiarId: fallbackFamiliarId }),
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
          <label className="sr-only" htmlFor="board-groupby">Group by</label>
          <select id="board-groupby" className="board-toolbar-select" value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
            <option value="status">Group: Status</option>
            <option value="familiar">Group: Familiar</option>
            <option value="priority">Group: Priority</option>
            <option value="none">No grouping</option>
          </select>

          <div className="board-view-toggle" role="group" aria-label="Tasks view mode">
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
          </div>

          <button type="button" className="board-new-card-btn"
            onClick={() => { setModalDefaultStatus("backlog"); setModalOpen(true); }}>
            + New task
          </button>
        </div>
      </header>

      {error && (
        <div className="border-b border-border bg-card px-5 py-1.5 text-xs text-muted-foreground">{error}</div>
      )}
      {chatLinkError && (
        <div className="border-b border-border bg-card px-5 py-1.5 text-xs text-muted-foreground">
          {chatLinkError}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {viewMode === "kanban" ? (
          <BoardKanban cards={filtered} familiars={familiars} sessions={sessions}
            groupBy={groupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} onMoveStatus={moveCardToStatus}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession}
            onOpenTaskChat={onOpenTaskChat}
            chatLinkingId={chatLinkingId} />
        ) : (
          <BoardTable cards={filtered} familiars={familiars}
            groupBy={groupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} />
        )}
      </div>

      {/* Inspector drawer */}
      {selectedCard && (
        <BoardInspector card={selectedCard} familiars={familiars} sessions={sessions}
          onClose={() => setSelectedCardId(null)}
          onPatch={patchCard}
          onMoveStatus={moveCardToStatus}
          onDelete={removeCard}
          onCardReplaced={(next) => setCards((prev) => prev.map((c) => (c.id === next.id ? next : c)))}
          onJumpToSession={onJumpToSession}
          onOpenTaskChat={onOpenTaskChat}
          chatLinking={chatLinkingId === selectedCard.id} />
      )}

      <NewCardModal open={modalOpen} onClose={() => setModalOpen(false)}
        familiars={familiars} sessions={sessions}
        defaultStatus={modalDefaultStatus} defaultFamiliarId={activeFamiliarId}
        onCreate={create} />
    </section>
  );
}

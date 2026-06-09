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
import { BoardCardStack } from "@/components/board-card-stack";
import { BoardInspector } from "@/components/board-inspector";
import { useIsMobile } from "@/lib/use-viewport";

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
  const isMobile = useIsMobile();
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(() => loadPref("cave:board:viewMode", "kanban", ["kanban", "table"]));
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadPref("cave:board:groupBy", "status", ["status", "familiar"]));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");
  const [chatLinkingId, setChatLinkingId] = useState<string | null>(null);
  const [chatLinkError, setChatLinkError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as Card[];
        // Demo mode only seeds when the API actually returned ok+empty.
        // On error, fall through so the user sees the failure.
        setCards(DEMO_MODE && loaded.length === 0 ? DEMO_BOARD_CARDS : loaded);
        setError(null);
      } else {
        setCards([]);
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      setCards([]);
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { localStorage.setItem("cave:board:viewMode", viewMode); }, [viewMode]);
  useEffect(() => { localStorage.setItem("cave:board:groupBy", groupBy); }, [groupBy]);

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

  const handleEnrichSteps = async () => {
    setEnriching(true);
    setEnrichProgress(null);
    try {
      const res = await fetch("/api/board/enrich-steps", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-coven-cave-intent": "board-enrich-steps",
        },
        body: JSON.stringify({ intent: "board-enrich-steps" }),
      });
      if (!res.ok) throw new Error(`enrich steps failed (${res.status})`);
      if (!res.body) throw new Error("enrich steps: missing response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.kind === "start") {
              setEnrichProgress({ done: 0, total: (msg.total as number) ?? 0 });
            } else if (msg.kind === "done" || msg.kind === "skip") {
              setEnrichProgress((prev) => prev ? { ...prev, done: prev.done + 1 } : prev);
            } else if (msg.kind === "complete") {
              await load();
            }
          } catch { /* */ }
        }
      }
      setEnriching(false);
    } catch {
      setEnriching(false);
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
          <div className="board-group-toggle" role="group" aria-label="Group tasks by">
            <button
              type="button"
              className={`board-group-toggle-btn${groupBy === "status" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("status")}
              aria-pressed={groupBy === "status"}
            >
              Status
            </button>
            <button
              type="button"
              className={`board-group-toggle-btn${groupBy === "familiar" ? " board-group-toggle-btn--active" : ""}`}
              onClick={() => setGroupBy("familiar")}
              aria-pressed={groupBy === "familiar"}
            >
              Familiar
            </button>
          </div>

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
          </div>

          <button
            type="button"
            className="board-toolbar-btn"
            onClick={handleEnrichSteps}
            disabled={enriching || cards.length === 0}
            title="Ask each familiar to populate steps for their assigned tasks"
          >
            <Icon name="ph:sparkle" width={13} />
            {enriching
              ? enrichProgress
                ? `${enrichProgress.done}/${enrichProgress.total}`
                : "Starting…"
              : "Enrich steps"}
          </button>
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
        {cards.length === 0 && !error ? (
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
            onSelect={setSelectedCardId}
            onPatch={patchCard} />
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
          chatLinking={chatLinkingId === selectedCard.id}
          chatLinkError={chatLinkingId === null && !selectedCard.sessionId ? chatLinkError : null}
        />
      )}

      <NewCardModal open={modalOpen} onClose={() => setModalOpen(false)}
        familiars={familiars} sessions={sessions}
        defaultStatus={modalDefaultStatus} defaultFamiliarId={activeFamiliarId}
        onCreate={create} />
    </section>
  );
}

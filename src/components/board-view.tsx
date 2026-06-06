"use client";

import "@/styles/board.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_MODE, DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";
import { type Card, type CardStatus } from "@/lib/cave-board-types";
import {
  type FilterState,
  emptyFilter,
} from "@/components/board-filter-popover";
import { BoardMultiSelect } from "@/components/board-multi-select";
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
  const [filter, setFilter] = useState<FilterState>(emptyFilter());
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");

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

  const filtered = useMemo(() => cards.filter((c) => {
    if (filter.priorities.size > 0 && !filter.priorities.has(c.priority)) return false;
    if (filter.familiarIds.size > 0 && !filter.familiarIds.has(c.familiarId ?? "")) return false;
    if (filter.statuses.size > 0 && !filter.statuses.has(c.status)) return false;
    if (filter.labels.size > 0 && !c.labels.some((l) => filter.labels.has(l))) return false;
    return true;
  }), [cards, filter]);

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    for (const c of cards) for (const l of c.labels) s.add(l);
    return [...s].sort();
  }, [cards]);

  const stats = useMemo(() => ({
    total: filtered.length,
    running: cards.filter((c) => c.status === "running").length,
    blocked: cards.filter((c) => c.status === "blocked" || c.needsHuman).length,
  }), [cards, filtered]);

  const selectedCard = useMemo(() => cards.find((c) => c.id === selectedCardId) ?? null, [cards, selectedCardId]);

  useEffect(() => {
    if (selectedCardId && !cards.some((c) => c.id === selectedCardId)) setSelectedCardId(null);
  }, [cards, selectedCardId]);

  // Build active filter chips
  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    for (const p of filter.priorities) chips.push({ label: `Priority: ${p.charAt(0).toUpperCase() + p.slice(1)}`, onRemove: () => setFilter((f) => { const s = new Set(f.priorities); s.delete(p); return { ...f, priorities: s }; }) });
    for (const id of filter.familiarIds) { const name = familiars.find((f) => f.id === id)?.display_name ?? id; chips.push({ label: `Familiar: ${name}`, onRemove: () => setFilter((f) => { const s = new Set(f.familiarIds); s.delete(id); return { ...f, familiarIds: s }; }) }); }
    for (const st of filter.statuses) chips.push({ label: `Status: ${st.charAt(0).toUpperCase() + st.slice(1)}`, onRemove: () => setFilter((f) => { const s = new Set(f.statuses); s.delete(st); return { ...f, statuses: s }; }) });
    for (const l of filter.labels) chips.push({ label: `Label: ${l}`, onRemove: () => setFilter((f) => { const s = new Set(f.labels); s.delete(l); return { ...f, labels: s }; }) });
    return chips;
  }, [filter, familiars]);

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

  return (
    <section className="board-shell">
      {/* Header */}
      <header className="board-header">
        <span className="board-header-title">Tasks</span>
        <div className="board-header-stats">
          <span>{stats.total} card{stats.total !== 1 ? "s" : ""}</span>
          {stats.running > 0 && <><span className="board-header-stats-sep">·</span><span>{stats.running} running</span></>}
          {stats.blocked > 0 && <><span className="board-header-stats-sep">·</span><span className="board-header-stats--blocked">{stats.blocked} blocked</span></>}
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

          <BoardMultiSelect
            label="Priority"
            icon="ph:dots-three-vertical"
            options={[
              { id: "urgent", label: "Urgent" },
              { id: "high",   label: "High" },
              { id: "medium", label: "Medium" },
              { id: "low",    label: "Low" },
            ]}
            selected={filter.priorities}
            onChange={(next) => setFilter((f) => ({ ...f, priorities: next as Set<import("@/lib/cave-board-types").CardPriority> }))}
          />

          <BoardMultiSelect
            label="Status"
            icon="ph:circle-fill"
            options={[
              { id: "backlog", label: "Backlog" },
              { id: "inbox",   label: "Inbox" },
              { id: "running", label: "Running" },
              { id: "review",  label: "Review" },
              { id: "blocked", label: "Blocked" },
              { id: "done",    label: "Done" },
            ]}
            selected={filter.statuses}
            onChange={(next) => setFilter((f) => ({ ...f, statuses: next as Set<import("@/lib/cave-board-types").CardStatus> }))}
          />

          <BoardMultiSelect
            label="Familiar"
            icon="ph:sparkle"
            options={familiars.map((f) => ({ id: f.id, label: f.display_name }))}
            selected={filter.familiarIds}
            onChange={(next) => setFilter((f) => ({ ...f, familiarIds: next }))}
            emptyLabel="No familiars configured"
          />

          {allLabels.length > 0 && (
            <BoardMultiSelect
              label="Labels"
              icon="ph:tag-bold"
              options={allLabels.map((l) => ({ id: l, label: l }))}
              selected={filter.labels}
              onChange={(next) => setFilter((f) => ({ ...f, labels: next }))}
            />
          )}

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

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="board-filter-chips">
          {activeChips.map((chip, i) => (
            <span key={i} className="board-filter-chip">
              {chip.label}
              <button type="button" className="board-filter-chip-remove" onClick={chip.onRemove} aria-label={`Remove filter`}>
                <Icon name="ph:x-bold" width={8} />
              </button>
            </span>
          ))}
          <button type="button" className="board-filter-chip--clear-all" onClick={() => setFilter(emptyFilter())}>Clear all</button>
        </div>
      )}

      {error && (
        <div className="border-b border-border bg-card px-5 py-1.5 text-xs text-muted-foreground">{error}</div>
      )}

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {viewMode === "kanban" ? (
          <BoardKanban cards={filtered} familiars={familiars} sessions={sessions}
            groupBy={groupBy} selectedCardId={selectedCardId}
            onSelect={setSelectedCardId} onMoveStatus={moveCardToStatus}
            onNewCard={(status) => { setModalDefaultStatus(status); setModalOpen(true); }}
            onJumpToSession={onJumpToSession} />
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
          onJumpToSession={onJumpToSession} />
      )}

      <NewCardModal open={modalOpen} onClose={() => setModalOpen(false)}
        familiars={familiars} sessions={sessions}
        defaultStatus={modalDefaultStatus} defaultFamiliarId={activeFamiliarId}
        onCreate={create} />
    </section>
  );
}

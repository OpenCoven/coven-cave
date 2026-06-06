"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { DEMO_MODE, DEMO_BOARD_CARDS } from "@/lib/demo-seed";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";
import { OriginChip } from "@/components/ui/origin-chip";
import {
  LifecycleBadge,
  formatTimeoutBadge,
} from "@/components/ui/lifecycle-badge";
import {
  DEFAULT_TIMEOUT_MS,
  type Card,
  type CardLifecycle,
  type CardPriority,
  type CardStatus,
} from "@/lib/cave-board-types";

// Priority chrome stays neutral per Mood C — visual emphasis comes from
// border + text weight, not saturated fills. Reserves accent for presence.
const PRIORITIES: { id: CardPriority; label: string; pill: string }[] = [
  { id: "urgent", label: "Urgent", pill: "bg-muted text-foreground border-border-strong" },
  { id: "high", label: "High", pill: "bg-card text-foreground border-border-strong" },
  { id: "medium", label: "Medium", pill: "bg-card text-muted-foreground border-border" },
  { id: "low", label: "Low", pill: "bg-card text-muted-foreground border-border" },
];

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
};

type BoardColumn = {
  id: CardStatus;
  label: string;
  hint: string;
};

const COLUMNS: BoardColumn[] = [
  { id: "backlog", label: "Backlog", hint: "Ideas and work not ready to dispatch." },
  { id: "inbox", label: "Inbox", hint: "Ready for a familiar to pick up." },
  { id: "running", label: "Running", hint: "In use by a familiar right now." },
  { id: "review", label: "Review", hint: "Needs human or maintainer review." },
  { id: "blocked", label: "Blocked", hint: "Waiting, failed, cancelled, or needs help." },
  { id: "done", label: "Done", hint: "Completed work." },
];

function lifecycleForStatus(status: CardStatus): CardLifecycle {
  if (status === "running") return "running";
  if (status === "review") return "review";
  if (status === "blocked") return "failed";
  if (status === "done") return "completed";
  return "queued";
}

function patchForStatus(status: CardStatus): Partial<Card> {
  const patch: Partial<Card> = {
    status,
    lifecycle: lifecycleForStatus(status),
    needsHuman: status === "blocked" ? true : false,
  };
  if (status === "running") patch.runningSince = new Date().toISOString();
  return patch;
}

export function BoardView({ familiars, sessions, activeFamiliarId, onJumpToSession }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("backlog");
  const [priorityFilter, setPriorityFilter] = useState<Set<CardPriority>>(new Set());
  const [scopeToFamiliar, setScopeToFamiliar] = useState<boolean>(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const boardRailRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        const loaded = json.cards as import("@/lib/cave-board-types").Card[];
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

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (priorityFilter.size > 0 && !priorityFilter.has(c.priority)) return false;
      if (scopeToFamiliar && activeFamiliarId && c.familiarId !== activeFamiliarId) return false;
      return true;
    });
  }, [cards, priorityFilter, scopeToFamiliar, activeFamiliarId]);

  const grouped = useMemo(() => {
    const m = new Map<CardStatus, Card[]>();
    for (const col of COLUMNS) m.set(col.id, []);
    for (const c of filtered) m.get(c.status)?.push(c);
    return m;
  }, [filtered]);

  const selectedCard = useMemo(
    () => cards.find((c) => c.id === selectedCardId) ?? null,
    [cards, selectedCardId],
  );

  const boardStats = useMemo(() => {
    const running = cards.filter((c) => c.status === "running").length;
    const blocked = cards.filter((c) => c.status === "blocked" || c.needsHuman).length;
    const review = cards.filter((c) => c.status === "review").length;
    const done = cards.filter((c) => c.status === "done").length;
    return { running, blocked, review, done };
  }, [cards]);

  useEffect(() => {
    if (selectedCardId && !cards.some((c) => c.id === selectedCardId)) {
      setSelectedCardId(null);
    }
  }, [cards, selectedCardId]);

  const togglePriority = (p: CardPriority) => {
    setPriorityFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const create = async (draft: NewCardDraft) => {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error ?? "create failed");
    await load();
  };

  const patchCard = async (id: string, patch: Partial<Card>) => {
    // Optimistic local update so drag-and-drop feels instant
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    const res = await fetch(`/api/board/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.ok) await load(); // reconcile on failure
  };

  const replaceCard = (next: Card) => {
    setCards((prev) => prev.map((c) => (c.id === next.id ? next : c)));
    setSelectedCardId(next.id);
  };

  const moveCardToStatus = (id: string, status: CardStatus) => {
    void patchCard(id, patchForStatus(status));
  };

  const scrollColumns = (direction: -1 | 1) => {
    const rail = boardRailRef.current;
    if (!rail) return;
    const step = Math.max(rail.clientWidth * 0.72, 280);
    rail.scrollBy({ left: step * direction, behavior: "smooth" });
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    draggingIdRef.current = id;
    setDraggingId(id);
    try {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.setData("application/x-cave-card", id);
    } catch {
      /* some WebKit builds restrict setData on certain types — ref still works */
    }
  };
  const handleDragEnd = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };
  // dragenter/dragover both preventDefault — WebKit needs the former too on some elements
  const handleDragEnter = (e: React.DragEvent, status: CardStatus) => {
    e.preventDefault();
    if (dropTarget !== status) setDropTarget(status);
  };
  const handleDragOver = (e: React.DragEvent, status: CardStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dropTarget !== status) setDropTarget(status);
  };
  const handleDragLeave = (e: React.DragEvent, status: CardStatus) => {
    // Only clear when leaving the column entirely (not when moving onto a child)
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    if (dropTarget === status) setDropTarget(null);
  };
  const handleDrop = (e: React.DragEvent, status: CardStatus) => {
    e.preventDefault();
    e.stopPropagation();
    const id =
      e.dataTransfer.getData("application/x-cave-card") ||
      e.dataTransfer.getData("text/plain") ||
      draggingIdRef.current ||
      draggingId;
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === status) return;
    moveCardToStatus(id, status);
  };

  const removeCard = async (id: string) => {
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) {
      if (selectedCardId === id) setSelectedCardId(null);
      await load();
    }
  };

  return (
    <section className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">Board</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>
              {filtered.length} of {cards.length} card{cards.length === 1 ? "" : "s"}
            </span>
            <span className="text-border-strong">/</span>
            <span>{boardStats.running} running</span>
            <span>{boardStats.review} in review</span>
            <span className={boardStats.blocked > 0 ? "text-rose-200" : undefined}>
              {boardStats.blocked} blocked
            </span>
            <span>{boardStats.done} done</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Board column navigation">
            <button
              type="button"
              onClick={() => scrollColumns(-1)}
              aria-label="Show previous board columns"
              title="Show previous board columns"
              className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="ph:arrow-left-bold" width={12} />
            </button>
            <button
              type="button"
              onClick={() => scrollColumns(1)}
              aria-label="Show next board columns"
              title="Show next board columns"
              className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Icon name="ph:arrow-right-bold" width={12} />
            </button>
          </div>
          {activeFamiliarId ? (
            <button
              onClick={() => setScopeToFamiliar((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                scopeToFamiliar
                  ? "border-border-strong bg-muted text-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
              title="Show only the active familiar's cards"
            >
              scope · {familiars.find((f) => f.id === activeFamiliarId)?.display_name ?? "active"}
            </button>
          ) : null}
          <button
            onClick={() => {
              setModalDefaultStatus("backlog");
              setModalOpen(true);
            }}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            + New card
          </button>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">priority</span>
          {PRIORITIES.map((p) => {
            const on = priorityFilter.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => togglePriority(p.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  on ? p.pill : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          {priorityFilter.size > 0 ? (
            <button
              onClick={() => setPriorityFilter(new Set())}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="border-b border-border bg-card px-5 py-1.5 text-xs text-muted-foreground">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(260px,40vh)] overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_400px]">
        {cards.length === 0 ? (
          <div className="flex min-h-0 flex-col items-center justify-center gap-3 px-5 py-12">
            <p className="text-[13px] text-muted-foreground">No cards yet.</p>
            <button
              onClick={() => {
                setModalDefaultStatus("backlog");
                setModalOpen(true);
              }}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              + New card
            </button>
          </div>
        ) : (
          <div className="min-h-0 overflow-hidden">
            <div
              ref={boardRailRef}
              className="h-full overflow-x-auto overflow-y-hidden scroll-smooth"
            >
              <div className="flex h-full min-w-max gap-3 px-5 py-4">
                {COLUMNS.map((col) => {
                  const rows = grouped.get(col.id) ?? [];
                  const isDropTarget = dropTarget === col.id;
                  return (
                    <div
                      key={col.id}
                      onDragEnter={(e) => handleDragEnter(e, col.id)}
                      onDragOver={(e) => handleDragOver(e, col.id)}
                      onDragLeave={(e) => handleDragLeave(e, col.id)}
                      onDrop={(e) => handleDrop(e, col.id)}
                      className={`flex h-full w-[260px] flex-shrink-0 flex-col rounded-lg border bg-card transition-colors sm:w-[280px] xl:w-[300px] ${
                        isDropTarget
                          ? "border-border-strong bg-muted"
                          : "border-border"
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-border px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground" title={col.hint}>
                            {col.label}
                          </span>
                          <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                            {rows.length}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setModalDefaultStatus(col.id);
                            setModalOpen(true);
                          }}
                          title={`Add card to ${col.label}`}
                          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          +
                        </button>
                      </div>

                      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                        {rows.length === 0 ? (
                          <li
                            className={`rounded-md border border-dashed px-3 py-4 text-center text-[11px] transition-colors ${
                              isDropTarget
                                ? "border-border-strong text-foreground"
                                : "border-border text-muted-foreground"
                            }`}
                          >
                            {isDropTarget ? "Drop here" : col.hint}
                          </li>
                        ) : null}
                        {rows.map((card) => (
                          <CardItem
                            key={card.id}
                            card={card}
                            familiars={familiars}
                            sessions={sessions}
                            isDragging={draggingId === card.id}
                            isSelected={selectedCardId === card.id}
                            onSelect={() => setSelectedCardId(card.id)}
                            onDragStart={(e) => handleDragStart(e, card.id)}
                            onDragEnd={handleDragEnd}
                            onJumpToSession={onJumpToSession}
                          />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <BoardDetailPanel
          card={selectedCard}
          familiars={familiars}
          sessions={sessions}
          onClose={() => setSelectedCardId(null)}
          onPatch={(id, patch) => patchCard(id, patch)}
          onMoveStatus={moveCardToStatus}
          onDelete={removeCard}
          onCardReplaced={replaceCard}
          onJumpToSession={onJumpToSession}
        />
      </div>

      <NewCardModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        familiars={familiars}
        sessions={sessions}
        defaultStatus={modalDefaultStatus}
        defaultFamiliarId={activeFamiliarId}
        onCreate={create}
      />
    </section>
  );
}

function CardItem({
  card,
  familiars,
  sessions,
  isDragging,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
  onJumpToSession,
}: {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  isDragging?: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
}) {
  const draggedRef = useRef(false);
  const familiar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const pri = PRIORITIES.find((p) => p.id === card.priority)!;

  return (
    <li
      draggable
      onDragStart={(e) => {
        draggedRef.current = true;
        onDragStart?.(e);
      }}
      onDragEnd={() => {
        // Reset the "did-drag" flag on the next tick so a click that comes
        // right after a drop is suppressed, but later clicks expand.
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
        onDragEnd?.();
      }}
      onClick={() => {
        if (draggedRef.current) return;
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect();
      }}
      tabIndex={0}
      aria-selected={isSelected}
      className={`cursor-grab rounded-lg border bg-background p-3 outline-none transition-all active:cursor-grabbing ${
        isSelected
          ? "border-border-strong bg-muted/60 ring-1 ring-border-strong"
          : "border-border hover:border-border-strong hover:bg-muted/30"
      } ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${pri.pill}`}>
          {pri.label}
        </span>
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          {card.status}
        </span>
      </div>

      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">
          {card.title}
        </span>
        <Icon
          name={isSelected ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"}
          width="0.9rem"
          height="0.9rem"
          className="mt-0.5 shrink-0 text-muted-foreground"
        />
      </div>

      {card.notes ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
          {card.notes}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
        {card.lifecycle === "running" ? (
          <TimeoutBadge runningSince={card.runningSince} timeoutMs={card.timeoutMs} />
        ) : null}
        {card.retryCount > 0 ? (
          <span
            className="rounded border border-border bg-card px-1.5 py-px text-[10px] uppercase tracking-widest text-muted-foreground"
            title="Times this card was retried after failure"
          >
            retry {card.retryCount}/{card.maxRetries}
          </span>
        ) : null}
        {card.labels.slice(0, 3).map((l) => (
          <span
            key={l}
            className="rounded border border-border bg-card px-1.5 py-px text-[10px] text-foreground"
          >
            {l}
          </span>
        ))}
        {card.labels.length > 3 ? (
          <span className="text-[10px] text-muted-foreground">+{card.labels.length - 3}</span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        {familiar ? (
          <span className="min-w-0 truncate" title={`${familiar.display_name} · ${familiar.harness ?? "?"}`}>
            {familiar.display_name}
          </span>
        ) : (
          <span>unassigned</span>
        )}
        {session ? (
          <>
            {session.origin ? (
              <span className="ml-auto">
                <OriginChip origin={session.origin} iconOnly />
              </span>
            ) : null}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onJumpToSession?.(session.id, session.familiarId ?? null);
              }}
              title={`Open session: ${session.title || "(untitled)"}`}
              className={`${session.origin ? "" : "ml-auto"} rounded border border-border bg-card px-1.5 py-px text-foreground transition-colors hover:bg-muted`}
            >
              open
            </button>
          </>
        ) : null}
      </div>
    </li>
  );
}

function BoardDetailPanel({
  card,
  familiars,
  sessions,
  onClose,
  onPatch,
  onMoveStatus,
  onDelete,
  onCardReplaced,
  onJumpToSession,
}: {
  card: Card | null;
  familiars: Familiar[];
  sessions: SessionRow[];
  onClose: () => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onDelete: (id: string) => void;
  onCardReplaced: (card: Card) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
}) {
  const familiar = card ? familiars.find((f) => f.id === card.familiarId) ?? null : null;
  const session = card ? sessions.find((s) => s.id === card.sessionId) ?? null : null;
  const priority = card ? PRIORITIES.find((p) => p.id === card.priority)! : null;
  const eligibleSessions = card
    ? sessions.filter((s) => !card.familiarId || s.familiarId === card.familiarId).slice(0, 40)
    : [];

  return (
    <aside className="flex min-h-[260px] min-w-0 flex-col border-t border-border bg-card/70 lg:min-h-0 lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Selected card
          </div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {card ? "Inspector" : "Nothing selected"}
          </div>
        </div>
        {card ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close selected card panel"
            title="Close selected card panel"
            className="grid h-7 w-7 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="ph:x-bold" width="0.75rem" height="0.75rem" />
          </button>
        ) : null}
      </div>

      {card ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">
              {card.title}
            </h2>
            {priority ? (
              <span className={`shrink-0 rounded border px-2 py-1 text-[10px] uppercase tracking-widest ${priority.pill}`}>
                {priority.label}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
            {card.lifecycle === "running" ? (
              <TimeoutBadge runningSince={card.runningSince} timeoutMs={card.timeoutMs} />
            ) : null}
            <span className="rounded border border-border bg-background px-1.5 py-px text-[10px] uppercase tracking-widest text-muted-foreground">
              {card.status}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <Mini label="Status">
              <select
                value={card.status}
                onChange={(e) => onMoveStatus(card.id, e.target.value as CardStatus)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
              >
                {COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Mini>
            <Mini label="Priority">
              <select
                value={card.priority}
                onChange={(e) => onPatch(card.id, { priority: e.target.value as CardPriority })}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Mini>
            <Mini label="Familiar">
              <select
                value={card.familiarId ?? ""}
                onChange={(e) => onPatch(card.id, { familiarId: e.target.value || null })}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
              >
                <option value="">Default familiar</option>
                {familiars.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.display_name}
                  </option>
                ))}
              </select>
            </Mini>
            <Mini label="Session">
              <select
                value={card.sessionId ?? ""}
                onChange={(e) => onPatch(card.id, { sessionId: e.target.value || null })}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
              >
                <option value="">No linked session</option>
                {eligibleSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(s.title || "(untitled)").slice(0, 34)}
                  </option>
                ))}
              </select>
            </Mini>
          </div>

          <DetailSection label="Notes">
            {card.notes ? (
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
                {card.notes}
              </p>
            ) : (
              <p className="text-[12px] text-muted-foreground">No notes on this card.</p>
            )}
          </DetailSection>

          <DetailSection label="Assignment">
            <div className="space-y-2 text-[12px] text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>Familiar</span>
                <span className="min-w-0 truncate text-foreground">
                  {familiar ? familiar.display_name : "Default familiar"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>Session</span>
                {session ? (
                  <button
                    type="button"
                    onClick={() => onJumpToSession?.(session.id, session.familiarId ?? null)}
                    className="min-w-0 truncate rounded border border-border bg-background px-2 py-1 text-foreground transition-colors hover:bg-muted"
                    title={session.title || "(untitled)"}
                  >
                    {session.title || "(untitled)"}
                  </button>
                ) : (
                  <span className="text-foreground">No linked session</span>
                )}
              </div>
            </div>
          </DetailSection>

          {card.labels.length > 0 ? (
            <DetailSection label="Labels">
              <div className="flex flex-wrap gap-1.5">
                {card.labels.map((label) => (
                  <span
                    key={label}
                    className="rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </DetailSection>
          ) : null}

          {card.lifecycleReason ? (
            <DetailSection label="Reason">
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {card.lifecycleReason}
              </p>
            </DetailSection>
          ) : null}

          <DetailSection label="Lifecycle">
            <LifecycleActions card={card} onChanged={onCardReplaced} />
          </DetailSection>

          <DetailSection label="Audit">
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>
                <div className="uppercase tracking-widest text-[9px]">Created</div>
                <div className="mt-0.5 text-foreground">{formatCompactDate(card.createdAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-widest text-[9px]">Updated</div>
                <div className="mt-0.5 text-foreground">{formatCompactDate(card.updatedAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-widest text-[9px]">Retries</div>
                <div className="mt-0.5 text-foreground">{card.retryCount}/{card.maxRetries}</div>
              </div>
              <div>
                <div className="uppercase tracking-widest text-[9px]">Lifecycle at</div>
                <div className="mt-0.5 text-foreground">{formatCompactDate(card.lifecycleAt)}</div>
              </div>
            </div>
          </DetailSection>

          <div className="mt-4 flex justify-end border-t border-border pt-3">
            <button
              type="button"
              onClick={() => {
                if (confirm("Delete card?")) onDelete(card.id);
              }}
              className="rounded border border-border bg-background px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Delete card
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center px-4 py-8 text-sm text-muted-foreground">
          <Icon name="ph:sidebar-simple" width="1.5rem" height="1.5rem" className="mb-3 text-muted-foreground" />
          <p className="text-foreground">Select a card to inspect it.</p>
          <p className="mt-1 text-[12px] leading-relaxed">
            The panel keeps details, assignment, lifecycle actions, and audit context visible without expanding cards inside the board.
          </p>
        </div>
      )}
    </aside>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {children}
    </section>
  );
}

function formatCompactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** Live-updating "running 47m of 2h" badge — ticks once per minute. */
function TimeoutBadge({
  runningSince,
  timeoutMs,
}: {
  runningSince: string | undefined;
  timeoutMs: number | undefined;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  const text = formatTimeoutBadge(runningSince, timeoutMs, DEFAULT_TIMEOUT_MS);
  if (!text) return null;
  const elapsed = runningSince ? Date.now() - new Date(runningSince).getTime() : 0;
  const limit = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const overLimit = elapsed > limit;
  return (
    <span
      title={overLimit ? "Running past timeout — needs attention" : text}
      className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-widest ${
        overLimit
          ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
          : "border-border bg-card text-muted-foreground"
      }`}
    >
      {text}
    </span>
  );
}

/**
 * Lifecycle transition buttons. Only renders moves valid from the current
 * state so reviewers don't have to remember the machine in their head.
 */
function LifecycleActions({
  card,
  onChanged,
}: {
  card: Card;
  onChanged: (card: Card) => void;
}) {
  const [busy, setBusy] = useState<CardLifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const moves = NEXT_MOVES[card.lifecycle];
  if (!moves || moves.length === 0) return null;
  const transition = async (to: CardLifecycle, retry?: boolean) => {
    setBusy(to);
    setError(null);
    try {
      const res = await fetch(`/api/board/${card.id}/lifecycle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, retry }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "transition failed");
        return;
      }
      onChanged(json.card as Card);
    } catch (err) {
      setError(err instanceof Error ? err.message : "transition failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-widest text-muted-foreground">
        Advance lifecycle
      </div>
      <div className="flex flex-wrap gap-1">
        {moves.map((m) => (
          <button
            key={`${m.to}-${m.retry ? "retry" : "go"}`}
            onClick={() => void transition(m.to, m.retry)}
            disabled={busy !== null}
            className="rounded border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {busy === m.to ? "…" : m.label}
          </button>
        ))}
      </div>
      {error ? (
        <p className="mt-1 text-[10px] text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}

type LifecycleMove = { to: CardLifecycle; label: string; retry?: boolean };
const NEXT_MOVES: Record<CardLifecycle, LifecycleMove[]> = {
  queued: [
    { to: "dispatched", label: "dispatch" },
    { to: "cancelled", label: "cancel" },
  ],
  dispatched: [
    { to: "running", label: "running" },
    { to: "failed", label: "fail" },
    { to: "cancelled", label: "cancel" },
  ],
  running: [
    { to: "review", label: "review" },
    { to: "completed", label: "complete" },
    { to: "failed", label: "fail" },
    { to: "cancelled", label: "cancel" },
  ],
  review: [
    { to: "completed", label: "complete" },
    { to: "failed", label: "fail" },
  ],
  completed: [],
  failed: [
    { to: "queued", label: "retry", retry: true },
    { to: "cancelled", label: "cancel" },
  ],
  cancelled: [{ to: "queued", label: "re-queue" }],
};

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

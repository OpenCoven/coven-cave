"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";
import { Icon } from "@/lib/icon";

type CardStatus = "inbox" | "running" | "review";
type CardPriority = "low" | "medium" | "high" | "urgent";

type Card = {
  id: string;
  title: string;
  notes: string;
  status: CardStatus;
  priority: CardPriority;
  familiarId: string | null;
  sessionId: string | null;
  labels: string[];
  template?: string | null;
  createdAt: string;
  updatedAt: string;
};

const COLUMNS: { id: CardStatus; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "running", label: "Running" },
  { id: "review", label: "Review" },
];

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

export function BoardView({ familiars, sessions, activeFamiliarId, onJumpToSession }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("inbox");
  const [priorityFilter, setPriorityFilter] = useState<Set<CardPriority>>(new Set());
  const [scopeToFamiliar, setScopeToFamiliar] = useState<boolean>(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<CardStatus | null>(null);
  const draggingIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) {
        setCards(json.cards ?? []);
        setError(null);
      } else {
        setError(json.error ?? "load failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
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
    void patchCard(id, { status });
  };

  const removeCard = async (id: string) => {
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) await load();
  };

  return (
    <section className="flex h-full flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-foreground">Board</h1>
          <p className="text-[11px] text-muted-foreground">
            Queue work for familiars. {filtered.length} of {cards.length} card
            {cards.length === 1 ? "" : "s"} shown.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
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
              setModalDefaultStatus("inbox");
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

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full w-full gap-3 px-5 py-4">
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
                className={`flex h-full min-w-0 flex-1 basis-0 flex-col rounded-xl border bg-card transition-colors ${
                  isDropTarget
                    ? "border-border-strong bg-muted"
                    : "border-border"
                }`}
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{col.label}</span>
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
                      {isDropTarget ? "Drop here" : "Empty"}
                    </li>
                  ) : null}
                  {rows.map((card) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      familiars={familiars}
                      sessions={sessions}
                      isDragging={draggingId === card.id}
                      onDragStart={(e) => handleDragStart(e, card.id)}
                      onDragEnd={handleDragEnd}
                      onPatch={(patch) => patchCard(card.id, patch)}
                      onDelete={() => removeCard(card.id)}
                      onJumpToSession={onJumpToSession}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
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
  onDragStart,
  onDragEnd,
  onPatch,
  onDelete,
  onJumpToSession,
}: {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  isDragging?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onPatch: (patch: Partial<Card>) => void;
  onDelete: () => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
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
        setExpanded((v) => !v);
      }}
      className={`cursor-grab rounded-lg border border-border bg-background p-3 transition-all active:cursor-grabbing hover:border-border-strong ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-[13px] leading-snug text-foreground">{card.title}</span>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${pri.pill}`}>
          {pri.label}
        </span>
      </div>

      {card.labels.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l}
              className="rounded border border-border bg-card px-1.5 py-px text-[10px] text-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        {familiar ? (
          <span title={`${familiar.display_name} · ${familiar.harness ?? "?"}`}>
            {familiar.display_name}
          </span>
        ) : (
          <span>unassigned</span>
        )}
        {session ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onJumpToSession?.(session.id, session.familiarId ?? null);
            }}
            title={`Open session: ${session.title || "(untitled)"}`}
            className="ml-auto rounded border border-border bg-card px-1.5 py-px text-foreground transition-colors hover:bg-muted"
          >
            <span className="inline-flex items-center gap-1">
              {session.status === "running" ? (
                <Icon name="ph:circle-fill" width="0.5rem" height="0.5rem" />
              ) : session.status === "failed" ? (
                <Icon name="ph:x-circle-fill" width="0.7rem" height="0.7rem" />
              ) : null}
              open
            </span>
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 space-y-2 rounded border border-border bg-card p-2"
        >
          {card.notes ? (
            <p className="whitespace-pre-wrap text-[11px] text-muted-foreground">{card.notes}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <Mini label="Status">
              <select
                value={card.status}
                onChange={(e) => onPatch({ status: e.target.value as CardStatus })}
                className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
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
                onChange={(e) => onPatch({ priority: e.target.value as CardPriority })}
                className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
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
                onChange={(e) => onPatch({ familiarId: e.target.value || null })}
                className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
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
                onChange={(e) => onPatch({ sessionId: e.target.value || null })}
                className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground"
              >
                <option value="">No linked session</option>
                {sessions
                  .filter((s) => !card.familiarId || s.familiarId === card.familiarId)
                  .slice(0, 30)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {(s.title || "(untitled)").slice(0, 30)}
                    </option>
                  ))}
              </select>
            </Mini>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (confirm("Delete card?")) onDelete();
              }}
              className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              delete
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

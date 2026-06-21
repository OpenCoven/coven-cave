"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import type { Card } from "@/lib/cave-board-types";

/**
 * Popover for linking an existing board task to the current chat. Lists the
 * board's cards (minus those already linked to this session) and, on pick,
 * PATCHes the card's `sessionId` to this chat — the chat→task assign side that
 * mirrors the board's "Start chat from task" flow.
 */
export function TaskLinkPicker({
  sessionId,
  linkedIds,
  onAssigned,
  onClose,
}: {
  sessionId: string;
  linkedIds: Set<string>;
  onAssigned: (card: Card) => void;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (json.ok) setCards(json.cards as Card[]);
        else setError(json.error ?? "Failed to load tasks");
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Failed to load tasks");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const results = useMemo(() => {
    if (!cards) return [];
    const q = query.trim().toLowerCase();
    return cards
      .filter((c) => !linkedIds.has(c.id))
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .slice(0, 50);
  }, [cards, linkedIds, query]);

  const assign = async (card: Card) => {
    setBusyId(card.id);
    setError(null);
    try {
      const res = await fetch(`/api/board/${card.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to link task");
      onAssigned(json.card as Card);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link task");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Link a task to this chat"
      className="absolute left-0 top-full z-30 mt-1 w-[20rem] max-w-[80vw] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-raised)] shadow-lg"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border-hairline)] px-2.5 py-2">
        <Icon name="ph:magnifying-glass" width={13} className="shrink-0 text-[var(--text-muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Link a task…"
          aria-label="Search tasks to link"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
      {error ? (
        <div className="px-2.5 py-1.5 text-[11px] text-[var(--color-danger,#ef4444)]">{error}</div>
      ) : null}
      <div className="max-h-[16rem] overflow-y-auto py-1">
        {cards === null ? (
          <div className="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">Loading tasks…</div>
        ) : results.length === 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-[var(--text-muted)]">
            {query ? "No matches." : "No other tasks to link."}
          </div>
        ) : (
          results.map((card) => (
            <button
              key={card.id}
              type="button"
              disabled={busyId !== null}
              onClick={() => void assign(card)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <Icon name="ph:kanban" width={12} className="shrink-0 text-[var(--accent-presence)]" />
              <span className="min-w-0 flex-1 truncate">{card.title}</span>
              <span className="shrink-0 text-[var(--text-muted)]">{busyId === card.id ? "linking…" : card.status}</span>
              {busyId === card.id ? null : <Icon name="ph:plus" width={12} className="shrink-0 text-[var(--text-muted)]" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

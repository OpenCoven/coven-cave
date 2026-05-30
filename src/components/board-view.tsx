"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { NewCardModal, type NewCardDraft } from "@/components/new-card-modal";

type CardStatus = "inbox" | "running" | "review" | "blocked";
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

const COLUMNS: { id: CardStatus; label: string; accent: string }[] = [
  { id: "inbox", label: "Inbox", accent: "border-sky-500/40" },
  { id: "running", label: "Running", accent: "border-emerald-500/60" },
  { id: "review", label: "Review", accent: "border-violet-500/60" },
  { id: "blocked", label: "Blocked", accent: "border-rose-500/60" },
];

const PRIORITIES: { id: CardPriority; label: string; pill: string }[] = [
  { id: "urgent", label: "Urgent", pill: "bg-rose-600/20 text-rose-300 border-rose-600/40" },
  { id: "high", label: "High", pill: "bg-amber-600/20 text-amber-200 border-amber-600/40" },
  { id: "medium", label: "Medium", pill: "bg-zinc-700/40 text-zinc-200 border-zinc-700" },
  { id: "low", label: "Low", pill: "bg-zinc-800/60 text-zinc-400 border-zinc-800" },
];

type Props = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
};

export function BoardView({ familiars, sessions, activeFamiliarId }: Props) {
  const [cards, setCards] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDefaultStatus, setModalDefaultStatus] = useState<CardStatus>("inbox");
  const [priorityFilter, setPriorityFilter] = useState<Set<CardPriority>>(new Set());
  const [scopeToFamiliar, setScopeToFamiliar] = useState<boolean>(false);

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
    const res = await fetch(`/api/board/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (json.ok) await load();
  };

  const removeCard = async (id: string) => {
    const res = await fetch(`/api/board/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (json.ok) await load();
  };

  return (
    <section className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-900 px-5 py-3">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Coven Board</h1>
          <p className="text-[11px] text-zinc-500">
            Queue work for agents. {filtered.length} of {cards.length} card
            {cards.length === 1 ? "" : "s"} shown.
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {activeFamiliarId ? (
            <button
              onClick={() => setScopeToFamiliar((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                scopeToFamiliar
                  ? "border-violet-500 bg-violet-500/20 text-violet-100"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
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
            className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-zinc-50 transition-colors hover:bg-rose-600"
          >
            + New card
          </button>
        </div>

        <div className="flex w-full items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">priority</span>
          {PRIORITIES.map((p) => {
            const on = priorityFilter.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => togglePriority(p.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                  on ? p.pill : "border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          {priorityFilter.size > 0 ? (
            <button
              onClick={() => setPriorityFilter(new Set())}
              className="text-[10px] text-zinc-500 hover:text-zinc-300"
            >
              clear
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="border-b border-amber-700/40 bg-amber-900/20 px-5 py-1.5 text-xs text-amber-200">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full min-w-max gap-3 px-5 py-4">
          {COLUMNS.map((col) => {
            const rows = grouped.get(col.id) ?? [];
            return (
              <div
                key={col.id}
                className="flex h-full w-[300px] shrink-0 flex-col rounded-xl border border-zinc-900 bg-zinc-900/30"
              >
                <div
                  className={`flex items-center justify-between border-b ${col.accent} px-3 py-2`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-100">{col.label}</span>
                    <span className="rounded-full bg-zinc-800 px-1.5 py-px text-[10px] text-zinc-400">
                      {rows.length}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setModalDefaultStatus(col.id);
                      setModalOpen(true);
                    }}
                    title={`Add card to ${col.label}`}
                    className="grid h-5 w-5 place-items-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  >
                    +
                  </button>
                </div>

                <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {rows.length === 0 ? (
                    <li className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-[11px] text-zinc-600">
                      Empty
                    </li>
                  ) : null}
                  {rows.map((card) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      familiars={familiars}
                      sessions={sessions}
                      onPatch={(patch) => patchCard(card.id, patch)}
                      onDelete={() => removeCard(card.id)}
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
  onPatch,
  onDelete,
}: {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  onPatch: (patch: Partial<Card>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const familiar = familiars.find((f) => f.id === card.familiarId) ?? null;
  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const pri = PRIORITIES.find((p) => p.id === card.priority)!;

  return (
    <li
      onClick={() => setExpanded((v) => !v)}
      className="cursor-pointer rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 transition-colors hover:border-zinc-700"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 text-[13px] leading-snug text-zinc-100">{card.title}</span>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${pri.pill}`}>
          {pri.label}
        </span>
      </div>

      {card.labels.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={l}
              className="rounded bg-zinc-800/80 px-1.5 py-px text-[10px] text-zinc-300"
            >
              {l}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
        {familiar ? (
          <span title={`${familiar.display_name} · ${familiar.harness ?? "?"}`}>
            {familiar.emoji} {familiar.display_name}
          </span>
        ) : (
          <span className="text-zinc-600">unassigned</span>
        )}
        {session ? (
          <span className="ml-auto rounded bg-emerald-600/20 px-1.5 py-px text-emerald-300">
            ● linked
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3 space-y-2 rounded border border-zinc-800 bg-zinc-900/40 p-2"
        >
          {card.notes ? (
            <p className="whitespace-pre-wrap text-[11px] text-zinc-400">{card.notes}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <Mini label="Status">
              <select
                value={card.status}
                onChange={(e) => onPatch({ status: e.target.value as CardStatus })}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
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
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Mini>
            <Mini label="Agent">
              <select
                value={card.familiarId ?? ""}
                onChange={(e) => onPatch({ familiarId: e.target.value || null })}
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
              >
                <option value="">Default agent</option>
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
                className="w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-200"
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
              className="rounded border border-rose-900/60 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-900/30"
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
      <div className="mb-0.5 text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
      {children}
    </label>
  );
}

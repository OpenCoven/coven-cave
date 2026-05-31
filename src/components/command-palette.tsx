"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { SLASH_COMMANDS } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";

type PaletteIntent =
  | { kind: "switch-familiar"; familiarId: string }
  | { kind: "open-session"; sessionId: string; familiarId?: string | null }
  | { kind: "new-chat"; familiarId?: string }
  | { kind: "slash"; command: string; args?: string }
  | { kind: "back-to-list" }
  | { kind: "open-tui-session"; sessionId: string }
  | { kind: "open-board" }
  | { kind: "focus-card"; cardId: string }
  | { kind: "open-memory-file"; path: string };

type Card = {
  id: string;
  title: string;
  status: string;
  priority: string;
  familiarId: string | null;
  labels: string[];
};

type CovenMemoryEntry = {
  id: string;
  familiar_id: string;
  title: string;
  path: string;
  updated_at: string;
  excerpt?: string;
};

type FsMemoryEntry = {
  root: string;
  rootLabel: string;
  relPath: string;
  fullPath: string;
  modified: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  onIntent: (intent: PaletteIntent) => void;
};

type Row =
  | { id: string; kind: "familiar"; familiar: Familiar }
  | { id: string; kind: "session"; session: SessionRow; familiar: Familiar | null }
  | { id: string; kind: "card"; card: Card; familiar: Familiar | null }
  | { id: string; kind: "coven-memory"; entry: CovenMemoryEntry; familiar: Familiar | null }
  | { id: string; kind: "fs-memory"; entry: FsMemoryEntry }
  | { id: string; kind: "command"; name: string; hint: string; intent: PaletteIntent };

const RESULT_LIMITS = {
  familiar: 6,
  session: 6,
  card: 6,
  covenMemory: 5,
  fsMemory: 8,
  command: 6,
};

export function CommandPalette({
  open,
  onClose,
  familiars,
  sessions,
  activeFamiliarId,
  onIntent,
}: Props) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [cards, setCards] = useState<Card[]>([]);
  const [covenMemory, setCovenMemory] = useState<CovenMemoryEntry[]>([]);
  const [fsMemory, setFsMemory] = useState<FsMemoryEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const keys = useKeySymbols();

  // Fetch the searchable corpora once on first open. Cheap calls; refreshed
  // every time the palette opens so the index doesn't go stale.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    const t = setTimeout(() => inputRef.current?.focus(), 10);

    void (async () => {
      try {
        const [boardRes, covenRes, fsRes] = await Promise.all([
          fetch("/api/board", { cache: "no-store" }),
          fetch("/api/coven-memory", { cache: "no-store" }),
          fetch("/api/memory", { cache: "no-store" }),
        ]);
        const board = await boardRes.json();
        const coven = await covenRes.json();
        const fs = await fsRes.json();
        if (board.ok) setCards(board.cards ?? []);
        if (coven.ok) setCovenMemory(coven.entries ?? []);
        if (fs.ok) setFsMemory(fs.entries ?? []);
      } catch {
        /* keep what we had */
      }
    })();

    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();

    const familiarRows: Row[] = familiars
      .filter(
        (f) =>
          !q ||
          f.display_name.toLowerCase().includes(q) ||
          f.role.toLowerCase().includes(q) ||
          (f.harness ?? "").toLowerCase().includes(q),
      )
      .slice(0, RESULT_LIMITS.familiar)
      .map((f) => ({ id: `f:${f.id}`, kind: "familiar", familiar: f }));

    const sessionRows: Row[] = sessions
      .filter((s) => {
        if (!s.familiarId) return false;
        if (!q) return s.familiarId === activeFamiliarId;
        return (
          (s.title ?? "").toLowerCase().includes(q) ||
          s.harness.toLowerCase().includes(q) ||
          (s.familiarId ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, RESULT_LIMITS.session)
      .map((s) => ({
        id: `s:${s.id}`,
        kind: "session",
        session: s,
        familiar: familiars.find((f) => f.id === s.familiarId) ?? null,
      }));

    const cardRows: Row[] = cards
      .filter(
        (c) =>
          !q ||
          c.title.toLowerCase().includes(q) ||
          (c.labels ?? []).some((l) => l.toLowerCase().includes(q)) ||
          c.status.toLowerCase().includes(q) ||
          c.priority.toLowerCase().includes(q),
      )
      .slice(0, RESULT_LIMITS.card)
      .map((c) => ({
        id: `card:${c.id}`,
        kind: "card",
        card: c,
        familiar: familiars.find((f) => f.id === c.familiarId) ?? null,
      }));

    const covenMemoryRows: Row[] = covenMemory
      .filter(
        (e) =>
          !q ||
          e.title.toLowerCase().includes(q) ||
          (e.excerpt ?? "").toLowerCase().includes(q) ||
          e.familiar_id.toLowerCase().includes(q),
      )
      .slice(0, RESULT_LIMITS.covenMemory)
      .map((e) => ({
        id: `cm:${e.id}`,
        kind: "coven-memory",
        entry: e,
        familiar: familiars.find((f) => f.id === e.familiar_id) ?? null,
      }));

    const fsMemoryRows: Row[] = fsMemory
      .filter(
        (e) =>
          !q ||
          e.relPath.toLowerCase().includes(q) ||
          e.rootLabel.toLowerCase().includes(q),
      )
      .slice(0, RESULT_LIMITS.fsMemory)
      .map((e) => ({ id: `fm:${e.fullPath}`, kind: "fs-memory", entry: e }));

    const cmdRows: Row[] = SLASH_COMMANDS.filter(
      (c) =>
        !q ||
        c.name.includes(q) ||
        (c.aliases ?? []).some((a) => a.includes(q)) ||
        c.description.toLowerCase().includes(q),
    )
      .slice(0, RESULT_LIMITS.command)
      .map((c) => ({
        id: `c:${c.name}`,
        kind: "command",
        name: c.name,
        hint: c.hint,
        intent: { kind: "slash", command: c.name },
      }));

    return [
      ...familiarRows,
      ...sessionRows,
      ...cardRows,
      ...covenMemoryRows,
      ...fsMemoryRows,
      ...cmdRows,
    ];
  }, [familiars, sessions, cards, covenMemory, fsMemory, query, activeFamiliarId]);

  useEffect(() => {
    if (activeIdx >= rows.length) setActiveIdx(Math.max(0, rows.length - 1));
  }, [rows.length, activeIdx]);

  const fire = (row: Row) => {
    if (row.kind === "familiar") {
      onIntent({ kind: "switch-familiar", familiarId: row.familiar.id });
    } else if (row.kind === "session") {
      onIntent({
        kind: "open-session",
        sessionId: row.session.id,
        familiarId: row.session.familiarId ?? null,
      });
    } else if (row.kind === "card") {
      onIntent({ kind: "open-board" });
      // Focus card after the view switches
      setTimeout(() => onIntent({ kind: "focus-card", cardId: row.card.id }), 0);
    } else if (row.kind === "coven-memory") {
      onIntent({ kind: "open-memory-file", path: row.entry.path });
    } else if (row.kind === "fs-memory") {
      onIntent({ kind: "open-memory-file", path: row.entry.fullPath });
    } else {
      onIntent(row.intent);
    }
    onClose();
  };

  const onComposerKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) fire(row);
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-[12vh] w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={onComposerKey}
          placeholder="Search familiars · chats · cards · memory · commands…"
          className="w-full border-b border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
        <ul className="max-h-[60vh] overflow-y-auto py-1">
          {rows.length === 0 ? (
            <li className="px-4 py-6 text-center text-xs text-zinc-500">No matches.</li>
          ) : null}
          {rows.map((row, i) => {
            const active = i === activeIdx;
            return (
              <li key={row.id}>
                <button
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => fire(row)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                    active ? "bg-zinc-800/60" : "hover:bg-zinc-900/50"
                  }`}
                >
                  {row.kind === "familiar" ? (
                    <>
                      <span className="flex flex-1 flex-col">
                        <span className="text-zinc-100">{row.familiar.display_name}</span>
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500">
                          {row.familiar.role}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500">switch</span>
                    </>
                  ) : null}
                  {row.kind === "session" ? (
                    <>
                      <Icon name="ph:chat-circle-dots-bold" className="text-zinc-400" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-zinc-100">
                          {row.session.title || "(untitled chat)"}
                        </span>
                        <span className="truncate text-[10px] text-zinc-500">
                          {row.familiar?.display_name ?? row.session.familiarId} ·{" "}
                          {row.session.harness}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500">open</span>
                    </>
                  ) : null}
                  {row.kind === "card" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-zinc-100">{row.card.title}</span>
                        <span className="truncate text-[10px] text-zinc-500">
                          {row.card.status} · {row.card.priority}
                          {row.familiar ? ` · ${row.familiar.display_name}` : ""}
                          {row.card.labels.length ? ` · ${row.card.labels.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500">card</span>
                    </>
                  ) : null}
                  {row.kind === "coven-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-zinc-100">{row.entry.title}</span>
                        <span className="truncate text-[10px] text-zinc-500">
                          {row.entry.familiar_id} · {row.entry.updated_at}
                          {row.entry.excerpt ? ` · ${row.entry.excerpt.slice(0, 70)}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500">memory</span>
                    </>
                  ) : null}
                  {row.kind === "fs-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-zinc-100">{row.entry.relPath}</span>
                        <span className="truncate text-[10px] text-zinc-500">
                          {row.entry.rootLabel}
                        </span>
                      </span>
                      <span className="text-[10px] text-zinc-500">file</span>
                    </>
                  ) : null}
                  {row.kind === "command" ? (
                    <>
                      <span className="font-mono text-zinc-300">{row.name}</span>
                      <span className="flex-1 text-zinc-500">{platformizeHint(row.hint, keys)}</span>
                      <span className="text-[10px] text-zinc-500">run</span>
                    </>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
          <span>{keys.up}{keys.down} navigate · {keys.enter} select · esc close</span>
          <span>{keys.mod}K</span>
        </div>
      </div>
    </div>
  );
}

export type { PaletteIntent };

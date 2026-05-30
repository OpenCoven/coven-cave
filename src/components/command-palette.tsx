"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { SLASH_COMMANDS } from "@/lib/slash-commands";

type PaletteIntent =
  | { kind: "switch-familiar"; familiarId: string }
  | { kind: "open-session"; sessionId: string; familiarId?: string | null }
  | { kind: "new-chat"; familiarId?: string }
  | { kind: "slash"; command: string }
  | { kind: "back-to-list" }
  | { kind: "open-tui-session"; sessionId: string };

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
  | { id: string; kind: "command"; name: string; hint: string; intent: PaletteIntent };

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
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
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
      .slice(0, 8)
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
      .slice(0, 8)
      .map((s) => ({
        id: `s:${s.id}`,
        kind: "session",
        session: s,
        familiar: familiars.find((f) => f.id === s.familiarId) ?? null,
      }));

    const cmdRows: Row[] = SLASH_COMMANDS.filter(
      (c) => !q || c.name.includes(q) || c.description.toLowerCase().includes(q),
    )
      .slice(0, 8)
      .map((c) => ({
        id: `c:${c.name}`,
        kind: "command",
        name: c.name,
        hint: c.hint,
        intent: { kind: "slash", command: c.name },
      }));

    return [...familiarRows, ...sessionRows, ...cmdRows];
  }, [familiars, sessions, query, activeFamiliarId]);

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
        className="mt-[12vh] w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          }}
          onKeyDown={onComposerKey}
          placeholder="Jump to a familiar, chat, or command…"
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
                      <span className="text-lg">{row.familiar.emoji}</span>
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
                      <span className="text-lg">{row.familiar?.emoji ?? "✦"}</span>
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
                  {row.kind === "command" ? (
                    <>
                      <span className="font-mono text-zinc-300">{row.name}</span>
                      <span className="flex-1 text-zinc-500">{row.hint}</span>
                      <span className="text-[10px] text-zinc-500">run</span>
                    </>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-2 text-[10px] text-zinc-500">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}

export type { PaletteIntent };

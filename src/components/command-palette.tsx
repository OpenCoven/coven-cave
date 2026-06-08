"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import { SLASH_COMMANDS } from "@/lib/slash-commands";
import { Icon } from "@/lib/icon";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";
import { useFocusTrap } from "@/lib/use-focus-trap";

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
  | { id: string; kind: "command"; name: string; hint: string; intent: PaletteIntent }
  | { id: string; kind: "shortcut"; label: string; shortcut: string; action: () => void };

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
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const keys = useKeySymbols();

  useFocusTrap(open, dialogRef, { onEscape: onClose });

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

    const shortcutRows: Row[] = [];
    const toggleLabel = "Toggle Familiar Chat";
    if (!q || toggleLabel.toLowerCase().includes(q) || "⌘j".includes(q)) {
      shortcutRows.push({
        id: "shortcut:toggle-agent",
        kind: "shortcut",
        label: toggleLabel,
        shortcut: "⌘J",
        action: () => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "j",
              code: "KeyJ",
              metaKey: true,
              bubbles: true,
            }),
          );
        },
      });
    }

    return [
      ...familiarRows,
      ...sessionRows,
      ...cardRows,
      ...covenMemoryRows,
      ...fsMemoryRows,
      ...cmdRows,
      ...shortcutRows,
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
    } else if (row.kind === "shortcut") {
      row.action();
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
      role="presentation"
      className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--backdrop-scrim)] backdrop-blur-sm"
      style={{ animation: "ui-modal-fade-in var(--duration-fast) var(--ease-decelerate)" }}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="mt-[12vh] w-[640px] max-w-[92vw] overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-elevated)] shadow-2xl"
        style={{ animation: "ui-modal-enter var(--duration-base) var(--ease-decelerate)" }}
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
          aria-label="Search and jump to anything"
          aria-controls="command-palette-listbox"
          aria-activedescendant={
            rows.length > 0 ? `command-palette-option-${activeIdx}` : undefined
          }
          className="focus-ring-inset w-full border-b border-[var(--border-hairline)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <ul
          id="command-palette-listbox"
          role="listbox"
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {rows.length === 0 ? (
            <li role="presentation" className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">No matches.</li>
          ) : null}
          {rows.map((row, i) => {
            const active = i === activeIdx;
            return (
              <li
                key={row.id}
                role="option"
                id={`command-palette-option-${i}`}
                aria-selected={active}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => fire(row)}
                  className={`focus-ring-inset flex w-full items-center gap-3 border-l-2 px-4 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-l-[var(--accent-presence)] bg-[var(--bg-hover)]"
                      : "border-l-transparent hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  {row.kind === "familiar" ? (
                    <>
                      <span className="flex flex-1 flex-col">
                        <span className="text-[var(--text-primary)]">{row.familiar.display_name}</span>
                        <span className="text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                          {row.familiar.role}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">switch</span>
                    </>
                  ) : null}
                  {row.kind === "session" ? (
                    <>
                      <Icon name="ph:chat-circle-dots-bold" className="text-[var(--text-secondary)]" width="1.1rem" height="1.1rem" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">
                          {row.session.title || "(untitled chat)"}
                        </span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.familiar?.display_name ?? row.session.familiarId} ·{" "}
                          {row.session.harness}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">open</span>
                    </>
                  ) : null}
                  {row.kind === "card" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.card.title}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.card.status} · {row.card.priority}
                          {row.familiar ? ` · ${row.familiar.display_name}` : ""}
                          {row.card.labels.length ? ` · ${row.card.labels.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">card</span>
                    </>
                  ) : null}
                  {row.kind === "coven-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.title}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.entry.familiar_id} · {row.entry.updated_at}
                          {row.entry.excerpt ? ` · ${row.entry.excerpt.slice(0, 70)}` : ""}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">memory</span>
                    </>
                  ) : null}
                  {row.kind === "fs-memory" ? (
                    <>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[var(--text-primary)]">{row.entry.relPath}</span>
                        <span className="truncate text-[10px] text-[var(--text-muted)]">
                          {row.entry.rootLabel}
                        </span>
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]">file</span>
                    </>
                  ) : null}
                  {row.kind === "command" ? (
                    <>
                      <span className="font-mono text-[var(--text-secondary)]">{row.name}</span>
                      <span className="flex-1 text-[var(--text-muted)]">{platformizeHint(row.hint, keys)}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">run</span>
                    </>
                  ) : null}
                  {row.kind === "shortcut" ? (
                    <>
                      <span className="flex-1 text-[var(--text-primary)]">{row.label}</span>
                      <span className="font-mono text-[10px] text-[var(--text-muted)]">{platformizeHint(row.shortcut, keys)}</span>
                    </>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between border-t border-[var(--border-hairline)] px-4 py-2 text-[10px] text-[var(--text-muted)]">
          <span>{keys.up}{keys.down} navigate · {keys.enter} select · esc close</span>
          <span>{keys.mod}K</span>
        </div>
      </div>
    </div>
  );
}

export type { PaletteIntent };

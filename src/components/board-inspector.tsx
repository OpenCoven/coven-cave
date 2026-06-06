"use client";

import { useEffect, useState } from "react";
import type { Familiar, SessionRow } from "@/lib/types";
import type { Card, CardLifecycle, CardPriority, CardStatus } from "@/lib/cave-board-types";
import { STATUSES, PRIORITIES } from "@/lib/cave-board-types";
import { LifecycleBadge, formatTimeoutBadge } from "@/components/ui/lifecycle-badge";
import { Icon } from "@/lib/icon";

const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;

type LifecycleMove = { to: CardLifecycle; label: string; retry?: boolean };
const NEXT_MOVES: Record<CardLifecycle, LifecycleMove[]> = {
  queued:     [{ to: "dispatched", label: "dispatch" }, { to: "cancelled", label: "cancel" }],
  dispatched: [{ to: "running", label: "running" }, { to: "failed", label: "fail" }, { to: "cancelled", label: "cancel" }],
  running:    [{ to: "review", label: "review" }, { to: "completed", label: "complete" }, { to: "failed", label: "fail" }, { to: "cancelled", label: "cancel" }],
  review:     [{ to: "completed", label: "complete" }, { to: "failed", label: "fail" }],
  completed:  [],
  failed:     [{ to: "queued", label: "retry", retry: true }, { to: "cancelled", label: "cancel" }],
  cancelled:  [{ to: "queued", label: "re-queue" }],
};

type Props = {
  card: Card;
  familiars: Familiar[];
  sessions: SessionRow[];
  onClose: () => void;
  onPatch: (id: string, patch: Partial<Card>) => void;
  onMoveStatus: (id: string, status: CardStatus) => void;
  onDelete: (id: string) => Promise<void>;
  onCardReplaced: (card: Card) => void;
  onJumpToSession?: (sessionId: string, familiarId: string | null) => void;
  onOpenTaskChat?: (id: string) => Promise<void>;
  chatLinking?: boolean;
};

function TimeoutBadge({ runningSince, timeoutMs }: { runningSince?: string; timeoutMs?: number }) {
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((n) => n + 1), 60_000); return () => clearInterval(id); }, []);
  const text = formatTimeoutBadge(runningSince, timeoutMs, DEFAULT_TIMEOUT_MS);
  if (!text) return null;
  const over = runningSince ? Date.now() - new Date(runningSince).getTime() > (timeoutMs ?? DEFAULT_TIMEOUT_MS) : false;
  return (
    <span className={`rounded border px-1.5 py-px text-[10px] uppercase tracking-widest ${over ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-border bg-card text-muted-foreground"}`}>
      {text}
    </span>
  );
}

export function BoardInspector({ card, familiars, sessions, onClose, onPatch, onMoveStatus, onDelete, onCardReplaced, onJumpToSession, onOpenTaskChat, chatLinking = false }: Props) {
  const [closing, setClosing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState<CardLifecycle | null>(null);
  const [lifecycleErr, setLifecycleErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  const session = sessions.find((s) => s.id === card.sessionId) ?? null;
  const moves = NEXT_MOVES[card.lifecycle] ?? [];

  const close = () => { setClosing(true); setTimeout(onClose, 180); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLabel = () => {
    const l = newLabel.trim();
    if (!l || card.labels.includes(l)) return;
    onPatch(card.id, { labels: [...card.labels, l] });
    setNewLabel("");
  };

  const doLifecycle = async (to: CardLifecycle, retry?: boolean) => {
    setLifecycleBusy(to); setLifecycleErr(null);
    try {
      const res = await fetch(`/api/board/${card.id}/lifecycle`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, retry }),
      });
      const json = await res.json();
      if (!json.ok) { setLifecycleErr(json.error ?? "failed"); return; }
      onCardReplaced(json.card as Card);
    } catch (err) {
      setLifecycleErr(err instanceof Error ? err.message : "failed");
    } finally { setLifecycleBusy(null); }
  };

  return (
    <>
      <div className="board-drawer-backdrop" onClick={close} />
      <div className={`board-drawer${closing ? " board-drawer--closing" : ""}`} role="dialog" aria-modal aria-label="Card inspector">
        <div className="board-drawer-header">
          <span className="board-drawer-title">{card.title}</span>
          <button type="button" className="board-drawer-close" onClick={close} aria-label="Close">
            <Icon name="ph:x-bold" width={12} />
          </button>
        </div>

        <div className="board-drawer-body">
          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Title</div>
            <input className="board-drawer-field-input" defaultValue={card.title}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== card.title) onPatch(card.id, { title: e.target.value.trim() }); }} />
          </div>

          <div className="board-drawer-grid-2">
            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Status</div>
              <select className="board-drawer-field-select" value={card.status}
                onChange={(e) => onMoveStatus(card.id, e.target.value as CardStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="board-drawer-field">
              <div className="board-drawer-field-label">Priority</div>
              <select className="board-drawer-field-select" value={card.priority}
                onChange={(e) => onPatch(card.id, { priority: e.target.value as CardPriority })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Familiar</div>
            <select className="board-drawer-field-select" value={card.familiarId ?? ""}
              onChange={(e) => onPatch(card.id, { familiarId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {familiars.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
            </select>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Chat</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {session ? (
                <span className="board-table-muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {session.title || "(untitled)"}
                </span>
              ) : (
                <span className="board-table-muted" style={{ flex: 1 }}>
                  No chat linked yet.
                </span>
              )}
              {session ? (
                <button type="button" className="board-toolbar-btn"
                  onClick={() => onJumpToSession?.(session.id, session.familiarId ?? null)}>
                  Open chat <Icon name="ph:arrow-square-out" width={11} />
                </button>
              ) : (
                <button
                  type="button"
                  className="board-toolbar-btn"
                  disabled={chatLinking}
                  onClick={() => void onOpenTaskChat?.(card.id)}
                >
                  {chatLinking ? "Starting..." : "Start chat"} <Icon name="ph:chat-circle-dots" width={11} />
                </button>
              )}
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">CWD</div>
            <input className="board-drawer-field-input" defaultValue={card.cwd ?? ""}
              placeholder="/Users/buns/Documents/GitHub/OpenCoven/coven-cave"
              onBlur={(e) => {
                const next = e.target.value.trim() || null;
                if (next !== card.cwd) onPatch(card.id, { cwd: next });
              }} />
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Links</div>
            {card.links.length > 0 && (
              <div className="board-task-links">
                {card.links.map((link) => {
                  const href = safeHref(link);
                  return href ? (
                    <a key={link} className="board-task-link" href={href} target="_blank" rel="noreferrer">
                      {formatLinkLabel(link)}
                    </a>
                  ) : (
                    <span key={link} className="board-task-link">{link}</span>
                  );
                })}
              </div>
            )}
            <textarea className="board-drawer-field-textarea" defaultValue={card.links.join("\n")}
              placeholder="One URL or reference per line"
              onBlur={(e) => {
                const next = parseDelimited(e.target.value);
                if (next.join("\n") !== card.links.join("\n")) onPatch(card.id, { links: next });
              }} />
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Notes</div>
            <textarea className="board-drawer-field-textarea" defaultValue={card.notes}
              onBlur={(e) => { if (e.target.value !== card.notes) onPatch(card.id, { notes: e.target.value }); }} />
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Labels</div>
            <div className="board-label-chips" style={{ marginBottom: 8 }}>
              {card.labels.map((l) => (
                <span key={l} className="board-label-chip">
                  {l}
                  <button type="button" className="board-label-chip-remove"
                    onClick={() => onPatch(card.id, { labels: card.labels.filter((x) => x !== l) })}
                    aria-label={`Remove ${l}`}>
                    <Icon name="ph:x-bold" width={8} />
                  </button>
                </span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="board-drawer-field-input" style={{ flex: 1 }} placeholder="Add label…"
                value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLabel(); } }} />
              <button type="button" className="board-toolbar-btn" onClick={addLabel}>Add</button>
            </div>
          </div>

          <div className="board-drawer-field">
            <div className="board-drawer-field-label">Lifecycle</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <LifecycleBadge lifecycle={card.lifecycle} needsHuman={card.needsHuman} />
              {card.lifecycle === "running" && <TimeoutBadge runningSince={card.runningSince} timeoutMs={card.timeoutMs} />}
            </div>
            {moves.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {moves.map((m) => (
                  <button key={`${m.to}-${m.retry}`} type="button" className="board-toolbar-btn"
                    disabled={lifecycleBusy !== null}
                    onClick={() => void doLifecycle(m.to, m.retry)}>
                    {lifecycleBusy === m.to ? "…" : m.label}
                  </button>
                ))}
              </div>
            )}
            {lifecycleErr && <p style={{ fontSize: 10, color: "#f87171", marginTop: 4 }}>{lifecycleErr}</p>}
          </div>

          <div className="board-drawer-grid-2 board-table-muted">
            <div><div className="board-drawer-field-label">Created</div>{new Date(card.createdAt).toLocaleString()}</div>
            <div><div className="board-drawer-field-label">Updated</div>{new Date(card.updatedAt).toLocaleString()}</div>
          </div>
        </div>

        <div className="board-drawer-footer">
          {deleteConfirm ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Delete this card?</span>
              <button type="button" className="board-drawer-delete-btn"
                onClick={async () => { await onDelete(card.id); close(); }}>Confirm</button>
              <button type="button" className="board-toolbar-btn" onClick={() => setDeleteConfirm(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="board-drawer-delete-btn" onClick={() => setDeleteConfirm(true)}>Delete</button>
          )}
          <button type="button" className="board-toolbar-btn" onClick={close}>Close</button>
        </div>
      </div>
    </>
  );
}

function parseDelimited(value: string): string[] {
  return [...new Set(value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
}

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatLinkLabel(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

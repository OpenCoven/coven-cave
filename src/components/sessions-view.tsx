"use client";

import "@/styles/sessions-view.css";
import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import type { Familiar, SessionRow, SessionOrigin } from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

type SessionsLayoutMode = "cards" | "rows";

function shortRelTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60) return `${Math.round(diffSec)}s`;
    if (diffSec < 3600) return `${Math.round(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
    const days = Math.round(diffSec / 86400);
    if (days < 30) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
  } catch {
    return "";
  }
}

function statusDotClass(status: string): string {
  if (status === "running") return "session-card-status-dot session-card-status-dot--running";
  if (status === "error" || status === "failed") return "session-card-status-dot session-card-status-dot--error";
  return "session-card-status-dot session-card-status-dot--idle";
}

function originLabel(origin: SessionOrigin | undefined): string {
  if (!origin) return "";
  const map: Record<SessionOrigin, string> = {
    chat: "chat",
    mention: "mention",
    board: "board",
    cron: "cron",
    heartbeat: "hb",
    call: "call",
  };
  return map[origin] ?? origin;
}

// ── ViewSwitcher ──────────────────────────────────────────────────────────────

function ViewSwitcher({
  value,
  onChange,
}: {
  value: SessionsLayoutMode;
  onChange: (value: SessionsLayoutMode) => void;
}) {
  return (
    <div className="sessions-view-switcher" role="group" aria-label="Session layout">
      <button
        type="button"
        className={`sessions-view-switcher-btn${
          value === "rows" ? " sessions-view-switcher-btn--active" : ""
        }`}
        onClick={() => onChange("rows")}
        aria-pressed={value === "rows"}
        aria-label="Show sessions as rows"
        title="Rows"
      >
        <Icon name="ph:list-bullets" width={13} />
      </button>
      <button
        type="button"
        className={`sessions-view-switcher-btn${
          value === "cards" ? " sessions-view-switcher-btn--active" : ""
        }`}
        onClick={() => onChange("cards")}
        aria-pressed={value === "cards"}
        aria-label="Show sessions as grid"
        title="Grid"
      >
        <Icon name="ph:squares-four" width={13} />
      </button>
    </div>
  );
}

// ── SessionCard ───────────────────────────────────────────────────────────────

function SessionCard({
  session,
  familiar,
  active,
  onClick,
}: {
  session: SessionRow;
  familiar: Familiar | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const overrides = useGlyphOverrides();
  const glyph = familiar ? resolveFamiliarGlyph(familiar, overrides) : null;
  const ts = shortRelTime(session.updated_at || session.created_at);
  const title = session.title || "Untitled session";
  const label = originLabel(session.origin);

  return (
    <button
      type="button"
      className={`session-card${active ? " session-card--active" : ""}`}
      onClick={onClick}
      title={title}
    >
      <div className="session-card-top">
        <div className="session-card-familiar-chip">
          {glyph ? (
            <FamiliarGlyph glyph={glyph} size="sm" />
          ) : (
            <Icon name="ph:user" width={11} />
          )}
        </div>
        <div className="session-card-status">
          <div className={statusDotClass(session.status)} />
        </div>
      </div>
      <div className="session-card-title">{title}</div>
      <div className="session-card-footer">
        {label && <span className="session-card-origin">{label}</span>}
        {ts && <span className="session-card-ts">{ts}</span>}
      </div>
    </button>
  );
}

// ── SessionRowItem ────────────────────────────────────────────────────────────

function SessionRowItem({
  session,
  familiar,
  active,
  onClick,
}: {
  session: SessionRow;
  familiar: Familiar | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const overrides = useGlyphOverrides();
  const glyph = familiar ? resolveFamiliarGlyph(familiar, overrides) : null;
  const ts = shortRelTime(session.updated_at || session.created_at);
  const title = session.title || "Untitled session";
  const label = originLabel(session.origin);

  return (
    <button
      type="button"
      className={`session-row${active ? " session-row--active" : ""}`}
      onClick={onClick}
      title={title}
    >
      <div className="session-row-familiar-chip">
        {glyph ? (
          <FamiliarGlyph glyph={glyph} size="sm" />
        ) : (
          <Icon name="ph:user" width={11} />
        )}
      </div>
      <div className="session-row-main">
        <div className="session-row-title">{title}</div>
        <div className="session-row-status-line">
          <span className={statusDotClass(session.status)} />
          <span className="session-row-status-label">{session.status}</span>
        </div>
      </div>
      <div className="session-row-meta">
        {label && <span className="session-card-origin">{label}</span>}
        {ts && <span className="session-card-ts">{ts}</span>}
      </div>
    </button>
  );
}

// ── NewChatCard ───────────────────────────────────────────────────────────────

function NewChatCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="session-card session-card--new" onClick={onClick}>
      <Icon name="ph:plus" width={14} />
      <span>New chat</span>
    </button>
  );
}

function NewChatRow({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="session-row session-row--new" onClick={onClick}>
      <span className="session-row-new-icon">
        <Icon name="ph:plus" width={13} />
      </span>
      <span className="session-row-title">New chat</span>
    </button>
  );
}

const PAGE_SIZE = 20;

// ── SessionGroup ──────────────────────────────────────────────────────────────

function SessionGroup({
  familiar,
  sessions,
  activeSessionId,
  onOpenSession,
  onNewChat,
  showNewChat,
  layoutMode,
}: {
  familiar: Familiar | undefined;
  sessions: SessionRow[];
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  showNewChat: boolean;
  layoutMode: SessionsLayoutMode;
}) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const visible = sessions.slice(0, limit);
  const remaining = sessions.length - limit;

  return (
    <div className="sessions-group">
      {familiar && (
        <div className="sessions-group-header">
          <span className="sessions-group-label">{familiar.display_name}</span>
          <span className="sessions-group-count">{sessions.length}</span>
        </div>
      )}
      {layoutMode === "cards" ? (
        <div className="sessions-grid">
          {showNewChat && <NewChatCard onClick={onNewChat} />}
          {visible.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              familiar={familiar}
              active={s.id === activeSessionId}
              onClick={() => onOpenSession(s.id)}
            />
          ))}
        </div>
      ) : (
        <div className="sessions-list">
          {showNewChat && <NewChatRow onClick={onNewChat} />}
          {visible.map((s) => (
            <SessionRowItem
              key={s.id}
              session={s}
              familiar={familiar}
              active={s.id === activeSessionId}
              onClick={() => onOpenSession(s.id)}
            />
          ))}
        </div>
      )}
      {remaining > 0 && (
        <button
          type="button"
          className="sessions-load-more"
          onClick={() => setLimit((l) => l + PAGE_SIZE)}
        >
          Show {remaining} more
        </button>
      )}
    </div>
  );
}

// ── SessionsView (exported) ───────────────────────────────────────────────────

export type SessionsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string, familiarId?: string) => void;
  onNewChat: (familiarId?: string) => void;
};

export function SessionsView({
  familiars,
  sessions,
  activeFamiliarId,
  activeSessionId,
  onOpenSession,
  onNewChat,
}: SessionsViewProps) {
  const overrides = useGlyphOverrides();
  const [layoutMode, setLayoutMode] = useState<SessionsLayoutMode>("rows");
  const activeFamiliar = familiars.find((f) => f.id === activeFamiliarId) ?? null;

  // Sort sessions newest-first
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [sessions]
  );

  // Filter to familiar if one is selected
  const filtered = useMemo(
    () =>
      activeFamiliarId
        ? sorted.filter((s) => s.familiarId === activeFamiliarId)
        : sorted,
    [sorted, activeFamiliarId]
  );

  // Group by familiar when showing all
  const groups = useMemo<Map<string | null, SessionRow[]> | null>(() => {
    if (activeFamiliarId) return null;
    const map = new Map<string | null, SessionRow[]>();
    for (const s of filtered) {
      const key = s.familiarId ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [filtered, activeFamiliarId]);

  const title = activeFamiliar
    ? `${activeFamiliar.display_name} — Sessions`
    : "All Sessions";

  return (
    <div className="sessions-view">
      {/* Header */}
      <div className="sessions-view-header">
        <span className="sessions-view-title">{title}</span>
        <div className="sessions-view-actions">
          <ViewSwitcher value={layoutMode} onChange={setLayoutMode} />
          <button
            type="button"
            className="sessions-view-new-btn"
            onClick={() => onNewChat(activeFamiliarId ?? undefined)}
          >
            <Icon name="ph:plus" width={12} />
            New chat
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="sessions-view-scroll">
        {filtered.length === 0 ? (
          <div className="sessions-empty">
            <div className="sessions-empty-glyph">
              {activeFamiliar ? (
                <FamiliarGlyph
                  glyph={resolveFamiliarGlyph(activeFamiliar, overrides)}
                  size="sm"
                />
              ) : (
                <Icon name="ph:sparkle" width={22} />
              )}
            </div>
            <p className="sessions-empty-heading">
              {activeFamiliar
                ? `No chats with ${activeFamiliar.display_name} yet`
                : "No sessions yet"}
            </p>
            <p className="sessions-empty-body">
              {activeFamiliar
                ? `Start a conversation and it'll show up here.`
                : "Pick a familiar from the sidebar and start a chat."}
            </p>
            <button
              type="button"
              className="sessions-empty-cta"
              onClick={() => onNewChat(activeFamiliarId ?? undefined)}
            >
              <Icon name="ph:plus" width={12} />
              Start a chat
            </button>
          </div>
        ) : activeFamiliarId ? (
          /* Single-familiar grid */
          <SessionGroup
            familiar={activeFamiliar ?? undefined}
            sessions={filtered}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onNewChat={() => onNewChat(activeFamiliarId)}
            showNewChat
            layoutMode={layoutMode}
          />
        ) : (
          /* All-familiars grouped */
          <>
            {familiars
              .filter((f) => (groups?.get(f.id) ?? []).length > 0)
              .map((f) => (
                <SessionGroup
                  key={f.id}
                  familiar={f}
                  sessions={groups?.get(f.id) ?? []}
                  activeSessionId={activeSessionId}
                  onOpenSession={(id) => onOpenSession(id, f.id)}
                  onNewChat={() => onNewChat(f.id)}
                  showNewChat={false}
                  layoutMode={layoutMode}
                />
              ))}
            {/* Unassigned */}
            {(groups?.get(null) ?? []).length > 0 && (
              <SessionGroup
                familiar={undefined}
                sessions={groups?.get(null) ?? []}
                activeSessionId={activeSessionId}
                onOpenSession={onOpenSession}
                onNewChat={() => onNewChat(undefined)}
                showNewChat={false}
                layoutMode={layoutMode}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

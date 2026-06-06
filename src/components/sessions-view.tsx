"use client";

import "@/styles/sessions-view.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import type { Familiar, SessionRow, SessionOrigin } from "@/lib/types";
import { stripLeadingTrailingEmoji } from "@/lib/cave-chat-titles";

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

// SessionActionMenu

type SessionAction = "rename" | "archive" | "summon" | "sacrifice";

function SessionActionMenu({
  archived,
  onAction,
  onClose,
}: {
  archived: boolean;
  onAction: (action: SessionAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

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

  return (
    <div ref={ref} className="session-action-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        className="session-action-menu-item"
        onClick={(e) => {
          e.stopPropagation();
          onAction("rename");
        }}
      >
        <Icon name="ph:pencil-simple" width={12} />
        <span>Rename</span>
      </button>
      {archived ? (
        <button
          type="button"
          role="menuitem"
          className="session-action-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onAction("summon");
          }}
        >
          <Icon name="ph:arrow-counter-clockwise" width={12} />
          <span>Summon (unarchive)</span>
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="session-action-menu-item"
          onClick={(e) => {
            e.stopPropagation();
            onAction("archive");
          }}
        >
          <Icon name="ph:archive" width={12} />
          <span>Archive</span>
        </button>
      )}
      <div className="session-action-menu-divider" />
      <button
        type="button"
        role="menuitem"
        className="session-action-menu-item session-action-menu-item--danger"
        onClick={(e) => {
          e.stopPropagation();
          onAction("sacrifice");
        }}
      >
        <Icon name="ph:flame" width={12} />
        <span>Sacrifice...</span>
      </button>
    </div>
  );
}

// RenameInput (inline rename UI)

function RenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (next: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onSubmit(value);
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="session-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      }}
      onBlur={submit}
      aria-label="Session title"
      maxLength={200}
    />
  );
}

// SessionCard

function SessionCard({
  session,
  familiar,
  active,
  menuOpen,
  renaming,
  onClick,
  onOpenMenu,
  onCloseMenu,
  onAction,
  onRenameSubmit,
  onRenameCancel,
}: {
  session: SessionRow;
  familiar: Familiar | undefined;
  active: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onClick: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onAction: (action: SessionAction) => void;
  onRenameSubmit: (next: string) => void;
  onRenameCancel: () => void;
}) {
  const overrides = useGlyphOverrides();
  const glyph = familiar ? resolveFamiliarGlyph(familiar, overrides) : null;
  const ts = shortRelTime(session.updated_at || session.created_at);
  const title = stripLeadingTrailingEmoji(session.title || "Untitled session");
  const label = originLabel(session.origin);
  const archived = !!session.archived_at;

  return (
    <div
      className={`session-card${active ? " session-card--active" : ""}${
        archived ? " session-card--archived" : ""
      }`}
      onClick={renaming ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
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
        <div className="session-card-menu-wrap">
          <button
            type="button"
            className="session-card-menu-btn"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu();
            }}
          >
            <Icon name="ph:dots-three-vertical" width={13} />
          </button>
          {menuOpen && (
            <SessionActionMenu
              archived={archived}
              onAction={onAction}
              onClose={onCloseMenu}
            />
          )}
        </div>
      </div>
      {renaming ? (
        <RenameInput
          initial={session.title || ""}
          onSubmit={onRenameSubmit}
          onCancel={onRenameCancel}
        />
      ) : (
        <div className="session-card-title">{title}</div>
      )}
      <div className="session-card-footer">
        {archived && <span className="session-card-archived-badge">archived</span>}
        {label && <span className="session-card-origin">{label}</span>}
        {ts && <span className="session-card-ts">{ts}</span>}
      </div>
    </div>
  );
}

// ── SessionRowItem ────────────────────────────────────────────────────────────

function SessionRowItem({
  session,
  familiar,
  active,
  menuOpen,
  renaming,
  onClick,
  onOpenMenu,
  onCloseMenu,
  onAction,
  onRenameSubmit,
  onRenameCancel,
}: {
  session: SessionRow;
  familiar: Familiar | undefined;
  active: boolean;
  menuOpen: boolean;
  renaming: boolean;
  onClick: () => void;
  onOpenMenu: () => void;
  onCloseMenu: () => void;
  onAction: (action: SessionAction) => void;
  onRenameSubmit: (next: string) => void;
  onRenameCancel: () => void;
}) {
  const overrides = useGlyphOverrides();
  const glyph = familiar ? resolveFamiliarGlyph(familiar, overrides) : null;
  const ts = shortRelTime(session.updated_at || session.created_at);
  const title = stripLeadingTrailingEmoji(session.title || "Untitled session");
  const label = originLabel(session.origin);
  const archived = !!session.archived_at;

  return (
    <div
      className={`session-row${active ? " session-row--active" : ""}${
        archived ? " session-row--archived" : ""
      }`}
      onClick={renaming ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!renaming && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
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
        {renaming ? (
          <RenameInput
            initial={session.title || ""}
            onSubmit={onRenameSubmit}
            onCancel={onRenameCancel}
          />
        ) : (
          <div className="session-row-title">{title}</div>
        )}
        <div className="session-row-status-line">
          <span className={statusDotClass(session.status)} />
          <span className="session-row-status-label">{session.status}</span>
          {archived && <span className="session-row-archived-badge">archived</span>}
        </div>
      </div>
      <div className="session-row-meta">
        {label && <span className="session-card-origin">{label}</span>}
        {ts && <span className="session-card-ts">{ts}</span>}
        <div className="session-row-menu-wrap">
          <button
            type="button"
            className="session-card-menu-btn"
            aria-label="Session actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu();
            }}
          >
            <Icon name="ph:dots-three-vertical" width={13} />
          </button>
          {menuOpen && (
            <SessionActionMenu
              archived={archived}
              onAction={onAction}
              onClose={onCloseMenu}
            />
          )}
        </div>
      </div>
    </div>
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
  openMenuId,
  setOpenMenuId,
  renamingId,
  setRenamingId,
  onRenameSubmit,
  onAction,
}: {
  familiar: Familiar | undefined;
  sessions: SessionRow[];
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string) => void;
  onNewChat: () => void;
  showNewChat: boolean;
  layoutMode: SessionsLayoutMode;
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  onRenameSubmit: (id: string, next: string) => void;
  onAction: (id: string, action: SessionAction) => void;
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
              menuOpen={openMenuId === s.id}
              renaming={renamingId === s.id}
              onClick={() => onOpenSession(s.id)}
              onOpenMenu={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
              onCloseMenu={() => setOpenMenuId(null)}
              onAction={(a) => onAction(s.id, a)}
              onRenameSubmit={(next) => onRenameSubmit(s.id, next)}
              onRenameCancel={() => setRenamingId(null)}
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
              menuOpen={openMenuId === s.id}
              renaming={renamingId === s.id}
              onClick={() => onOpenSession(s.id)}
              onOpenMenu={() => setOpenMenuId(openMenuId === s.id ? null : s.id)}
              onCloseMenu={() => setOpenMenuId(null)}
              onAction={(a) => onAction(s.id, a)}
              onRenameSubmit={(next) => onRenameSubmit(s.id, next)}
              onRenameCancel={() => setRenamingId(null)}
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

// SacrificeDialog

function SacrificeDialog({
  sessionTitle,
  onConfirm,
  onCancel,
}: {
  sessionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="session-sacrifice-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-sacrifice-heading"
      onClick={onCancel}
    >
      <div
        className="session-sacrifice-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="session-sacrifice-icon">
          <Icon name="ph:flame" width={20} />
        </div>
        <h2 id="session-sacrifice-heading" className="session-sacrifice-heading">
          Sacrifice this session?
        </h2>
        <p className="session-sacrifice-body">
          <strong className="session-sacrifice-title">{sessionTitle}</strong>
          <br />
          The session will be hidden from the Cave. The underlying daemon record
          stays intact and can be restored by editing <code>cave-state.json</code>.
        </p>
        <div className="session-sacrifice-actions">
          <button
            type="button"
            className="session-sacrifice-btn session-sacrifice-btn--ghost"
            onClick={onCancel}
            autoFocus
          >
            Cancel
          </button>
          <button
            type="button"
            className="session-sacrifice-btn session-sacrifice-btn--danger"
            onClick={onConfirm}
          >
            <Icon name="ph:flame" width={12} />
            Sacrifice
          </button>
        </div>
      </div>
    </div>
  );
}

// SessionsView (exported)

export type SessionsViewProps = {
  familiars: Familiar[];
  sessions: SessionRow[];
  activeFamiliarId: string | null;
  activeSessionId: string | null | undefined;
  onOpenSession: (id: string, familiarId?: string) => void;
  onNewChat: (familiarId?: string) => void;
  /** Called after a successful mutation so the parent can refresh its sessions list. */
  onSessionsChanged?: () => void;
};

export function SessionsView({
  familiars,
  sessions,
  activeFamiliarId,
  activeSessionId,
  onOpenSession,
  onNewChat,
  onSessionsChanged,
}: SessionsViewProps) {
  const overrides = useGlyphOverrides();
  const [layoutMode, setLayoutMode] = useState<SessionsLayoutMode>("rows");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingSacrifice, setPendingSacrifice] = useState<SessionRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<SessionRow[]>([]);

  const activeFamiliar = familiars.find((f) => f.id === activeFamiliarId) ?? null;

  // Mutations

  const patchSession = async (
    id: string,
    body: { title?: string; archived?: boolean },
  ) => {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      onSessionsChanged?.();
      if (showArchived) void loadArchived();
    } catch {
      /* transient */
    }
  };

  const deleteSession = async (id: string) => {
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      onSessionsChanged?.();
      if (showArchived) void loadArchived();
    } catch {
      /* transient */
    }
  };

  const handleRenameSubmit = async (id: string, next: string) => {
    setRenamingId(null);
    setOpenMenuId(null);
    const target = [...sessions, ...archivedSessions].find((s) => s.id === id);
    if (!target) return;
    const trimmed = next.trim();
    if (trimmed === (target.title || "").trim()) return; // no-op
    await patchSession(id, { title: trimmed });
  };

  const handleAction = (id: string, action: SessionAction) => {
    setOpenMenuId(null);
    if (action === "rename") {
      setRenamingId(id);
      return;
    }
    if (action === "archive") {
      void patchSession(id, { archived: true });
      return;
    }
    if (action === "summon") {
      void patchSession(id, { archived: false });
      return;
    }
    if (action === "sacrifice") {
      const target = [...sessions, ...archivedSessions].find((s) => s.id === id);
      if (target) setPendingSacrifice(target);
    }
  };

  // Archived sessions (loaded on demand)

  const loadArchived = async () => {
    try {
      const res = await fetch("/api/sessions/list?includeArchived=1", {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.ok) {
        const all = (json.sessions ?? []) as SessionRow[];
        setArchivedSessions(all.filter((s) => !!s.archived_at));
      }
    } catch {
      /* transient */
    }
  };

  useEffect(() => {
    if (showArchived) void loadArchived();
    else setArchivedSessions([]);
  }, [showArchived]);

  // Sorting / grouping

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)),
    [sessions]
  );

  const filtered = useMemo(
    () =>
      activeFamiliarId
        ? sorted.filter((s) => s.familiarId === activeFamiliarId)
        : sorted,
    [sorted, activeFamiliarId]
  );

  const archivedFiltered = useMemo(() => {
    const sortedArch = [...archivedSessions].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : -1,
    );
    return activeFamiliarId
      ? sortedArch.filter((s) => s.familiarId === activeFamiliarId)
      : sortedArch;
  }, [archivedSessions, activeFamiliarId]);

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
          <button
            type="button"
            className={`sessions-view-archive-toggle${
              showArchived ? " sessions-view-archive-toggle--active" : ""
            }`}
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            title={showArchived ? "Hide archived" : "Show archived"}
          >
            <Icon name="ph:archive" width={12} />
            {showArchived ? "Hide archived" : "Archived"}
          </button>
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
        {filtered.length === 0 && archivedFiltered.length === 0 ? (
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
          <>
            <SessionGroup
              familiar={activeFamiliar ?? undefined}
              sessions={filtered}
              activeSessionId={activeSessionId}
              onOpenSession={onOpenSession}
              onNewChat={() => onNewChat(activeFamiliarId)}
              showNewChat
              layoutMode={layoutMode}
              openMenuId={openMenuId}
              setOpenMenuId={setOpenMenuId}
              renamingId={renamingId}
              setRenamingId={setRenamingId}
              onRenameSubmit={handleRenameSubmit}
              onAction={handleAction}
            />
            {showArchived && archivedFiltered.length > 0 && (
              <div className="sessions-archived-section">
                <div className="sessions-archived-divider">
                  <Icon name="ph:archive" width={11} />
                  <span>Archived</span>
                  <span className="sessions-group-count">{archivedFiltered.length}</span>
                </div>
                <SessionGroup
                  familiar={activeFamiliar ?? undefined}
                  sessions={archivedFiltered}
                  activeSessionId={activeSessionId}
                  onOpenSession={onOpenSession}
                  onNewChat={() => onNewChat(activeFamiliarId)}
                  showNewChat={false}
                  layoutMode={layoutMode}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  onRenameSubmit={handleRenameSubmit}
                  onAction={handleAction}
                />
              </div>
            )}
          </>
        ) : (
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
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  onRenameSubmit={handleRenameSubmit}
                  onAction={handleAction}
                />
              ))}
            {(groups?.get(null) ?? []).length > 0 && (
              <SessionGroup
                familiar={undefined}
                sessions={groups?.get(null) ?? []}
                activeSessionId={activeSessionId}
                onOpenSession={onOpenSession}
                onNewChat={() => onNewChat(undefined)}
                showNewChat={false}
                layoutMode={layoutMode}
                openMenuId={openMenuId}
                setOpenMenuId={setOpenMenuId}
                renamingId={renamingId}
                setRenamingId={setRenamingId}
                onRenameSubmit={handleRenameSubmit}
                onAction={handleAction}
              />
            )}
            {showArchived && archivedFiltered.length > 0 && (
              <div className="sessions-archived-section">
                <div className="sessions-archived-divider">
                  <Icon name="ph:archive" width={11} />
                  <span>Archived</span>
                  <span className="sessions-group-count">{archivedFiltered.length}</span>
                </div>
                <SessionGroup
                  familiar={undefined}
                  sessions={archivedFiltered}
                  activeSessionId={activeSessionId}
                  onOpenSession={onOpenSession}
                  onNewChat={() => onNewChat(undefined)}
                  showNewChat={false}
                  layoutMode={layoutMode}
                  openMenuId={openMenuId}
                  setOpenMenuId={setOpenMenuId}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  onRenameSubmit={handleRenameSubmit}
                  onAction={handleAction}
                />
              </div>
            )}
          </>
        )}
      </div>

      {pendingSacrifice && (
        <SacrificeDialog
          sessionTitle={pendingSacrifice.title || "Untitled session"}
          onCancel={() => setPendingSacrifice(null)}
          onConfirm={async () => {
            const id = pendingSacrifice.id;
            setPendingSacrifice(null);
            await deleteSession(id);
          }}
        />
      )}
    </div>
  );
}

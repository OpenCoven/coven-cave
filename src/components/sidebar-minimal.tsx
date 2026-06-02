"use client";

/**
 * SidebarMinimal — the redesigned Cave sidebar.
 *
 * Layout (top → bottom):
 *   1. 4 primary actions  (New chat / Search / Plugins / Automations)
 *   2. Folder mode rows   (Board / Inbox / Val's Inbox / Browser / Comux / Coven Calls)
 *   3. Familiar sections  (each familiar = header row + session list; no emoji row)
 *   4. Settings gear (pinned bottom)
 */

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarGlyph } from "@/components/familiar-glyph";
import { resolveFamiliarGlyph } from "@/lib/familiar-glyph";
import { useGlyphOverrides } from "@/lib/cave-glyph-overrides";
import type { Familiar, SessionRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Relative timestamp helpers
// ---------------------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

function relTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60)    return rtf.format(-Math.round(diffSec),        "second");
    if (diffSec < 3600)  return rtf.format(-Math.round(diffSec / 60),   "minute");
    if (diffSec < 86400) return rtf.format(-Math.round(diffSec / 3600), "hour");
    return rtf.format(-Math.round(diffSec / 86400), "day");
  } catch { return ""; }
}

// Short label: "5h", "13m", "2d"
function shortRelTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60)    return `${Math.round(diffSec)}s`;
    if (diffSec < 3600)  return `${Math.round(diffSec / 60)}m`;
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h`;
    const days = Math.round(diffSec / 86400);
    if (days < 30) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FolderMode = "board" | "inbox" | "vals-inbox" | "browser" | "comux" | "calls";

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  inboxBadgeCount?: number;
  familiars?: Familiar[];
  activeId?: string | null;
  onFamiliarSelect?: (id: string) => void;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
  onOpenSettings: () => void;
};

// ---------------------------------------------------------------------------
// Action button (top group)
// ---------------------------------------------------------------------------

function ActionRow({
  icon,
  label,
  kbd,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  kbd?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="sidebar-action-row" onClick={onClick}>
      <span className="sidebar-action-icon">{icon}</span>
      <span className="sidebar-action-label">{label}</span>
      {kbd && <span className="sidebar-action-kbd">{kbd}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Folder row (mode entries)
// ---------------------------------------------------------------------------

const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: "ph:kanban" | "ph:tray" | "ph:bell-fill" | "ph:globe" | "ph:squares-four" | "ph:clock" | "ph:graph";
  badge?: (props: SidebarMinimalProps) => string | undefined;
}> = [
  { id: "board",      label: "Board",       iconName: "ph:kanban" },
  { id: "inbox",      label: "Inbox",       iconName: "ph:tray",
    badge: (p) => p.inboxBadgeCount && p.inboxBadgeCount > 0 ? String(p.inboxBadgeCount) : undefined },
  { id: "vals-inbox", label: "Val's Inbox", iconName: "ph:bell-fill" },
  { id: "calls",      label: "Coven Calls", iconName: "ph:graph" },
  { id: "browser",    label: "Browser",     iconName: "ph:globe" },
  { id: "comux",      label: "Coven Code",  iconName: "ph:squares-four" },
];

function FolderRow({
  id,
  label,
  iconName,
  active,
  badge,
  onClick,
}: {
  id: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}`}
      onClick={onClick}
    >
      <Icon name={iconName} width={13} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Session row (inside familiar section)
// ---------------------------------------------------------------------------

function SessionItem({
  session,
  active,
  onClick,
}: {
  session: SessionRow;
  active: boolean;
  onClick: () => void;
}) {
  const ts = shortRelTime(session.updated_at || session.created_at);
  const title = session.title || "Untitled";
  return (
    <button
      type="button"
      title={relTime(session.updated_at || session.created_at) || title}
      className={`sidebar-session-row${active ? " sidebar-session-row--active" : ""}`}
      onClick={onClick}
    >
      <span className="sidebar-session-title">{title}</span>
      {ts && <span className="sidebar-session-ts">{ts}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Familiar section: header + collapsible session list
// ---------------------------------------------------------------------------

function FamiliarSection({
  familiar,
  sessions,
  activeSessionId,
  onOpenSession,
  onModeChange,
  defaultOpen,
}: {
  familiar: Familiar;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onOpenSession: (id: string) => void;
  onModeChange: (mode: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const overrides = useGlyphOverrides();
  const glyph = resolveFamiliarGlyph(familiar, overrides);

  return (
    <div className="sidebar-familiar-section">
      {/* Section header — click to toggle */}
      <button
        type="button"
        className="sidebar-familiar-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="sidebar-familiar-header-glyph">
          <FamiliarGlyph glyph={glyph} size="sm" />
        </span>
        <span className="sidebar-familiar-header-name">{familiar.display_name}</span>
        <span className="sidebar-familiar-header-meta">
          {sessions.length > 0 && (
            <span className="sidebar-familiar-header-count">{sessions.length}</span>
          )}
          <Icon
            name={open ? "ph:caret-down" : "ph:caret-right"}
            width={10}
            className="sidebar-familiar-header-chevron"
          />
        </span>
      </button>

      {/* Session list */}
      {open && (
        <div className="sidebar-familiar-sessions">
          {sessions.length === 0 ? (
            <div className="sidebar-familiar-sessions-empty">No sessions</div>
          ) : (
            sessions.map((s) => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === activeSessionId}
                onClick={() => {
                  onModeChange("chats");
                  onOpenSession(s.id);
                }}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarMinimal
// ---------------------------------------------------------------------------

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    sessions,
    activeSessionId,
    familiars = [],
    activeId = null,
    onFamiliarSelect,
    onNewChat,
    onOpenSearch,
    onModeChange,
    onOpenSession,
    onOpenSettings,
  } = props;

  // Chat sessions newest-first
  const chatSessions = useMemo(
    () =>
      sessions
        .filter((s) => !s.archived_at && (!s.origin || s.origin === "chat"))
        .sort((a, b) => {
          const ta = a.updated_at || a.created_at;
          const tb = b.updated_at || b.created_at;
          return tb.localeCompare(ta);
        }),
    [sessions],
  );

  // Map: familiarId → sorted sessions for that familiar (max 20 shown)
  const sessionsByFamiliar = useMemo(() => {
    const map: Record<string, SessionRow[]> = {};
    for (const f of familiars) map[f.id] = [];
    for (const s of chatSessions) {
      if (s.familiarId && map[s.familiarId]) {
        map[s.familiarId].push(s);
      }
    }
    // Each familiar's list is already sorted (chatSessions is sorted)
    for (const id of Object.keys(map)) map[id] = map[id].slice(0, 20);
    return map;
  }, [chatSessions, familiars]);

  // Sessions with no familiar → "Unassigned" bucket
  // Exclude sessions already shown under a familiar to avoid double-counting
  const unassignedSessions = useMemo(
    () => chatSessions.filter((s) => !s.familiarId || !sessionsByFamiliar[s.familiarId]).slice(0, 20),
    [chatSessions, sessionsByFamiliar],
  );

  // Which familiar section should start open (the one owning the active session)
  const defaultOpenId = useMemo(() => {
    if (!activeSessionId) return null;
    const active = chatSessions.find((s) => s.id === activeSessionId);
    return active?.familiarId ?? null;
  }, [chatSessions, activeSessionId]);

  return (
    <nav className="sidebar-minimal">
      {/* ── Primary actions ───────────────────────────────────── */}
      <div className="sidebar-actions">
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
        <ActionRow
          icon={<Icon name="ph:magnifying-glass" width={14} />}
          label="Search"
          kbd="⌘K"
          onClick={onOpenSearch}
        />
        <ActionRow
          icon={<Icon name="ph:plug" width={14} />}
          label="Plugins"
          onClick={() => onModeChange("plugins")}
        />
        <ActionRow
          icon={<Icon name="ph:clock" width={14} />}
          label="Automations"
          onClick={() => onModeChange("schedules")}
        />
      </div>

      {/* ── Folder mode rows ──────────────────────────────────── */}
      <div className="sidebar-folders">
        {FOLDER_MODES.map((fm) => (
          <FolderRow
            key={fm.id}
            id={fm.id}
            label={fm.label}
            iconName={fm.iconName}
            active={mode === fm.id}
            badge={fm.badge?.(props)}
            onClick={() => onModeChange(fm.id)}
          />
        ))}
      </div>

      {/* ── Familiar sections ─────────────────────────────────── */}
      <div className="sidebar-familiar-list">
        {familiars.map((f) => (
          <FamiliarSection
            key={f.id}
            familiar={f}
            sessions={sessionsByFamiliar[f.id] ?? []}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onModeChange={onModeChange}
            defaultOpen={f.id === defaultOpenId}
          />
        ))}

        {/* Unassigned sessions */}
        {unassignedSessions.length > 0 && (
          <div className="sidebar-familiar-section sidebar-familiar-section--unassigned">
            <div className="sidebar-familiar-header sidebar-familiar-header--plain">
              <span className="sidebar-familiar-header-name">Other</span>
              <span className="sidebar-familiar-header-count">{unassignedSessions.length}</span>
            </div>
            <div className="sidebar-familiar-sessions">
              {unassignedSessions.map((s) => (
                <SessionItem
                  key={s.id}
                  session={s}
                  active={s.id === activeSessionId}
                  onClick={() => {
                    onModeChange("chats");
                    onOpenSession(s.id);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Settings gear (pinned bottom) ─────────────────────── */}
      <div className="sidebar-bottom">
        <button
          type="button"
          className="sidebar-settings-row"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Icon name="ph:gear-six" width={14} />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}

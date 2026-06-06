"use client";

/**
 * SidebarMinimal — the redesigned Cave sidebar.
 *
 * Layout (top → bottom):
 *   1. 4 primary actions  (New chat / Search / Plugins / Automations)
 *   2. Folder mode rows   (Board / Inbox / Browser / Comux / Coven Calls)
 *   3. Familiar sections  (each familiar = header row + session list; no emoji row)
 *   4. Settings gear (pinned bottom)
 */

import { useMemo } from "react";
import { Icon } from "@/lib/icon";
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

export type FolderMode = "board" | "inbox" | "browser" | "comux" | "calls" | "github";

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
  iconName: "ph:kanban" | "ph:tray" | "ph:bell-fill" | "ph:globe" | "ph:squares-four" | "ph:clock" | "ph:graph" | "ph:github-logo";
  badge?: (props: SidebarMinimalProps) => string | undefined;
}> = [
  { id: "board",      label: "Board",       iconName: "ph:kanban" },
  { id: "inbox",      label: "Inbox",       iconName: "ph:bell-fill",
    badge: (p) => p.inboxBadgeCount && p.inboxBadgeCount > 0 ? String(p.inboxBadgeCount) : undefined },
  { id: "calls",      label: "Coven Calls", iconName: "ph:graph" },
  { id: "browser",    label: "Browser",     iconName: "ph:globe" },
  { id: "comux",      label: "Coven Code",  iconName: "ph:squares-four" },
  { id: "github",     label: "GitHub",      iconName: "ph:github-logo" },
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
// Familiar row (flat nav item — click to show sessions in center)
// ---------------------------------------------------------------------------

function FamiliarRow({
  familiar,
  sessionCount,
  active,
  onSelect,
}: {
  familiar: Familiar;
  sessionCount: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-familiar-row${active ? " sidebar-familiar-row--active" : ""}`}
      onClick={onSelect}
    >
      <span className="sidebar-familiar-row-name">{familiar.display_name}</span>
      {sessionCount > 0 && (
        <span className="sidebar-familiar-row-count">{sessionCount}</span>
      )}
    </button>
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

  // Chat sessions newest-first (used for session count badges)
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

  void chatSessions; // used in FamiliarRow count via sessions.filter below

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
        <ActionRow
          icon={<Icon name="ph:calendar-blank" width={14} />}
          label="Calendar"
          onClick={() => onModeChange("calendar")}
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

      {/* ── Familiar rows ──────────────────────────────────────── */}
      <div className="sidebar-familiar-list">
        {familiars.map((f) => {
          const count = sessions.filter((s) => s.familiarId === f.id).length;
          return (
            <FamiliarRow
              key={f.id}
              familiar={f}
              sessionCount={count}
              active={f.id === activeId}
              onSelect={() => {
                onFamiliarSelect?.(f.id);
                onModeChange("sessions");
              }}
            />
          );
        })}
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

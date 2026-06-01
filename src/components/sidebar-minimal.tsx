"use client";

/**
 * SidebarMinimal — the redesigned Cave sidebar.
 *
 * Layout (top → bottom):
 *   1. 4 primary actions  (New chat / Search / Plugins / Automations)
 *   2. 5 folder mode rows (Board / Inbox / Val's Inbox / Browser / Comux)
 *   3. Flat recent-chats list with relative timestamps
 *   4. Gear settings row (bottom, pinned)
 *
 * Familiars and the harness/model config block live in AgentPanel (right pane).
 * Settings gear opens the onboarding overlay.
 */

import { useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Relative timestamp
// ---------------------------------------------------------------------------

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" });

function relTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60)  return rtf.format(-Math.round(diffSec),       "second");
    if (diffSec < 3600) return rtf.format(-Math.round(diffSec / 60),  "minute");
    if (diffSec < 86400) return rtf.format(-Math.round(diffSec / 3600), "hour");
    return rtf.format(-Math.round(diffSec / 86400), "day");
  } catch { return ""; }
}

// Short label: "1mo", "5h", "13m"
function shortRelTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const diffSec = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diffSec < 60)   return `${Math.round(diffSec)}s`;
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

export type FolderMode = "board" | "inbox" | "vals-inbox" | "browser" | "comux" | "schedules" | "calls";

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  inboxBadgeCount?: number;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
  onOpenSettings: () => void;
};

// ---------------------------------------------------------------------------
// Action button (top 4)
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
    <button
      type="button"
      className="sidebar-action-row"
      onClick={onClick}
    >
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
  { id: "schedules",  label: "Schedules",   iconName: "ph:clock" },
  { id: "browser",    label: "Browser",     iconName: "ph:globe" },
  { id: "comux",      label: "Comux",       iconName: "ph:squares-four" },
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
// Recent chat row
// ---------------------------------------------------------------------------

function RecentRow({
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
      title={title}
      className={`sidebar-recent-row${active ? " sidebar-recent-row--active" : ""}`}
      onClick={onClick}
    >
      <span className="sidebar-recent-title">{title}</span>
      {ts && <span className="sidebar-recent-ts">{ts}</span>}
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
    onNewChat,
    onOpenSearch,
    onModeChange,
    onOpenSession,
    onOpenSettings,
  } = props;

  // Only show chat-origin sessions in recents; limit to 40
  const recents = useMemo(
    () =>
      sessions
        .filter((s) => !s.archived_at)
        .sort((a, b) => {
          const ta = a.updated_at || a.created_at;
          const tb = b.updated_at || b.created_at;
          return tb.localeCompare(ta);
        })
        .slice(0, 40),
    [sessions],
  );

  return (
    <nav className="sidebar-minimal">
      {/* ── 4 primary actions ─────────────────────────────────── */}
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
          icon={<Icon name="ph:calendar-blank" width={14} />}
          label="Automations"
          onClick={() => onModeChange("calls")}
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

      {/* ── Flat recents list ─────────────────────────────────── */}
      <div className="sidebar-recents-header">Recent</div>
      <div className="sidebar-recents">
        {recents.length === 0 ? (
          <div className="sidebar-recents-empty">No recent chats</div>
        ) : (
          recents.map((s) => (
            <RecentRow
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

      {/* ── Settings gear (bottom) ────────────────────────────── */}
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

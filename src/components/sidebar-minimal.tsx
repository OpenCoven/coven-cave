"use client";

/**
 * SidebarMinimal — the redesigned Cave sidebar.
 *
 * Layout (top → bottom):
 *   1. New chat CTA
 *   2. App destinations (Chat / Inbox / Tasks · Terminal / Projects / Browser · Calls / GitHub)
 *   3. Utility actions footer (Plugins / Automations / Calendar)
 */

import React from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FolderMode =
  | "chats"
  | "board"
  | "inbox"
  | "terminal"
  | "projects"
  | "browser"
  | "calls"
  | "github";

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  inboxBadgeCount?: number;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
};

// ---------------------------------------------------------------------------
// Action button
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
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  dividerBefore?: boolean;
}> = [
  // ── Primary loop ────────────────────────────────────────────────────────
  { id: "chats",    label: "Chat",        iconName: "ph:chat-circle-dots" },
  { id: "inbox",    label: "Inbox",       iconName: "ph:bell-fill",
    badge: (p) => p.inboxBadgeCount && p.inboxBadgeCount > 0 ? String(p.inboxBadgeCount) : undefined },
  { id: "board",    label: "Tasks",       iconName: "ph:kanban" },
  // ── Tools ───────────────────────────────────────────────────────────────
  { id: "terminal",  label: "Terminal",    iconName: "ph:terminal-window", dividerBefore: true },
  { id: "browser",   label: "Browser",     iconName: "ph:globe" },
  // ── Integrations ────────────────────────────────────────────────────────
  { id: "calls",   label: "Coven Calls", iconName: "ph:graph",       dividerBefore: true },
  { id: "github",  label: "GitHub",      iconName: "ph:github-logo" },
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
      <Icon name={iconName} width={15} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// SidebarMinimal
// ---------------------------------------------------------------------------

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    onNewChat,
    onModeChange,
  } = props;

  return (
    <nav className="sidebar-minimal">
      {/* ── New chat (top CTA) ──────────────────────────────── */}
      <div className="sidebar-actions">
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
      </div>

      {/* ── Folder mode rows ────────────────────────────────── */}
      <div className="sidebar-folders">
        {FOLDER_MODES.map((fm) => (
          <React.Fragment key={fm.id}>
            {fm.dividerBefore && <div className="sidebar-divider" />}
            <FolderRow
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              onClick={() => onModeChange(fm.id)}
            />
          </React.Fragment>
        ))}
      </div>

      {/* ── Utility actions (footer) ────────────────────────── */}
      <div className="sidebar-actions sidebar-actions--footer">
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
    </nav>
  );
}

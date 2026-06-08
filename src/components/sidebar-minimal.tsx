"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. New chat CTA
 *   2. App destinations (Chats / Sessions / Tasks -- Terminal / Browser -- GitHub)
 *   3. Utility actions footer (Plugins / Automations / Calendar)
 */

import React from "react";
import { Icon } from "@/lib/icon";
import type { Familiar, SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import { NotificationBell } from "@/components/notification-bell";

export type FolderMode =
  | "agents"
  | "sessions"
  | "board"
  | "terminal"
  | "projects"
  | "browser"
  | "github"
  | "library";

export type AddonsConfig = {
  github?: boolean;
  library?: boolean;
};

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
  addons?: AddonsConfig;
  /* Notifications — when omitted, the bell is hidden. */
  inboxItems?: InboxItem[];
  inboxPrefs?: InboxPrefs;
  familiars?: Familiar[];
  notificationBadgeCount?: number;
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged?: () => void;
};

const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  dividerBefore?: boolean;
}> = [
  // Primary loop
  { id: "agents", label: "Chats", iconName: "ph:chats" },
  { id: "sessions", label: "Sessions", iconName: "ph:rows" },
  { id: "board", label: "Tasks", iconName: "ph:kanban" },
  // Tools
  { id: "terminal", label: "Terminal",   iconName: "ph:terminal-window", dividerBefore: true },
  { id: "browser",  label: "Browser",    iconName: "ph:globe" },
  // Integrations
  { id: "github", label: "GitHub",       iconName: "ph:github-logo", dividerBefore: true },
  // Knowledge
  { id: "library", label: "Grimoire",     iconName: "ph:books",            dividerBefore: true },
];

const UTILITY_MODES: Array<{
  id: "plugins" | "schedules" | "calendar";
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
}> = [
  { id: "plugins", label: "Roles", iconName: "ph:sparkle" },
  { id: "schedules", label: "Automations", iconName: "ph:clock" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank" },
];

export { FOLDER_MODES, UTILITY_MODES };

function SidebarSection({
  label,
  className = "",
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`sidebar-folders ${className}`.trim()}>
      {label ? <div className="sidebar-section-label">{label}</div> : null}
      {children}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`sidebar-action-row ${active ? "sidebar-action-row--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="sidebar-action-icon">{icon}</span>
      <span className="sidebar-action-label">{label}</span>
      {trailing && <span className="sidebar-action-trailing">{trailing}</span>}
    </button>
  );
}

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
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={iconName} width={15} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
    </button>
  );
}

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    onNewChat,
    onOpenSearch,
    onOpenSettings,
    onModeChange,
    addons,
    inboxItems,
    inboxPrefs,
    familiars,
    notificationBadgeCount = 0,
    onOpenInbox,
    onOpenInboxItem,
    onNotificationPrefsChanged,
  } = props;

  // Filter out disabled add-on items. Default to hiding when addons is undefined.
  const visibleFolderModes = FOLDER_MODES.filter((fm) => {
    if (fm.id === "github") return addons?.github === true;
    if (fm.id === "library") return addons?.library === true;
    return true;
  });

  const showNotifications =
    !!onOpenInbox && !!onNotificationPrefsChanged && !!inboxPrefs;
  const primaryFolderModes = visibleFolderModes.filter((fm) => fm.id === "agents" || fm.id === "sessions" || fm.id === "board");
  const toolFolderModes = visibleFolderModes.filter((fm) => fm.id === "terminal" || fm.id === "browser");
  const addinFolderModes = visibleFolderModes.filter((fm) => fm.id === "github" || fm.id === "library");

  return (
    <nav className="sidebar-minimal">
      {/* Header actions: Search + New chat */}
      <div className="sidebar-actions sidebar-action-stack">
        <ActionRow
          icon={<Icon name="ph:magnifying-glass" width={14} />}
          label="Search"
          onClick={onOpenSearch}
          trailing={<kbd className="sidebar-action-kbd">⌘K</kbd>}
        />
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
      </div>

      <div className="sidebar-nav-scroll">
        <SidebarSection label="Work">
          {primaryFolderModes.map((fm) => (
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
        </SidebarSection>

        <SidebarSection label="Tools">
          {toolFolderModes.map((fm) => (
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
        </SidebarSection>

        {addinFolderModes.length > 0 ? (
          <SidebarSection label="Add-ins" className="sidebar-addins">
            {addinFolderModes.map((fm) => (
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
          </SidebarSection>
        ) : null}

        <SidebarSection label="Manage" className="sidebar-actions sidebar-actions--footer">
          {UTILITY_MODES.map((item) => (
            <ActionRow
              key={item.id}
              icon={<Icon name={item.iconName} width={14} />}
              label={item.label}
              active={mode === item.id}
              onClick={() => onModeChange(item.id)}
            />
          ))}
        </SidebarSection>
      </div>

      {/* Bottom: Notifications + Settings */}
      <div className="sidebar-foot">
        {showNotifications ? (
          <div className="sidebar-foot-bell">
            <NotificationBell
              items={inboxItems ?? []}
              familiars={familiars ?? []}
              prefs={inboxPrefs!}
              badgeCount={notificationBadgeCount}
              onOpenInbox={onOpenInbox!}
              onOpenItem={onOpenInboxItem}
              onPrefsChanged={onNotificationPrefsChanged!}
            />
            <span className="sidebar-foot-label">Notifications</span>
          </div>
        ) : null}
        <button
          type="button"
          className="sidebar-foot-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:gear-six" width={14} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}

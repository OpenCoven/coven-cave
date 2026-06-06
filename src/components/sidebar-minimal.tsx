"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. New chat CTA
 *   2. App destinations (Agents / Inbox / Tasks -- Terminal / Browser -- GitHub)
 *   3. Utility actions footer (Plugins / Automations / Calendar)
 */

import React from "react";
import { Icon } from "@/lib/icon";
import type { SessionRow } from "@/lib/types";

export type FolderMode =
  | "agents"
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
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
  addons?: AddonsConfig;
};

const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  dividerBefore?: boolean;
}> = [
  // Primary loop
  { id: "agents",  label: "Familiars",   iconName: "ph:robot" },
  { id: "board",   label: "Tasks",       iconName: "ph:kanban" },
  // Tools
  { id: "terminal", label: "Terminal",   iconName: "ph:terminal-window", dividerBefore: true },
  { id: "browser",  label: "Browser",    iconName: "ph:globe" },
  // Integrations
  { id: "github", label: "GitHub",       iconName: "ph:github-logo", dividerBefore: true },
  // Knowledge
  { id: "library", label: "Library",      iconName: "ph:books",            dividerBefore: true },
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

function ActionRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-action-row ${active ? "sidebar-action-row--active" : ""}`}
      onClick={onClick}
    >
      <span className="sidebar-action-icon">{icon}</span>
      <span className="sidebar-action-label">{label}</span>
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
      onClick={onClick}
    >
      <Icon name={iconName} width={15} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
    </button>
  );
}

export function SidebarMinimal(props: SidebarMinimalProps) {
  const { mode, onNewChat, onModeChange, addons } = props;

  // Filter out disabled add-on items. Default to hiding when addons is undefined.
  const visibleFolderModes = FOLDER_MODES.filter((fm) => {
    if (fm.id === "github") return addons?.github === true;
    if (fm.id === "library") return addons?.library === true;
    return true;
  });

  return (
    <nav className="sidebar-minimal">
      {/* Header action */}
      <div className="sidebar-actions">
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
      </div>

      {/* Primary nav rows: Agents / Tasks / Terminal / Browser */}
      <div className="sidebar-folders">
        {visibleFolderModes
          .filter((fm) => fm.id !== "github" && fm.id !== "library")
          .map((fm) => (
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

      {/* Add-ins section: GitHub · Library, directly under primary side-panel rows */}
      <div className="sidebar-folders sidebar-addins">
        <div className="sidebar-section-label">Add-ins</div>
        {visibleFolderModes
          .filter((fm) => fm.id === "github" || fm.id === "library")
          .map((fm) => (
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

      {/* Utility footer: Roles · Automations · Calendar */}
      <div className="sidebar-actions sidebar-actions--footer">
        {UTILITY_MODES.map((item) => (
          <ActionRow
            key={item.id}
            icon={<Icon name={item.iconName} width={14} />}
            label={item.label}
            active={mode === item.id}
            onClick={() => onModeChange(item.id)}
          />
        ))}
      </div>
    </nav>
  );
}

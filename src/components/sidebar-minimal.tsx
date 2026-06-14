"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Familiar scope selector + New chat CTA
 *   2. App destinations grouped by purpose:
 *      Work  (Home / Chat / Board / Calendar / Automations)
 *      Knowledge (Library)
 *      Tools (Browser / Terminal / Roles / Workflows / Capabilities / GitHub)
 *   3. Footer: Settings
 */

import React from "react";
import { Icon } from "@/lib/icon";
import { CHAT_OPEN_PROJECTS_EVENT } from "@/lib/chat-tab-events";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

export type FolderMode =
  | "agents"
  | "home"
  | "chat"
  | "board"
  | "calendar"
  | "inbox"
  | "terminal"
  | "browser"
  | "github"
  | "roles"
  | "workflows"
  | "library"
  | "capabilities";

// "projects" is a pseudo-mode rerouted by handleModeSelect (→ chat + event).
// It is never passed to onModeChange; only FolderMode values are real modes.
type FolderEntryId = FolderMode | "projects";

export type AddonsConfig = {
  github?: boolean;
  library?: boolean;
};

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: string) => void;
  /* Collapse the sidebar. When provided, a Dia-style toggle button renders at
   * the top of the panel; the left-edge rail reopens it once collapsed. */
  onToggleSidebar?: () => void;
  onOpenSession: (id: string) => void;
  addons?: AddonsConfig;
  /* Notifications — when omitted, the bell is hidden. */
  inboxItems?: InboxItem[];
  inboxPrefs?: InboxPrefs;
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  onFamiliarScopeChange: (id: string | null) => void;
  notificationBadgeCount?: number;
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged?: () => void;
};

const FOLDER_MODES: Array<{
  id: FolderEntryId;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  group: "work" | "knowledge" | "tools" | "addons";
  kbd?: string;
}> = [
  // Work
  { id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1" },
  { id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘2" },
  { id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank", group: "work", kbd: "⌘4" },
  { id: "inbox", label: "Automations", iconName: "ph:tray", group: "work", kbd: "⌘5" },
  // Knowledge
  { id: "library", label: "Library", iconName: "ph:books", group: "knowledge", kbd: "⌘6" },
  // Tools
  { id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8" },
  { id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools" },
  { id: "workflows", label: "Workflows", iconName: "ph:git-branch-bold", group: "tools" },
  { id: "projects", label: "Projects", iconName: "ph:folders-bold", group: "tools", kbd: "⌘9" },
  { id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools" },
  // Add-ons (gated)
  { id: "github", label: "GitHub", iconName: "ph:github-logo", group: "addons" },
];

export { FOLDER_MODES };

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

function FamiliarScopeSelect({
  familiars,
  activeFamiliarId,
  onFamiliarScopeChange,
}: {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  onFamiliarScopeChange: (id: string | null) => void;
}) {
  return (
    <label className="sidebar-familiar-filter">
      <span className="sidebar-familiar-filter__label">Familiar</span>
      <span className="sidebar-familiar-filter__control">
        <Icon name="ph:sparkle" width={14} className="sidebar-familiar-filter__icon" aria-hidden />
        <select
          aria-label="Filter workspace by familiar"
          value={activeFamiliarId ?? ""}
          onChange={(e) => onFamiliarScopeChange(e.currentTarget.value || null)}
          className="sidebar-familiar-filter__select"
        >
          <option value="">Familiars</option>
          {familiars.map((familiar) => (
            <option key={familiar.id} value={familiar.id}>
              {familiar.display_name}
            </option>
          ))}
        </select>
        <Icon name="ph:caret-up-down-bold" width={11} className="sidebar-familiar-filter__chevron" aria-hidden />
      </span>
    </label>
  );
}

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
      aria-current={active ? "page" : undefined}
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
  kbd,
  onClick,
}: {
  id: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  badge?: string;
  kbd?: string;
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
      {kbd && !badge && <kbd className="sidebar-folder-kbd">{kbd}</kbd>}
    </button>
  );
}

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    onNewChat,
    onOpenSettings,
    onModeChange,
    onToggleSidebar,
    addons,
    familiars,
    activeFamiliarId,
    onFamiliarScopeChange,
  } = props;

  // Projects is no longer a top-level WorkspaceMode — reroute via the chat tab event.
  // The "projects" guard narrows id to FolderMode below, so onModeChange stays type-safe.
  const handleModeSelect = (id: FolderEntryId) => {
    if (id === "projects") {
      onModeChange("chat");
      window.setTimeout(() => window.dispatchEvent(new CustomEvent(CHAT_OPEN_PROJECTS_EVENT)), 0);
      return;
    }
    onModeChange(id);
  };

  // Filter out disabled add-on items. GitHub is gated; library is always shown.
  const visibleFolderModes = FOLDER_MODES.filter((fm) => {
    if (fm.id === "github") return addons?.github === true;
    return true;
  });

  const workModes = visibleFolderModes.filter((fm) => fm.group === "work");
  const knowledgeModes = visibleFolderModes.filter((fm) => fm.group === "knowledge");
  const toolsModes = visibleFolderModes.filter((fm) => fm.group === "tools" || fm.group === "addons");

  return (
    <nav className="sidebar-minimal">
      {/* Dia-style panel toggle pinned to the top of the sidebar. Collapsing
          hands off to the left-edge rail, which reopens the panel. */}
      {onToggleSidebar ? (
        <button
          type="button"
          className="sidebar-header"
          onClick={onToggleSidebar}
          aria-label="Hide sidebar (⌘B)"
          title="Hide sidebar (⌘B)"
          aria-expanded
        >
          <span className="sidebar-title">Coven Cave</span>
          <span className="sidebar-toggle" aria-hidden>
            <Icon name="ph:sidebar-simple-fill" width={16} />
          </span>
        </button>
      ) : null}

      {/* Header actions: familiar scope + New chat */}
      <div className="sidebar-actions sidebar-action-stack">
        <FamiliarScopeSelect
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          onFamiliarScopeChange={onFamiliarScopeChange}
        />
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
      </div>

      <div className="sidebar-nav-scroll">
        <SidebarSection label="Work">
          {workModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => handleModeSelect(fm.id)}
            />
          ))}
        </SidebarSection>

        <SidebarSection label="Knowledge">
          {knowledgeModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => handleModeSelect(fm.id)}
            />
          ))}
        </SidebarSection>

        <SidebarSection label="Tools">
          {toolsModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => handleModeSelect(fm.id)}
            />
          ))}
        </SidebarSection>
      </div>

      {/* Bottom: Settings */}
      <div className="sidebar-foot">
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

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
import { FamiliarSwitcher } from "@/components/familiar-switcher";
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
  | "capabilities"
  | "calls";

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
  responseNeeded?: Set<string>;
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
  group: "work" | "knowledge" | "tools" | "addons";
  kbd?: string;
  // One-line hover/long-press help. Differentiates the surfaces that read
  // alike at a glance — especially Roles (who) vs Workflows (steps) vs
  // Capabilities (what tools).
  description: string;
}> = [
  // Work
  { id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1", description: "Overview and quick actions" },
  { id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘2", description: "Talk with your familiars" },
  { id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3", description: "Track tasks across projects" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank", group: "work", kbd: "⌘4", description: "Schedule and timeline of work" },
  { id: "inbox", label: "Automations", iconName: "ph:tray", group: "work", kbd: "⌘5", description: "Scheduled runs and items needing attention" },
  // Knowledge
  { id: "library", label: "Library", iconName: "ph:books", group: "knowledge", kbd: "⌘6", description: "Saved docs, links, and reading" },
  // Tools
  { id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7", description: "Built-in web browser" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8", description: "Shell session in your project" },
  { id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools", description: "Reusable agent personas you can attach to a familiar" },
  { id: "workflows", label: "Workflows", iconName: "ph:git-branch-bold", group: "tools", description: "Multi-step pipelines that orchestrate familiars" },
  { id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools", description: "Skills and tools your familiars can use" },
  { id: "calls", label: "Delegations", iconName: "ph:graph", group: "tools", description: "Delegation call graph and live floor activity" },
  // Add-ons (gated)
  { id: "github", label: "GitHub", iconName: "ph:github-logo", group: "addons", description: "Issues and PRs assigned to you" },
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
  description,
  onClick,
}: {
  id: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  badge?: string;
  kbd?: string;
  description?: string;
  onClick: () => void;
}) {
  // Native title doubles as a desktop hover tooltip and a touch long-press
  // hint, and is exposed to AT as the button's accessible description.
  const title = description
    ? kbd
      ? `${label} — ${description} (${kbd})`
      : `${label} — ${description}`
    : undefined;
  return (
    <button
      type="button"
      className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}`}
      aria-current={active ? "page" : undefined}
      title={title}
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
    sessions,
    onNewChat,
    onOpenSettings,
    onModeChange,
    onToggleSidebar,
    addons,
    familiars,
    activeFamiliarId,
    onFamiliarScopeChange,
    responseNeeded,
  } = props;

  // Projects lives only inside the Chat surface's Projects tab now (and ⌘9 /
  // the /projects deep-link in workspace.tsx open it there) — no sidebar entry.
  const handleModeSelect = (id: FolderMode) => {
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

      {/* Header actions: familiar profile switcher + New chat. The same switcher
          also renders in the mobile top bar; on desktop this is its home. */}
      <div className="sidebar-actions sidebar-action-stack">
        <div className="sidebar-familiar-slot">
          <FamiliarSwitcher
            familiars={familiars}
            activeFamiliarId={activeFamiliarId}
            sessions={sessions}
            responseNeeded={responseNeeded}
            onSelectFamiliar={onFamiliarScopeChange}
          />
        </div>
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
        <ActionRow
          icon={<Icon name="ph:sparkle" width={14} />}
          label="Ask Salem"
          onClick={() => {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("cave:salem-open"));
            }
          }}
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
              description={fm.description}
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
              description={fm.description}
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
              description={fm.description}
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

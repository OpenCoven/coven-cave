"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Familiar scope selector + New chat CTA
 *   2. App destinations grouped by purpose:
 *      Work  (Home / Familiars / Board / Calendar / Schedules)
 *      Tools (Browser / Terminal / Code / Library / Roles / Workflows / GitHub)
 *   3. Footer: Notifications, mobile handoff, Settings
 */

import React from "react";
import { Icon } from "@/lib/icon";
import { RecentActivityRollup } from "@/components/recent-activity-rollup";
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
  | "code"
  | "browser"
  | "github"
  | "roles"
  | "workflows"
  | "library"
  | "capabilities"
  | "journal";

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
  onOpenMobileHandoff: () => void;
  onModeChange: (mode: string) => void;
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
  group: "work" | "tools" | "addons";
  kbd?: string;
  // One-line hover/long-press help. Differentiates the surfaces that read
  // alike at a glance — especially Roles (who) vs Workflows (steps).
  description: string;
}> = [
  // Work
  { id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1", description: "Overview and quick actions" },
  { id: "chat", label: "Familiars", iconName: "ph:chats", group: "work", kbd: "⌘2", description: "Talk with your familiars" },
  { id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3", description: "Track tasks across projects" },
  { id: "journal", label: "Journal", iconName: "ph:book-open", group: "work", description: "Your daily journal and generated sketches" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank", group: "work", kbd: "⌘4", description: "Schedule and timeline of work" },
  { id: "inbox", label: "Schedules", iconName: "ph:calendar-bold", group: "work", kbd: "⌘5", description: "Reminders and recurring agent automations" },
  // Tools
  { id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘6", description: "Built-in web browser" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘7", description: "Shell session in your project" },
  { id: "code", label: "Code", iconName: "ph:code", group: "tools", kbd: "⌘8", description: "Chat with a familiar beside your files and terminal" },
  { id: "library", label: "Library", iconName: "ph:books", group: "tools", kbd: "⌘0", description: "Saved docs, links, and reading" },
  { id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools", description: "Agent personas, workflows, skills, and the capabilities your familiars can use" },
  { id: "workflows", label: "Workflows", iconName: "ph:git-branch-bold", group: "tools", description: "Multi-step pipelines that orchestrate familiars" },
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
  const storageKey = label
    ? `cave:sidebar:section:${label.toLowerCase().replace(/\s+/g, "-")}`
    : null;
  const [collapsed, setCollapsed] = React.useState(false);
  // Hydrate the persisted collapse state after mount so the SSR markup (always
  // expanded) matches the first client render, then reconcile from storage.
  React.useEffect(() => {
    if (!storageKey) return;
    setCollapsed(localStorage.getItem(storageKey) === "1");
  }, [storageKey]);
  const toggle = React.useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      if (storageKey) localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  }, [storageKey]);
  return (
    <div className={`sidebar-folders ${className}`.trim()}>
      {label ? (
        // The whole header is the hit target — clicking anywhere across its full
        // height/width collapses or expands the section.
        <button
          type="button"
          className="sidebar-section-label"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <span className="sidebar-section-label__text">{label}</span>
          <Icon
            name="ph:caret-down-bold"
            width="0.7rem"
            className={`sidebar-section-label__chevron${collapsed ? " sidebar-section-label__chevron--collapsed" : ""}`}
          />
        </button>
      ) : null}
      {collapsed ? null : children}
    </div>
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
      {/* The ⌘-number shortcut is no longer shown as a chip here: the numbers
          don't ascend with row position (e.g. ⌘0 Code sits above ⌘6 Library),
          so a visible column read as scrambled. The binding still works, the
          hover/title tooltip still names it, and the Shortcuts sheet (⌘/)
          is the canonical, complete catalog. */}
    </button>
  );
}

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    onNewChat,
    onOpenSettings,
    onOpenMobileHandoff,
    onModeChange,
    onOpenSession,
    activeSessionId,
    addons,
    notificationBadgeCount,
    onOpenInbox,
  } = props;

  const unreadCount = notificationBadgeCount ?? 0;

  // Projects lives only inside the Familiars surface's Projects tab now (and ⌘9 /
  // the /projects deep-link in workspace.tsx open it there) — no sidebar entry.
  const handleModeSelect = (id: FolderMode) => {
    onModeChange(id);
  };

  // Filter out disabled add-on items. GitHub and Library are gated add-ons,
  // hidden from the nav until enabled in Settings → Add-ons (both default off).
  const visibleFolderModes = FOLDER_MODES.filter((fm) => {
    if (fm.id === "github") return addons?.github === true;
    if (fm.id === "library") return addons?.library === true;
    return true;
  });

  const workModes = visibleFolderModes.filter((fm) => fm.group === "work");
  const toolsModes = visibleFolderModes.filter((fm) => fm.group === "tools" || fm.group === "addons");

  return (
    <nav className="sidebar-minimal">
      {/* Static wordmark. Collapsing the sidebar is now owned by the shell's
          floating top-left toggle (and ⌘B), so the header is no longer a
          button — it just leaves room for the float. */}
      {/* Familiar scope selection lives in the desktop top menu bar
          (FamiliarMenuBar) and the mobile top bar. "New chat" is the left
          panel's top CTA, so the nav flows under it. */}
      <div className="sidebar-header sidebar-header--static">
        <span className="sidebar-title">Coven Cave</span>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="sidebar-action-row focus-ring" onClick={onNewChat} title="New chat">
          <Icon name="ph:note-pencil" width={16} aria-hidden />
          <span>New chat</span>
        </button>
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

        <SidebarSection label="Tools">
          {toolsModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              // Capabilities now lives as a tab on the Roles page, so keep the
              // Roles entry lit when that mode is active.
              active={mode === fm.id || (fm.id === "roles" && mode === "capabilities")}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              description={fm.description}
              onClick={() => handleModeSelect(fm.id)}
            />
          ))}
        </SidebarSection>

        <RecentActivityRollup activeSessionId={activeSessionId} onOpenSession={onOpenSession} />
      </div>

      {/* Bottom: Dashboard + Notifications + Settings */}
      <div className="sidebar-foot">
        {/* Dashboard is a standalone Next route (/dashboard), not a workspace
            mode — navigate with a real link rather than onModeChange. */}
        <a
          className="sidebar-foot-btn"
          href="/dashboard"
          title="Dashboard — activity overview and daily reports"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:squares-four" width={14} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Dashboard</span>
        </a>
        {onOpenInbox ? (
          <button
            type="button"
            className="sidebar-foot-btn"
            onClick={onOpenInbox}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            title={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
          >
            <span className="sidebar-foot-icon-cell" aria-hidden="true">
              <Icon
                name={unreadCount > 0 ? "ph:bell-fill" : "ph:bell"}
                width={14}
                className="sidebar-foot-icon"
              />
            </span>
            <span className="sidebar-foot-label">Notifications</span>
            {unreadCount > 0 ? (
              <span className="sidebar-foot-badge" aria-hidden="true">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </button>
        ) : null}
        <div className="sidebar-foot-utility-row">
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
          <button
            type="button"
            className="sidebar-foot-icon-btn"
            onClick={onOpenMobileHandoff}
            aria-label="Open on phone"
            title="Open on phone"
          >
            <Icon name="ph:device-mobile" width={14} className="sidebar-foot-icon" />
          </button>
        </div>
      </div>
    </nav>
  );
}

"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Familiar scope selector + New chat CTA
 *   2. App destinations as one flat visible list
 *   3. Footer: Dashboard, Settings
 */

import React from "react";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  PAGE_DRAG_MIME,
  emitPageDragStart,
  emitPageDragEnd,
  isSplittablePage,
} from "@/lib/page-drag";
import { RecentActivityRollup } from "@/components/recent-activity-rollup";
import { APP_VERSION } from "@/lib/app-version";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

export type FolderMode =
  | "agents"
  | "home"
  | "chat"
  | "groupchat"
  | "board"
  | "calendar"
  | "inbox"
  | "browser"
  | "github"
  | "roles"
  | "marketplace"
  | "flow"
  | "submissions"
  | "capabilities"
  | "familiar-work-queue"
  | "journal";

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
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
  /** Live counts surfaced as small nav badges (omitted/0 -> no badge). */
  boardOpenCount?: number;
  scheduleNeedsCount?: number;
  githubAssignedCount?: number;
};

// Format a count as a compact nav badge; 0/undefined yields no badge.
function badgeText(n?: number): string | undefined {
  if (!n || n <= 0) return undefined;
  return n > 99 ? "99+" : String(n);
}

const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  kbd?: string;
  // One-line hover/long-press help. Differentiates surfaces that read alike at
  // a glance.
  description: string;
  /** Visual demotion (§8 quiet hierarchy): still one flat list — same roving
   *  tabindex, same click targets — but quiet rows render muted-until-hover
   *  and the first one opens a spacing gap, so daily destinations read first. */
  quiet?: boolean;
  /** Kept in the list (so the command palette's "Go to" launcher and the
   *  ⌘-number shortcut still reach it) but NOT rendered as a sidebar row. For
   *  surfaces you summon on demand rather than navigate to daily — the Browser
   *  opens itself when a link/URL is clicked, so it needn't sit in the nav. */
  navHidden?: boolean;
}> = [
  { id: "home", label: "Home", iconName: "ph:house-bold", kbd: "⌘1", description: "Overview and quick actions" },
  { id: "chat", label: "Chat", iconName: "ph:chats", kbd: "⌘2", description: "Talk with your familiars — 1:1 or a Group tab for a whole coven" },
  // Group Chat ("coven") is no longer a standalone destination — it lives as the
  // Group tab inside Chat. The `groupchat` mode still exists as a redirect target.
  { id: "board", label: "Tasks", iconName: "ph:kanban", kbd: "⌘3", description: "Track tasks across projects", badge: (p) => badgeText(p.boardOpenCount) },
  { id: "journal", label: "Journal", iconName: "ph:book-open", description: "Your daily journal and generated sketches" },
  { id: "inbox", label: "Schedules", iconName: "ph:calendar-check", kbd: "⌘4", description: "Calendar and crons in one place", badge: (p) => badgeText(p.scheduleNeedsCount) },
  // Browser is summoned on demand (a clicked link/URL opens it, plus ⌘5 and the
  // ⌘K palette) rather than navigated to daily, so it's kept in the list for
  // those launchers but hidden from the sidebar rows.
  { id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", navHidden: true },
  { id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description: "Browse the store and manage your familiars' roles, skills, and capabilities", quiet: true },
  // Submissions (OpenCoven runtime/harness submit) is hidden from the nav; the
  // mode + page remain reachable programmatically but aren't surfaced here.
  { id: "github", label: "GitHub", iconName: "ph:github-logo", description: "Issues and PRs assigned to you", badge: (p) => badgeText(p.githubAssignedCount), quiet: true },
  { id: "familiar-work-queue", label: "Work Queue", iconName: "ph:list-checks-bold", description: "Ready beads and the PR control tower, by familiar", quiet: true },
];

// Rows actually rendered in the sidebar — everything except on-demand surfaces
// (navHidden), which stay in FOLDER_MODES for the ⌘K palette + ⌘-number launcher.
const VISIBLE_MODES = FOLDER_MODES.filter((fm) => !fm.navHidden);

export { FOLDER_MODES };


function FolderRow({
  id,
  label,
  iconName,
  active,
  badge,
  kbd,
  description,
  quiet,
  quietLead,
  onClick,
}: {
  id: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  badge?: string;
  kbd?: string;
  description?: string;
  quiet?: boolean;
  /** First quiet row opens the spacing gap between the daily destinations
   *  and the demoted cluster (surface step, no divider — §8). */
  quietLead?: boolean;
  onClick: () => void;
}) {
  // Splittable pages can be dragged into the main area to open beside the
  // current surface (desktop snap-to-split). Non-clickable drags don't fire the
  // onClick, so navigation by click is unaffected.
  const draggable = isSplittablePage(id);
  // Native title doubles as a desktop hover tooltip and a touch long-press
  // hint, and is exposed to AT as the button's accessible description.
  const dragHint = draggable ? " · drag into the page to split" : "";
  const title = description
    ? kbd
      ? `${label} — ${description} (${kbd})${dragHint}`
      : `${label} — ${description}${dragHint}`
    : undefined;
  return (
    <button
      type="button"
      className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}${quiet ? " sidebar-folder-row--quiet" : ""}${quietLead ? " sidebar-folder-row--quiet-lead" : ""}`}
      aria-current={active ? "page" : undefined}
      title={title}
      draggable={draggable || undefined}
      onClick={onClick}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.setData(PAGE_DRAG_MIME, id);
              e.dataTransfer.setData("text/plain", label);
              e.dataTransfer.effectAllowed = "copy";
              emitPageDragStart({ mode: id, label });
            }
          : undefined
      }
      onDragEnd={draggable ? () => emitPageDragEnd() : undefined}
    >
      <Icon name={iconName} width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
      {/* The ⌘-number shortcut is no longer shown as a chip here: the numbers
          don't ascend with row position,
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
    onModeChange,
    onOpenSession,
    activeSessionId,
  } = props;

  // Arrow-key navigation across the flat nav rows: one tab stop, Up/Down moves
  // focus, Home/End jumps. Uses the shared roving-tabindex hook.
  const navScrollRef = React.useRef<HTMLDivElement | null>(null);
  useRovingTabIndex({ containerRef: navScrollRef, itemSelector: ".sidebar-folder-row", orientation: "vertical" });

  // Projects lives only inside the Familiars surface's Projects tab now (and ⌘9 /
  // the /projects deep-link in workspace.tsx open it there) — no sidebar entry.
  const handleModeSelect = (id: FolderMode) => {
    onModeChange(id);
  };

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
          <Icon
            name="ph:note-pencil"
            className="sidebar-action-icon"
            width={CAVE_ICON_SIZE.sidePanelAction}
            height={CAVE_ICON_SIZE.sidePanelAction}
            aria-hidden
          />
          <span>New chat</span>
        </button>
      </div>

      <div className="sidebar-nav-scroll" ref={navScrollRef}>
        {VISIBLE_MODES.map((fm, i) => (
          <FolderRow
            key={fm.id}
            id={fm.id}
            label={fm.label}
            iconName={fm.iconName}
            // Roles and Capabilities are sections of the Marketplace hub, so keep
            // the Marketplace entry lit when those modes are active.
            active={mode === fm.id || (fm.id === "marketplace" && (mode === "roles" || mode === "capabilities"))}
            badge={fm.badge?.(props)}
            kbd={fm.kbd}
            description={fm.description}
            quiet={fm.quiet}
            // Index the VISIBLE list, not FOLDER_MODES — a navHidden entry between
            // quiet rows must not throw off the "first quiet row" gap.
            quietLead={Boolean(fm.quiet) && !VISIBLE_MODES[i - 1]?.quiet}
            onClick={() => handleModeSelect(fm.id)}
          />
        ))}

        <RecentActivityRollup activeSessionId={activeSessionId} onOpenSession={onOpenSession} />
      </div>

      {/* Bottom: Dashboard + Settings */}
      <div className="sidebar-foot">
        {/* Dashboard is a standalone Next route (/dashboard), not a workspace
            mode — navigate with a real link rather than onModeChange. */}
        <a
          className="sidebar-foot-btn"
          href="/dashboard"
          aria-label="Dashboard"
          title="Dashboard — activity overview and daily reports"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:squares-four" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Dashboard</span>
        </a>
        <button
          type="button"
          className="sidebar-foot-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:gear-six" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Settings</span>
        </button>
      </div>

      {/* Bottommost: app version — one minimal-height muted line. */}
      <div className="sidebar-version" title={`CovenCave v${APP_VERSION}`}>
        v{APP_VERSION}
      </div>
    </nav>
  );
}

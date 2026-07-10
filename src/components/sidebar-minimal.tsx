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
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  PAGE_DRAG_MIME,
  emitPageDragStart,
  emitPageDragEnd,
  isSplittablePage,
} from "@/lib/page-drag";
import { sidebarRowState, type SidebarRowState } from "@/lib/sidebar-nav-state";
import { RecentActivityRollup } from "@/components/recent-activity-rollup";
import { SidebarFooter } from "@/components/sidebar-footer";
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
  | "journal"
  | "grimoire";

export type SidebarRoleSurfaceRow = {
  /** Generic workspace mode string (`surface:<id>`) — the sidebar never
   *  interprets it, only round-trips it through onModeChange. */
  mode: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  description: string;
};

export type SidebarMinimalProps = {
  mode: string;
  /** Page modes currently open as secondary split tiles (drag-to-split).
   *  Their rows get a lighter "open in split" wash instead of the active fill,
   *  so the highlight stays honest when a page renders beside the primary. */
  splitPageModes?: readonly string[];
  /** Grimoire's current tab — lights the Journal row (not Grimoire) while the
   *  Journal tab is up, since `mode` is never "journal" (cave-s9p6). */
  grimoireView?: string;
  /** Role Surface rooms visible for the active familiar. Registry-driven —
   *  rendered as their own cluster; empty/omitted hides the cluster. */
  roleSurfaces?: readonly SidebarRoleSurfaceRow[];
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
  /** Multiselect scope (≥2 ids) — the header switcher checks members and
   *  summarizes the count on its trigger. */
  selectedFamiliarIds?: ReadonlySet<string>;
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean }) => void;
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
  { id: "inbox", label: "Schedules", iconName: "ph:calendar-check", kbd: "⌘4", description: "Calendar and crons in one place", badge: (p) => badgeText(p.scheduleNeedsCount) },
  // Chat-first hierarchy (cave-xsq.8): the prominent cluster is exactly the
  // ⌘-numbered daily destinations (Home · Chat · Tasks · Schedules — Schedules
  // also carries the needs-you badge). Journal and Grimoire join the quiet
  // cluster: same flat list, same reachability (rows, palette, deep links),
  // just muted-until-hover so the conversation-first surfaces read first.
  { id: "journal", label: "Journal", iconName: "ph:book-open", description: "Your familiars' daily reflections — a tab in the Grimoire", quiet: true },
  { id: "grimoire", label: "Grimoire", iconName: "ph:books", description: "Edit memory, knowledge, and journal markdown as living documents", quiet: true },
  // Browser is summoned on demand (a clicked link/URL opens it, plus ⌘5 and the
  // ⌘K palette) rather than navigated to daily, so it's kept in the list for
  // those launchers but hidden from the sidebar rows.
  { id: "browser", label: "Browser", iconName: "ph:globe", kbd: "⌘5", description: "Built-in web browser", navHidden: true },
  { id: "marketplace", label: "Marketplace", iconName: "ph:storefront-bold", description: "Browse the store and manage your familiars' roles, skills, and capabilities", quiet: true },
  // Submissions (OpenCoven runtime/harness submit) is hidden from the nav; the
  // mode + page remain reachable programmatically but aren't surfaced here.
  { id: "github", label: "GitHub", iconName: "ph:github-logo", description: "Issues and PRs assigned to you", badge: (p) => badgeText(p.githubAssignedCount), quiet: true },
];

// Rows actually rendered in the sidebar — everything except on-demand surfaces
// (navHidden), which stay in FOLDER_MODES for the ⌘K palette + ⌘-number launcher.
const VISIBLE_MODES = FOLDER_MODES.filter((fm) => !fm.navHidden);

export { FOLDER_MODES };


function FolderRow({
  id,
  label,
  iconName,
  state,
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
  state: SidebarRowState;
  badge?: string;
  kbd?: string;
  description?: string;
  quiet?: boolean;
  /** First quiet row opens the spacing gap between the daily destinations
   *  and the demoted cluster (surface step, no divider — §8). */
  quietLead?: boolean;
  onClick: () => void;
}) {
  const active = state === "active";
  const split = state === "split";
  // Splittable pages can be dragged into the main area to open beside the
  // current surface (desktop snap-to-split). Non-clickable drags don't fire the
  // onClick, so navigation by click is unaffected.
  const draggable = isSplittablePage(id);
  // Native title doubles as a desktop hover tooltip and a touch long-press
  // hint, and is exposed to AT as the button's accessible description.
  const dragHint = draggable ? " · drag into the page to split" : "";
  const splitHint = split ? " · open in split" : "";
  const title = description
    ? kbd
      ? `${label} — ${description} (${kbd})${dragHint}${splitHint}`
      : `${label} — ${description}${dragHint}${splitHint}`
    : undefined;
  return (
    <button
      type="button"
      className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}${split ? " sidebar-folder-row--split" : ""}${quiet ? " sidebar-folder-row--quiet" : ""}${quietLead ? " sidebar-folder-row--quiet-lead" : ""}`}
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
    familiars,
    activeFamiliarId,
    selectedFamiliarIds,
    onFamiliarScopeChange,
    sessions,
    responseNeeded,
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
      {/* Familiar scope lives HERE, on every page (cave-vtk9) — the sidenav
          header carries the labeled dropdown switcher; the collapsed rail
          keeps the avatar-only trigger. The mobile top bar keeps its own
          (the drawer hides this one). */}
      <div className="sidebar-familiar-switch">
        <FamiliarQuickSwitch
          familiars={familiars}
          activeFamiliarId={activeFamiliarId ?? null}
          selectedFamiliarIds={selectedFamiliarIds}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onFamiliarScopeChange}
          placement="bottom-start"
          labeled
        />
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
            // Active follows the primary mode (Roles/Capabilities keep the
            // Marketplace hub lit); pages open as split tiles get a lighter
            // "open in split" state instead. Derivation in lib/sidebar-nav-state.
            state={sidebarRowState(fm.id, mode, props.splitPageModes, { grimoireView: props.grimoireView })}
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

        {/* Role Surface rooms — the active familiar's vocation workspaces.
            Registry-driven: the sidebar renders whatever it's handed and never
            names a role. The cluster label keeps them reading as chambers of
            the Cave rather than more app tabs. */}
        {(props.roleSurfaces?.length ?? 0) > 0 && (
          <>
            <div className="sidebar-rooms-label" aria-hidden>
              Rooms
            </div>
            {props.roleSurfaces!.map((room) => (
              <FolderRow
                key={room.mode}
                id={room.mode}
                label={room.label}
                iconName={room.iconName}
                state={sidebarRowState(room.mode, mode, props.splitPageModes)}
                description={room.description}
                onClick={() => {
                  onModeChange(room.mode);
                }}
              />
            ))}
          </>
        )}

        <RecentActivityRollup activeSessionId={activeSessionId} onOpenSession={onOpenSession} />
      </div>

      {/* Bottom: Dashboard + Settings, then the version line — shared with the
          chat-thread nav (WorkspaceSidebar) so the footer is identical and
          persists on every surface, including Chat. */}
      <SidebarFooter onOpenSettings={onOpenSettings} />
    </nav>
  );
}

"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Home / Chat section tabs, familiar scope selector, and New chat CTA
 *   2. Grouped app destinations and role-surface rooms
 *   3. Footer: Dashboard, Settings
 */

import React from "react";
import { SidebarRailHeader } from "@/components/sidebar-rail-header";
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
import { NavSectionTabs } from "@/components/nav-section-tabs";
import { SidebarFooter } from "@/components/sidebar-footer";
import {
  DEFAULT_NAV_SECTION,
  navItemsForSection,
  roomBelongsToSection,
  type NavSection,
} from "@/lib/nav-section";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import {
  type WorkspaceNavItem,
  type WorkspaceNavMode,
} from "@/lib/workspace-navigation";
export type SidebarRoleSurfaceRow = {
  /** Generic workspace mode string (`surface:<id>`) — the sidebar never
   *  interprets it, only round-trips it through navigation callbacks. */
  mode: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  description: string;
  /** In All/multi scope, selecting a room first narrows to this owner so the
   *  host can provide its familiar-bound context. */
  familiarId?: string;
};

export type SidebarMinimalProps = {
  mode: string;
  /** Active global section (Home | Chat). The shell owns it so deep links and
   *  the ⌘K palette can move rooms; omitted falls back to Home. */
  section?: NavSection;
  onSectionChange?: (section: NavSection) => void;
  /** Page modes currently open as secondary split tiles (drag-to-split).
   *  Their rows get a lighter "open in split" wash instead of the active fill,
   *  so the highlight stays honest when a page renders beside the primary. */
  splitPageModes?: readonly string[];
  /** Role Surface rooms visible for the active scope. Registry-driven —
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
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean; preserveSurface?: boolean }) => void;
  responseNeeded?: Set<string>;
  notificationBadgeCount?: number;
  onOpenInbox?: () => void;
  onNotificationPrefsChanged?: () => void;
  /** Live counts surfaced as small nav badges (omitted/0 -> no badge). */
  boardOpenCount?: number;
  scheduleNeedsCount?: number;
};

// Format a count as a compact nav badge; 0/undefined yields no badge.
function badgeText(n?: number): string | undefined {
  if (!n || n <= 0) return undefined;
  return n > 99 ? "99+" : String(n);
}

const MODE_BADGES: Partial<Record<WorkspaceNavMode, (props: SidebarMinimalProps) => string | undefined>> = {
  board: (props) => badgeText(props.boardOpenCount),
  inbox: (props) => badgeText(props.scheduleNeedsCount),
};


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
    section = DEFAULT_NAV_SECTION,
    onSectionChange,
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
  const handleModeSelect = (id: WorkspaceNavMode) => {
    onModeChange(id);
  };
  // Rooms are registry-driven; each one shows in the section its mode maps to.
  const sectionRooms = React.useMemo(
    () => (props.roleSurfaces ?? []).filter((room) => roomBelongsToSection(room.mode, section)),
    [props.roleSurfaces, section],
  );

  return (
    <nav className="sidebar-minimal" aria-label="Primary">
      {/* No rail-only brand mark here any more (it was chat-revamp phase D
          chrome, decorative and aria-hidden). The expanded panel never had a
          counterpart for it, so in the 56px rail it pushed every control below
          it ~32px out of line with its own hover-peek position — see #4351 and
          the retirement note in styles/sidebar-minimal/activity-rail.css. */}
      {/* Static wordmark. Collapsing the sidebar is now owned by the shell's
          floating top-left toggle (and ⌘B), so the header is no longer a
          button — it just leaves room for the float. */}
      {onSectionChange ? <NavSectionTabs section={section} onSectionChange={onSectionChange} /> : null}

      {/* Familiar scope + New chat (cave-vtk9) — SHARED with the Chat section
          via SidebarRailHeader, so the two controls cannot drift apart across
          the Home/Chat toggle the way the forked copies did. The collapsed rail
          keeps the avatar-only trigger; the mobile top bar keeps its own
          switcher (the drawer hides this one). */}
      <SidebarRailHeader
        familiars={familiars}
        activeFamiliarId={activeFamiliarId ?? null}
        selectedFamiliarIds={selectedFamiliarIds}
        sessions={sessions}
        responseNeeded={responseNeeded}
        onSelectFamiliar={onFamiliarScopeChange}
        onNewChat={onNewChat}
      />

      <div
        className="sidebar-nav-scroll"
        ref={navScrollRef}
        role="tabpanel"
        id={`nav-section-panel-${section}`}
        aria-labelledby={`nav-section-tab-${section}`}
      >
          {navItemsForSection(section).map((fm: WorkspaceNavItem, i, rows) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              // Active follows the primary mode (Roles/Capabilities keep the
              // Marketplace hub lit); pages open as split tiles get a lighter
              // "open in split" state instead. Derivation in lib/sidebar-nav-state.
              state={sidebarRowState(fm.id, mode, props.splitPageModes)}
              badge={MODE_BADGES[fm.id]?.(props)}
              kbd={fm.kbd}
              description={fm.description}
              quiet={fm.quiet}
              // Index the RENDERED list — a navHidden entry between quiet rows
              // must not throw off the "first quiet row" gap.
              quietLead={Boolean(fm.quiet) && !rows[i - 1]?.quiet}
              onClick={() => handleModeSelect(fm.id)}
            />
          ))}
          {/* Role Surface rooms — the active familiar's or selected scope's
            vocation workspaces, filtered to the open section (the coding
            workbench belongs to Code; every other room to Home).
            Registry-driven: the sidebar renders whatever it's handed and never
            names a role. The cluster label keeps them reading as chambers of
            the Cave rather than more app tabs. */}
          {sectionRooms.length > 0 && (
            <>
              <div className="sidebar-rooms-label" aria-hidden>
                Rooms
              </div>
              {sectionRooms.map((room) => (
                <FolderRow
                  key={room.mode}
                  id={room.mode}
                  label={room.label}
                  iconName={room.iconName}
                  state={sidebarRowState(room.mode, mode, props.splitPageModes)}
                  description={room.description}
                  onClick={() => {
                    if (room.familiarId && room.familiarId !== activeFamiliarId) {
                      onFamiliarScopeChange(room.familiarId, { preserveSurface: true });
                    }
                    onModeChange(room.mode);
                  }}
                />
              ))}
            </>
          )}

          {/* The session list belongs to the Code room (cave-24d2r) — Home is
            destinations, Code is live work. */}
          {section === "code" ? (
            <RecentActivityRollup
              sessions={sessions}
              selectedFamiliarIds={selectedFamiliarIds}
              activeSessionId={activeSessionId}
              onOpenSession={onOpenSession}
            />
          ) : null}
      </div>

      {/* Bottom: Dashboard + Settings, then the version line — shared with the
          WorkspaceSidebar that replaces this host during Chat, and the last
          thing in the rail as well as in the panel. The rail-only account
          avatar that used to close the column is gone: its onClick was
          onOpenSettings, i.e. the same action as the Settings button directly
          above it, and being rail-only it left the footer sitting at a
          different height than its own hover-peek form (#4351). */}
      <SidebarFooter onOpenSettings={onOpenSettings} />
    </nav>
  );
}

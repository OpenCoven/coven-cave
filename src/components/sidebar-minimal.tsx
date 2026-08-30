"use client";

/**
 * SidebarMinimal -- the one Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Familiar scope selector and New chat CTA
 *   2. Navigation  — the daily destinations, Chat directly under Home
 *   3. Explore     — the registry's `quiet` destinations (Marketplace, Memories)
 *   4. Rooms       — registry-driven role surfaces
 *   5. Footer: Dashboard, Settings
 *
 * Sections 2-4 are titled groups, not collapsible — the spacing above each
 * heading is what separates them. The one collapsible thing on the chat screen
 * is the threads rail, which is a whole column rather than a short list.
 *
 * There is deliberately NO chat list here. The full thread list is docked in
 * the chat surface beside the conversation; carrying even a recent rollup here
 * as well put three chat lists on screen at once.
 *
 * There is no longer a Home/Chat section toggle. It duplicated the Home row
 * directly beneath it — both rendered active at once — and because it swapped
 * this component for the chat rail wholesale, the chat list was reachable only
 * from the Code room and every non-coding room only from Home (cave-fh9so).
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
import { SidebarFooter } from "@/components/sidebar-footer";
import { SidebarSection } from "@/components/sidebar-section";
import { sidebarDestinations } from "@/lib/workspace-destination-policy";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";
import { type WorkspaceNavMode } from "@/lib/workspace-navigation";
import type { CaveProject } from "@/lib/cave-projects-types";
import type { CreateProjectOptions } from "@/lib/chat-add-project";
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
  // ── Project / workspace context (Task 6) ──────────────────────────────────
  projects: CaveProject[];
  projectId: string | null;
  project: CaveProject | null;
  projectLoading: boolean;
  projectError: string | null;
  reloadProjects: () => void;
  onProjectChange: (projectId: string | null) => void;
  createProjectOrThrow?: (
    name: string,
    root: string,
    options?: CreateProjectOptions,
  ) => Promise<CaveProject>;
  projectCrew: ResolvedFamiliar[];
  projectCrewLoading: boolean;
  projectCrewError: string | null;
  reloadProjectCrew: () => void;
  contextNotice: string | null;
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
    onNewChat,
    onOpenSettings,
    onModeChange,
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
  // Every registered room shows. They used to be filtered to the open section,
  // which hid the coding workbench from Home and every other room from Chat.
  const rooms = props.roleSurfaces ?? [];

  // Split on the registry's own `quiet` flag rather than naming destinations
  // here: whatever the policy marks quiet belongs in Explore, so adding one
  // later needs no change in this component.
  const allDestinations = sidebarDestinations();
  const primaryDestinations = allDestinations.filter((entry) => entry.nav !== "quiet");
  const exploreDestinations = allDestinations.filter((entry) => entry.nav === "quiet");

  // One row shape for both sections. `quiet`/`quietLead` are gone: the heading
  // now does what the visual step used to, and keeping both would indent the
  // Explore rows away from their own title.
  const renderDestination = (destination: (typeof allDestinations)[number]) => (
    <FolderRow
      key={destination.id}
      id={destination.id}
      label={destination.title}
      iconName={destination.iconName}
      // Active follows the primary mode (Roles/Capabilities keep the
      // Marketplace hub lit); pages open as split tiles get a lighter
      // "open in split" state instead. Derivation in lib/sidebar-nav-state.
      state={sidebarRowState(destination.id, mode, props.splitPageModes)}
      badge={MODE_BADGES[destination.id]?.(props)}
      kbd={destination.kbd}
      description={destination.description}
      onClick={() => handleModeSelect(destination.id)}
    />
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
      {/* New chat and the compact scope selector remain in the desktop rail;
          mobile drawers keep the full stacked project/familiar controls. */}
      <SidebarRailHeader
        familiars={familiars}
        activeFamiliarId={activeFamiliarId ?? null}
        selectedFamiliarIds={selectedFamiliarIds}
        sessions={sessions}
        responseNeeded={responseNeeded}
        onSelectFamiliar={onFamiliarScopeChange}
        onNewChat={onNewChat}
        // The ⌘N hint used to ride the chat sidebar's own rail header. That
        // header is gone with the swap (cave-fh9so), and the shortcut is not —
        // so it moves onto the one rail that is now always mounted, rather
        // than disappearing with the component that happened to host it.
        newChatTitle="New chat (⌘N)"
        newChatTrailing={<kbd className="rail-header__new-kbd">⌘N</kbd>}
        projects={props.projects}
        projectId={props.projectId}
        project={props.project}
        projectLoading={props.projectLoading}
        projectError={props.projectError}
        reloadProjects={props.reloadProjects}
        onProjectChange={props.onProjectChange}
        createProjectOrThrow={props.createProjectOrThrow}
        projectCrew={props.projectCrew}
        projectCrewLoading={props.projectCrewLoading}
        projectCrewError={props.projectCrewError}
        reloadProjectCrew={props.reloadProjectCrew}
        contextNotice={props.contextNotice}
        // Mobile only. On desktop the project and familiar pickers live in the
        // title bar (WorkspaceContextSwitcher, #4967) — rendering them here too
        // put the same two controls on screen twice, one above the other. Below
        // 1024px the title bar context is display:none, so the rail keeps its
        // own copy and nothing is lost there.
        contextMode="mobile"
      />

      <div className="sidebar-nav-scroll" ref={navScrollRef}>
          <SidebarSection id="navigation" label="Navigation">
            {primaryDestinations.map((destination) => renderDestination(destination))}
          </SidebarSection>

          {/* Marketplace and Memories are their own category rather than a
            silent gap at the end of Navigation. They were already marked
            `quiet` in the registry — the visual step that separated them was
            carrying the meaning a heading should carry, and a step with no
            label leaves the reader to infer why the list pauses. */}
          <SidebarSection
            id="explore"
            label="Explore"
            hideWhenEmpty
            isEmpty={exploreDestinations.length === 0}
          >
            {exploreDestinations.map((destination) => renderDestination(destination))}
          </SidebarSection>

          {/* Role Surface rooms — the active familiar's or selected scope's
            vocation workspaces. Registry-driven: the sidebar renders whatever
            it's handed and never names a role. The cluster keeps them reading
            as chambers of the Cave rather than more app tabs. */}
          <SidebarSection
            id="rooms"
            label="Rooms"
            count={rooms.length}
            hideWhenEmpty
            isEmpty={rooms.length === 0}
          >
            {rooms.map((room) => (
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
          </SidebarSection>

          {/* No chat list here at all (cave-fh9so). It lives beside the
            conversation, docked in the chat surface, the way the Coding Desk
            docks review beside the source. Even the lightweight recent rollup
            is gone: with the surface rail in place it was a third list on
            screen at once, and the sidebar's job is navigation. */}
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

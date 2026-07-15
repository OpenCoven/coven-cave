"use client";

import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { useKeySymbols } from "@/lib/platform-keys";
import type { Familiar, SessionRow } from "@/lib/types";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  onOpenPalette: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  onOpenMobileHandoff: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
  /** Active-familiar profile switcher. When `onSelectFamiliar` and at least one
   *  `familiarOptions` entry are provided, the top bar renders an account-style
   *  profile button that previews the active familiar and opens the switcher
   *  menu (switch scope incl. "All", edit profile, create, manage, reorder).
   *  `null` from `onSelectFamiliar` scopes to all familiars. */
  activeFamiliar?: ResolvedFamiliar | null;
  familiarOptions?: ResolvedFamiliar[];
  onSelectFamiliar?: (id: string | null) => void;
  /** Mobile quick actions folded in from the desktop menu bar: enrich tasks
   *  and jump to the task board. The top bar is the
   *  one mobile bar (it's `display:none` on desktop, where the dedicated
   *  `FamiliarMenuBar` carries these), so these render only on mobile. Omit
   *  either handler to hide that button. */
  onEnrichTasks?: () => void;
  /** Reveal the in-app quick-chat popover (anchored under the top bar). When
   *  provided, the top bar renders a chat icon button that toggles it open. */
  onOpenQuickChat?: () => void;
  enrichingTasks?: boolean;
  enrichProgress?: { done: number; total: number } | null;
  onViewTasks?: () => void;
  /** Open task count (board cards not yet done) — drives the Tasks badge. */
  taskCount?: number;
  /** Live session rows + reply-needed set drive the menu's presence dots and
   *  reply badges (and the unread dot on the collapsed profile button). */
  sessions?: SessionRow[];
  responseNeeded?: Set<string>;
  familiarSwitcherLabeled?: boolean;
  /** Mobile-only drawer toggles. Visibility is gated by CSS at <768px
   *  (.top-bar__mobile-toggle is `display: none` on desktop). Omit any
   *  that aren't applicable to the current surface — e.g. two-pane modes
   *  with no list panel should pass `onToggleList={undefined}`. */
  onToggleNav?: () => void;
  onToggleList?: () => void;
  navDrawerOpen?: boolean;
  listDrawerOpen?: boolean;
};

const ENRICH_TASKS_TITLE =
  "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats";

export function TopBar(props: Props) {
  const keys = useKeySymbols();
  const {
    onOpenPalette,
    searchQuery,
    onSearchQueryChange,
    onOpenInbox,
    onOpenSettings,
    onOpenMobileHandoff,
    inboxItems,
    familiars,
    inboxPrefs,
    inboxBadgeCount,
    onOpenInboxItem,
    onNotificationPrefsChanged,
    onToggleNav,
    onToggleList,
    navDrawerOpen,
    listDrawerOpen,
    activeFamiliar,
    familiarOptions,
    onSelectFamiliar,
    onEnrichTasks,
    onOpenQuickChat,
    enrichingTasks,
    enrichProgress,
    onViewTasks,
    taskCount,
    sessions,
    responseNeeded,
    familiarSwitcherLabeled,
  } = props;

  // Show the switcher whenever there are familiars to pick and a selection
  // handler is wired (the menu offers "All", so it's reachable even before a
  // familiar is the global-active one — e.g. the Home surface).
  const showFamiliarSwitcher = Boolean(onSelectFamiliar && (familiarOptions?.length ?? 0) > 0);
  const enrichLabel = enrichingTasks
    ? enrichProgress
      ? `${enrichProgress.done}/${enrichProgress.total}`
      : "Starting..."
    : "Enhance tasks";

  return (
    <header className="top-bar">
      {/* Left cell: mobile drawer toggles; empty on desktop so the grid
          keeps the search bar centered. */}
      <div className="top-bar__lead">
        {onToggleNav ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleNav}
            aria-label={navDrawerOpen ? "Close navigation" : "Open navigation (⌘B)"}
            aria-expanded={Boolean(navDrawerOpen)}
            aria-controls="nav"
            title={navDrawerOpen ? "Close navigation" : "Open navigation"}
          >
            <Icon name="ph:sidebar-simple" width={CAVE_ICON_SIZE.headerToggle} height={CAVE_ICON_SIZE.headerToggle} />
          </button>
        ) : null}
        {onToggleList ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleList}
            aria-label={listDrawerOpen ? "Close list" : "Open list (⌘\\)"}
            aria-expanded={Boolean(listDrawerOpen)}
            aria-pressed={Boolean(listDrawerOpen)}
            aria-controls="list"
            title={listDrawerOpen ? "Close list" : "Open list"}
          >
            <Icon name="ph:list-checks-bold" width={CAVE_ICON_SIZE.headerToggle} height={CAVE_ICON_SIZE.headerToggle} />
          </button>
        ) : null}
      </div>

      <form
        className="top-bar__search"
        role="search"
        // Open the palette on an explicit click (or Enter via onSubmit), NOT on
        // focus. The palette restores focus to this input when it closes, so
        // opening on focus would immediately reopen it — making Escape and
        // click-off impossible to escape.
        onClick={onOpenPalette}
        onSubmit={(e) => {
          e.preventDefault();
          onOpenPalette();
        }}
      >
        <Icon name="ph:magnifying-glass" width={CAVE_ICON_SIZE.headerSearch} height={CAVE_ICON_SIZE.headerSearch} className="top-bar__search-icon" />
        <input
          type="search"
          className="top-bar__search-input"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search or ask Salem..."
          aria-label="Search anything or ask Salem, the docs familiar"
          title="Search everything — or ask Salem, the familiar trained on the OpenCoven docs"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>{keys.mod}K</kbd>
      </form>

      <div className="top-bar__actions">
        {showFamiliarSwitcher && onSelectFamiliar ? (
          <FamiliarQuickSwitch
            familiars={familiarOptions ?? []}
            activeFamiliarId={activeFamiliar?.id ?? null}
            sessions={sessions ?? []}
            responseNeeded={responseNeeded}
            onSelectFamiliar={onSelectFamiliar}
            placement="bottom-end"
            labeled={familiarSwitcherLabeled}
          />
        ) : null}
        {onOpenQuickChat ? (
          <button
            type="button"
            className="top-bar__icon-btn"
            data-quick-chat-trigger
            onClick={onOpenQuickChat}
            aria-label="Quick chat"
            title="Quick chat (⌘J)"
          >
            <Icon name="ph:chat-circle-dots" width={CAVE_ICON_SIZE.headerAction} height={CAVE_ICON_SIZE.headerAction} />
          </button>
        ) : null}
        {/* Chrome budget (design language §8): the task quick actions moved to
            the overflow menu — occasional verbs don't earn always-visible
            chrome. The open-task badge stays on the trigger so the live count
            survives the relocation. */}
        {onEnrichTasks || onViewTasks ? (
          <span className="top-bar__tasks">
            <OverflowMenu ariaLabel="More actions" size="md" placement="bottom-end">
              {onEnrichTasks ? (
                <PopoverItem
                  icon="ph:sparkle"
                  disabled={enrichingTasks || !activeFamiliar}
                  onSelect={onEnrichTasks}
                  title={activeFamiliar ? ENRICH_TASKS_TITLE : "Select a familiar to enhance tasks"}
                >
                  {activeFamiliar ? enrichLabel : "Select a familiar to enhance tasks"}
                </PopoverItem>
              ) : null}
              {onViewTasks ? (
                <PopoverItem icon="ph:kanban" onSelect={onViewTasks}>
                  {taskCount && taskCount > 0
                    ? `View tasks — ${taskCount > 99 ? "99+" : taskCount} open`
                    : "View tasks"}
                </PopoverItem>
              ) : null}
            </OverflowMenu>
            {taskCount && taskCount > 0 ? (
              <span className="top-bar__tasks-badge" aria-hidden="true">
                {taskCount > 9 ? "9+" : taskCount}
              </span>
            ) : null}
          </span>
        ) : null}
        <button
          type="button"
          className="top-bar__icon-btn top-bar__mobile-handoff"
          onClick={onOpenMobileHandoff}
          aria-label="Open on phone"
          title="Open on phone"
        >
          <Icon name="ph:device-mobile" width={CAVE_ICON_SIZE.headerAction} height={CAVE_ICON_SIZE.headerAction} />
        </button>
        <NotificationBell
          items={inboxItems}
          familiars={familiars}
          prefs={inboxPrefs}
          badgeCount={inboxBadgeCount}
          onOpenInbox={onOpenInbox}
          onOpenItem={onOpenInboxItem}
          onPrefsChanged={onNotificationPrefsChanged}
        />
        <button
          type="button"
          className="top-bar__account"
          onClick={onOpenSettings}
          aria-label="Account / settings"
          title="Settings (⌘,)"
        >
          <Icon name="ph:user" width={CAVE_ICON_SIZE.headerAction} height={CAVE_ICON_SIZE.headerAction} />
        </button>
      </div>
    </header>
  );
}

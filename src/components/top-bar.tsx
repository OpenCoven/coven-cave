"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
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
  onToggleFamiliar?: () => void;
  navDrawerOpen?: boolean;
  listDrawerOpen?: boolean;
  familiarDrawerOpen?: boolean;
};

export function TopBar(props: Props) {
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
    onToggleFamiliar,
    navDrawerOpen,
    listDrawerOpen,
    familiarDrawerOpen,
    activeFamiliar,
    familiarOptions,
    onSelectFamiliar,
    sessions,
    responseNeeded,
    familiarSwitcherLabeled,
  } = props;

  // Show the switcher whenever there are familiars to pick and a selection
  // handler is wired (the menu offers "All", so it's reachable even before a
  // familiar is the global-active one — e.g. the Home surface).
  const showFamiliarSwitcher = Boolean(onSelectFamiliar && (familiarOptions?.length ?? 0) > 0);

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
            <Icon name="ph:sidebar-simple" width={18} />
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
            <Icon name="ph:list-checks-bold" width={18} />
          </button>
        ) : null}
      </div>

      <form
        className="top-bar__search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onOpenPalette();
        }}
      >
        <Icon name="ph:magnifying-glass" width={12} className="top-bar__search-icon" />
        <input
          type="search"
          className="top-bar__search-input"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onFocus={onOpenPalette}
          placeholder="Search or ask Salem..."
          aria-label="Search anything or ask Salem"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>⌘K</kbd>
      </form>

      <div className="top-bar__actions">
        {showFamiliarSwitcher && onSelectFamiliar ? (
          <FamiliarSwitcher
            familiars={familiarOptions ?? []}
            activeFamiliarId={activeFamiliar?.id ?? null}
            sessions={sessions ?? []}
            responseNeeded={responseNeeded}
            onSelectFamiliar={onSelectFamiliar}
            placement="bottom-end"
            labeled={familiarSwitcherLabeled}
          />
        ) : null}
        <button
          type="button"
          className="top-bar__icon-btn top-bar__mobile-handoff"
          onClick={onOpenMobileHandoff}
          aria-label="Open on phone"
          title="Open on phone"
        >
          <Icon name="ph:device-mobile" width={14} />
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
          <Icon name="ph:user" width={13} />
        </button>
        {onToggleFamiliar ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleFamiliar}
            aria-label={familiarDrawerOpen ? "Close familiar panel" : "Open familiar panel (⌘⇧B)"}
            aria-expanded={Boolean(familiarDrawerOpen)}
            aria-pressed={Boolean(familiarDrawerOpen)}
            aria-controls="agent"
            title={familiarDrawerOpen ? "Close familiar panel" : "Open familiar panel"}
          >
            <Icon name="ph:cat" width={18} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

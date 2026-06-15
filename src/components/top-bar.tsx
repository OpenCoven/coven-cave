"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  onOpenMobileHandoff: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
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
  } = props;

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

      <button
        type="button"
        className="top-bar__search"
        onClick={onOpenPalette}
        aria-label="Search and jump to anything"
      >
        <Icon name="ph:magnifying-glass" width={12} />
        <span>Jump to anything…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-bar__actions">
        <button
          type="button"
          className="top-bar__icon-btn top-bar__mobile-handoff"
          onClick={onOpenMobileHandoff}
          aria-label="Open on phone"
          title="Open on phone"
        >
          <Icon name="ph:phone" width={14} />
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
            aria-label={familiarDrawerOpen ? "Close familiar panel" : "Open familiar panel (⌘J)"}
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

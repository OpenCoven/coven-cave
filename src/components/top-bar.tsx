"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  surfaceLabel: string;
  subContext?: string;
  onOpenHome: () => void;
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
  onToggleAgent?: () => void;
};

export function TopBar(props: Props) {
  const {
    surfaceLabel,
    subContext,
    onOpenHome,
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
    onToggleAgent,
  } = props;

  return (
    <header className="top-bar">
      {onToggleNav ? (
        <button
          type="button"
          className="top-bar__mobile-toggle"
          onClick={onToggleNav}
          aria-label="Open navigation (⌘B)"
          title="Open navigation"
        >
          <Icon name="ph:sidebar-simple" width={18} />
        </button>
      ) : null}
      <span className="top-bar__brand">CovenCave</span>
      <button type="button" className="top-bar__home-btn" onClick={onOpenHome}>
        Home
      </button>
      {onToggleList ? (
        <button
          type="button"
          className="top-bar__mobile-toggle"
          onClick={onToggleList}
          aria-label="Open list (⌘\\)"
          title="Open list"
        >
          <Icon name="ph:list-checks-bold" width={18} />
        </button>
      ) : null}
      {surfaceLabel ? (
        <span className="top-bar__crumb">
          <span className="top-bar__crumb-sep" aria-hidden="true">›</span>
          <span className="top-bar__crumb-surface">{surfaceLabel}</span>
          {subContext ? (
            <>
              <span className="top-bar__crumb-sep" aria-hidden="true">›</span>
              <span className="top-bar__crumb-sub">{subContext}</span>
            </>
          ) : null}
        </span>
      ) : null}

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
          className="top-bar__icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings (⌘,)"
        >
          <Icon name="ph:gear-six" width={14} />
        </button>
        {onToggleAgent ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleAgent}
            aria-label="Open agent panel (⌘J)"
            title="Open agent panel"
          >
            <Icon name="ph:cat" width={18} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

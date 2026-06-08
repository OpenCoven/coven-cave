"use client";

import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import type { Familiar } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  surfaceLabel: string;
  subContext?: string;
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
};

export function TopBar(props: Props) {
  const {
    surfaceLabel,
    subContext,
    onOpenPalette,
    onOpenInbox,
    onOpenSettings,
    inboxItems,
    familiars,
    inboxPrefs,
    inboxBadgeCount,
    onOpenInboxItem,
    onNotificationPrefsChanged,
  } = props;

  return (
    <header className="top-bar">
      <span className="top-bar__brand">CovenCave</span>
      <span className="top-bar__sep">·</span>
      <span className="top-bar__crumb">
        <span className="top-bar__crumb-surface">{surfaceLabel}</span>
        {subContext ? (
          <>
            <span className="top-bar__crumb-sep">›</span>
            <span className="top-bar__crumb-sub">{subContext}</span>
          </>
        ) : null}
      </span>

      <button
        type="button"
        className="top-bar__search"
        onClick={onOpenPalette}
        aria-label="Search and jump to anything"
      >
        <Icon name="ph:magnifying-glass" width={12} />
        <span>Search · jump to anything</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-bar__actions">
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
      </div>
    </header>
  );
}

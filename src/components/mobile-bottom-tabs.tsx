"use client";

/**
 * MobileBottomTabs — fixed/sticky bottom navigation strip for mobile/tablet
 * viewports. Surfaces the most-used destinations (Home, Chat, Board, Inbox,
 * Library, Delegations) as a tablist with icon + label and an active highlight.
 *
 * Renders only when the parent shell is in mobile mode (≤1023px); Shell is
 * responsible for that conditional render — this component itself doesn't
 * check viewport.
 */

import { Icon, type IconName } from "@/lib/icon";

type TabId = "home" | "chat" | "board" | "inbox" | "library" | "calls";

type TabDef = {
  id: TabId;
  label: string;
  ariaLabel: string;
  iconName: IconName;
};

const TABS: TabDef[] = [
  { id: "home", label: "Home", ariaLabel: "Home", iconName: "ph:house-bold" },
  { id: "chat", label: "Chat", ariaLabel: "Chat", iconName: "ph:chats" },
  { id: "board", label: "Board", ariaLabel: "Board", iconName: "ph:kanban" },
  { id: "inbox", label: "Inbox", ariaLabel: "Inbox and automations", iconName: "ph:tray" },
  { id: "library", label: "Library", ariaLabel: "Library", iconName: "ph:books" },
  // Short visible label ("keep labels short" — see the Inbox/Automations split):
  // "Delegations" truncates to "Delegati…" in a 6-tab bar, so use the surface's
  // own header name ("Coven Calls"); the accessible name stays "Delegations" to
  // match the sidebar Tools entry (mode "calls").
  { id: "calls", label: "Calls", ariaLabel: "Delegations", iconName: "ph:graph" },
];

export type MobileBottomTabsProps = {
  mode: string;
  onSelect: (id: string) => void;
  inboxBadgeCount?: number;
};

export function MobileBottomTabs({
  mode,
  onSelect,
  inboxBadgeCount = 0,
}: MobileBottomTabsProps) {
  return (
    <nav
      className="mobile-bottom-tabs"
      role="tablist"
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const active = mode === tab.id;
        const showBadge = tab.id === "inbox" && inboxBadgeCount > 0;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            aria-label={showBadge ? `${tab.ariaLabel}, ${inboxBadgeCount} unread` : tab.ariaLabel}
            className={
              "mobile-bottom-tab" +
              (active ? " mobile-bottom-tab--active" : "")
            }
            onClick={() => onSelect(tab.id)}
          >
            <span className="mobile-bottom-tab__icon-wrap" aria-hidden>
              <Icon name={tab.iconName} width={20} />
              {showBadge ? (
                <span className="mobile-bottom-tab__badge" aria-hidden>
                  {inboxBadgeCount > 99 ? "99+" : inboxBadgeCount}
                </span>
              ) : null}
            </span>
            <span className="mobile-bottom-tab__label">{tab.label}</span>
            <span className="mobile-bottom-tab__indicator" aria-hidden />
            {showBadge ? (
              <span className="sr-only">
                {inboxBadgeCount} unread
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

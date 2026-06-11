"use client";

/**
 * MobileBottomTabs — fixed/sticky bottom navigation strip for mobile/tablet
 * viewports. Surfaces the five most-used destinations (Home, Chat, Board,
 * Automations, Library) as a tablist with icon + label and an active highlight.
 *
 * Renders only when the parent shell is in mobile mode (≤1023px); Shell is
 * responsible for that conditional render — this component itself doesn't
 * check viewport.
 */

import { Icon, type IconName } from "@/lib/icon";

type TabId = "home" | "chat" | "board" | "inbox" | "library";

type TabDef = {
  id: TabId;
  label: string;
  iconName: IconName;
};

const TABS: TabDef[] = [
  { id: "home", label: "Home", iconName: "ph:house-bold" },
  { id: "chat", label: "Chat", iconName: "ph:chats" },
  { id: "board", label: "Board", iconName: "ph:kanban" },
  { id: "inbox", label: "Automations", iconName: "ph:tray" },
  { id: "library", label: "Library", iconName: "ph:books" },
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

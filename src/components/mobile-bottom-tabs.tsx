"use client";

/**
 * MobileBottomTabs — fixed/sticky bottom navigation strip for mobile/tablet
 * viewports. Surfaces the desktop sidebar's primary cluster (the non-quiet,
 * non-hidden FOLDER_MODES rows — Home, Chat, Tasks, Rituals) as a tablist
 * with icon + label and an active highlight. Tabs are DERIVED from
 * FOLDER_MODES rather than hand-copied so desktop and mobile present the
 * same conceptual hierarchy by construction (issue #3283 — one surface, one
 * name; the quiet cluster and footer stay reachable via the nav drawer,
 * which hosts the full sidebar).
 *
 * Renders only when the parent shell is in mobile mode (≤1023px); Shell is
 * responsible for that conditional render — this component itself doesn't
 * check viewport.
 */

import { Icon } from "@/lib/icon";
import { FOLDER_MODES } from "@/components/sidebar-minimal";

// Primary daily destinations: exactly the rows the desktop sidebar promotes
// (quiet rows live in the drawer's full sidebar; navHidden are on-demand).
const TABS = FOLDER_MODES.filter((fm) => !fm.quiet && !fm.navHidden).map(
  (fm) => ({ id: fm.id, label: fm.label, ariaLabel: fm.label, iconName: fm.iconName }),
);

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
              <Icon name={tab.iconName} width={24} height={24} />
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

"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { useSurfaceHistory } from "@/lib/use-surface-history";
import { settingsGroupId } from "@/components/ui/settings-group";
import { tabForScrollTarget } from "@/lib/settings-section-tab-map";

/**
 * Tabbed grouping for a long settings section.
 *
 * Some sections (Appearance, Add-ons) stack many SettingsGroups into one long
 * scroll. This splits them into a few tabs so the common controls are reachable
 * without scrolling, while keeping every group in the source (just gated by the
 * active tab) so the section's search/deep-link behaviour and source-text guards
 * still hold.
 *
 * Search integration: when the shell's `scrollTarget` (a settingsGroupId) points
 * at a group that lives on an inactive tab, we switch to that tab first so the
 * shell's scroll-into-view lands on a mounted element instead of a no-op.
 */

type Props<T extends string> = {
  ariaLabel: string;
  tabs: ReadonlyArray<TabItem<T>>;
  /** group labels (matching their SettingsGroup label) owned by each tab. */
  groupsByTab: Record<T, readonly string[]>;
  /** The shell's active search/deep-link scroll target, if any. */
  scrollTarget?: string | null;
  /** Render the panel for the active tab. */
  children: (tab: T) => ReactNode;
};

export function SettingsTabbed<T extends string>({
  ariaLabel,
  tabs,
  groupsByTab,
  scrollTarget,
  children,
}: Props<T>) {
  // One level per section, so two tabbed sections never share a journal entry.
  const { value: tab, select: selectTab, show: showTab } = useSurfaceHistory<T>({
    id: `settings:tab:${ariaLabel}`,
    initial: tabs[0].id,
  });
  const setTab = showTab;
  // Track whether the user has manually picked a tab, so a stale scrollTarget
  // doesn't yank them away — only an *active* search target switches tabs.
  const lastTarget = useRef<string | null>(null);

  useEffect(() => {
    const current = scrollTarget ?? null;
    if (current === lastTarget.current) return;
    lastTarget.current = current;
    const target = tabForScrollTarget(groupsByTab, current, settingsGroupId);
    if (target) setTab(target);
  }, [scrollTarget, groupsByTab]);

  return (
    <>
      <div className="mb-4">
        <Tabs
          items={tabs}
          value={tab}
          onChange={selectTab}
          ariaLabel={ariaLabel}
          variant="segment"
          size="sm"
        />
      </div>
      {children(tab)}
    </>
  );
}

"use client";

import Link from "next/link";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";

export type SidebarFooterDestination = "dashboard" | "settings" | null;

export function SidebarFooter({
  onOpenSettings,
  activeDestination = null,
}: {
  onOpenSettings: () => void;
  activeDestination?: SidebarFooterDestination;
}) {
  return (
    <div className="sidebar-foot">
      {/* Dashboard is a standalone Next route (/dashboard), not a workspace
          mode — preserve that route while using Next client navigation. */}
      <Link
        className={`sidebar-foot-btn${activeDestination === "dashboard" ? " sidebar-foot-btn--active" : ""}`}
        href="/dashboard"
        aria-label="Dashboard"
        aria-current={activeDestination === "dashboard" ? "page" : undefined}
        title="Dashboard — activity overview and daily reports"
      >
        <span className="sidebar-foot-icon-cell" aria-hidden="true">
          {/* Not ph:squares-four: Canvas uses that glyph, and two rows in one
              sidebar shouldn't share an icon (#5888). */}
          <Icon name="ph:chart-line-up" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
        </span>
        <span className="sidebar-foot-label">Dashboard</span>
      </Link>
      <button
        type="button"
        className={`sidebar-foot-btn${activeDestination === "settings" ? " sidebar-foot-btn--active" : ""}`}
        onClick={onOpenSettings}
        aria-label="Settings"
        aria-current={activeDestination === "settings" ? "page" : undefined}
        title="Settings"
      >
        <span className="sidebar-foot-icon-cell" aria-hidden="true">
          <Icon name="ph:gear-six" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
        </span>
        <span className="sidebar-foot-label">Settings</span>
      </button>
    </div>
  );
}

"use client";

import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { APP_VERSION } from "@/lib/app-version";

/**
 * The left side-panel footer — Dashboard + Settings, then the app-version line.
 *
 * Extracted so it renders identically through whichever primary sidebar host is
 * active: `SidebarMinimal` normally, or `WorkspaceSidebar` while Chat replaces
 * it. This keeps Dashboard / Settings / version available across the host swap.
 * Styles (`.sidebar-foot*`,
 * `.sidebar-version`) live in sidebar-minimal.css, which globals.css imports
 * app-wide, so they apply here regardless of host.
 */
export function SidebarFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <>
      {/* Bottom: Dashboard + Settings */}
      <div className="sidebar-foot">
        {/* Dashboard is a standalone Next route (/dashboard), not a workspace
            mode — navigate with a real link rather than onModeChange. */}
        <a
          className="sidebar-foot-btn"
          href="/dashboard"
          aria-label="Dashboard"
          title="Dashboard — activity overview and daily reports"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:squares-four" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Dashboard</span>
        </a>
        <button
          type="button"
          className="sidebar-foot-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:gear-six" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Settings</span>
        </button>
      </div>

      {/* Bottommost: app version — one minimal-height muted line. */}
      <div className="sidebar-version" title={`CovenCave v${APP_VERSION}`}>
        v{APP_VERSION}
      </div>
    </>
  );
}

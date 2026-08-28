"use client";

import Link from "next/link";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { APP_VERSION } from "@/lib/app-version";

export type SidebarFooterDestination = "dashboard" | "settings" | null;

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
export function SidebarFooter({
  onOpenSettings,
  activeDestination = null,
}: {
  onOpenSettings: () => void;
  activeDestination?: SidebarFooterDestination;
}) {
  return (
    <>
      {/* Bottom: Dashboard + Settings */}
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
            <Icon name="ph:squares-four" width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
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

      {/* Bottommost: app version — one minimal-height muted line, and the
          shortest path to what it's about. "Which version am I on, and is
          there a newer one?" is answered in Settings → About (version,
          updates, project links), so the line links there instead of being
          the one dead label in the footer. A client-side link to the standalone
          /settings route, matching the Dashboard link above; the #about hash
          is the section deep-link the settings shell already honours. */}
      <Link
        className="sidebar-version"
        href="/settings#about"
        title={`CovenCave v${APP_VERSION} — version, updates and project links`}
        aria-label={`CovenCave v${APP_VERSION} — open About in Settings`}
      >
        v{APP_VERSION}
      </Link>
    </>
  );
}

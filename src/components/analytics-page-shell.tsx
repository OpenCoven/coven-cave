"use client";

import type { ReactNode } from "react";
import { Icon, CAVE_ICON_SIZE, type IconName } from "@/lib/icon";
import "@/styles/analytics-page-shell.css";

type RailDest = { href: string; label: string; icon: IconName };

// Mirror the app's primary sidebar destinations (sidebar-minimal FOLDER_MODES)
// as deep links the SPA resolves via `?mode=` (workspace readModeParam). Kept as
// plain <a> links because this shell wraps STANDALONE routes that live outside
// the SPA workspace which owns SidebarMinimal.
const PRIMARY: RailDest[] = [
  { href: "/?mode=home", label: "Home", icon: "ph:house-bold" },
  { href: "/?mode=chat", label: "Chat", icon: "ph:chats" },
  { href: "/?mode=board", label: "Tasks", icon: "ph:kanban" },
  { href: "/?mode=inbox", label: "Schedules", icon: "ph:calendar-check" },
  { href: "/?mode=journal", label: "Journal", icon: "ph:book-open" },
  { href: "/?mode=grimoire", label: "Grimoire", icon: "ph:books" },
  { href: "/?mode=marketplace", label: "Marketplace", icon: "ph:storefront-bold" },
  { href: "/?mode=github", label: "GitHub", icon: "ph:github-logo" },
];

const NAV_ICON = CAVE_ICON_SIZE.sidePanelNav;

/**
 * Standalone-route left side-panel. The familiar-analytics route renders OUTSIDE
 * the SPA workspace (which owns SidebarMinimal), so on its own it has no nav. This
 * shell gives it the app's left rail at EVERY screen size (goal: the left
 * sidepanel on analytics, all screens): a compact, always-visible icon column of
 * the primary destinations (deep-linking back into the SPA) plus Dashboard — so
 * you can navigate away from analytics without a browser Back.
 */
export function AnalyticsPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="aps">
      <nav className="aps-rail" aria-label="Primary">
        <a className="aps-brand" href="/" aria-label="CovenCave home" title="CovenCave">
          <Icon name="ph:sparkle-bold" width={NAV_ICON} height={NAV_ICON} aria-hidden />
        </a>
        <ul className="aps-rail-list">
          {PRIMARY.map((d) => (
            <li key={d.href}>
              <a className="aps-rail-link" href={d.href} aria-label={d.label} title={d.label}>
                <Icon name={d.icon} width={NAV_ICON} height={NAV_ICON} aria-hidden />
              </a>
            </li>
          ))}
        </ul>
        <a className="aps-rail-link aps-rail-foot" href="/dashboard" aria-label="Dashboard" title="Dashboard">
          <Icon name="ph:squares-four" width={NAV_ICON} height={NAV_ICON} aria-hidden />
        </a>
      </nav>
      <main className="aps-main">{children}</main>
    </div>
  );
}

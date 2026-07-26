"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DesktopHistoryNav } from "@/components/desktop-history-nav";
import { Icon, CAVE_ICON_SIZE, type IconName } from "@/lib/icon";
import { useIsMobile } from "@/lib/use-viewport";
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
  { href: "/?mode=inbox", label: "Rituals", icon: "ph:calendar-check" },
  { href: "/?mode=journal", label: "Journal", icon: "ph:book-open" },
  { href: "/?mode=grimoire", label: "Memories", icon: "ph:books" },
  { href: "/?mode=marketplace", label: "Marketplace", icon: "ph:storefront-bold" },
  { href: "/?mode=github", label: "GitHub", icon: "ph:github-logo" },
];

const NAV_ICON = CAVE_ICON_SIZE.sidePanelNav;

/**
 * Standalone-route left side-panel. Destination routes (/dashboard, /weaves,
 * /proposals, /settings, /profile, /daily-report, familiar analytics) render
 * OUTSIDE the SPA workspace (which owns SidebarMinimal), so on their own they
 * have no nav. This shell gives every one of them the app's left rail at EVERY
 * screen size: a compact, always-visible icon column of the primary
 * destinations (deep-linking back into the SPA) plus Dashboard — so you can
 * navigate away without a browser Back. route-inventory.test.ts enforces that
 * every destination page mounts it.
 */
export function AnalyticsPageShell({ children }: { children: ReactNode }) {
  // Only the Dashboard foot link can be "current" — the PRIMARY rows deep-link
  // into the SPA at `/`, which this shell never wraps.
  const pathname = usePathname();
  const onDashboard = pathname === "/dashboard";
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(true);
  // Mobile keeps its persistent rail even if this shell was collapsed before a
  // viewport resize. Its existing navigation remains the mobile fallback.
  const railOpen = navOpen || isMobile;

  const desktopChrome = !isMobile ? (
    <header className="aps-top shell-top" data-tauri-drag-region="deep">
      <div className="shell-titlebar-drag-lane" data-tauri-drag-region="deep" aria-hidden="true" />
      <button
        type="button"
        className={`shell-top-toggle shell-top-toggle--nav focus-ring${navOpen ? " shell-top-toggle--active" : ""}`}
        aria-label={navOpen ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={navOpen}
        title={navOpen ? "Collapse navigation" : "Expand navigation"}
        onClick={() => setNavOpen((open) => !open)}
      >
        <Icon
          name={navOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"}
          width={CAVE_ICON_SIZE.shellToggle}
          height={CAVE_ICON_SIZE.shellToggle}
        />
      </button>
      <DesktopHistoryNav />
    </header>
  ) : null;

  return (
    <div className="aps">
      {desktopChrome}
      <div className="aps-body">
        {railOpen ? (
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
            <a
              className="aps-rail-link aps-rail-foot"
              href="/dashboard"
              aria-label="Dashboard"
              title="Dashboard"
              aria-current={onDashboard ? "page" : undefined}
            >
              <Icon name="ph:squares-four" width={NAV_ICON} height={NAV_ICON} aria-hidden />
            </a>
          </nav>
        ) : null}
        <main className="aps-main">{children}</main>
      </div>
    </div>
  );
}

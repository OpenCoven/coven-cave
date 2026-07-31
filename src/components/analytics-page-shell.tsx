"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { DesktopHistoryNav } from "@/components/desktop-history-nav";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { useIsMobile } from "@/lib/use-viewport";
import { VISIBLE_WORKSPACE_NAV_ITEMS } from "@/lib/workspace-navigation";
import "@/styles/analytics-page-shell.css";

// Shared with shell.tsx so the nav open/closed preference is consistent across
// all routes — standalone pages and the SPA workspace stay in sync.
const NAV_OPEN_PREF_KEY = "cave:shell:nav-open";

function readNavOpenPref(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAV_OPEN_PREF_KEY);
    return raw === "1" ? true : raw === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeNavOpenPref(open: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_OPEN_PREF_KEY, open ? "1" : "0");
  } catch {
    /* ignore — strict privacy mode or storage quota */
  }
}

// Standalone pages use the workspace sidebar's canonical visible destinations
// instead of maintaining a second list that can drift in names or reachability.
const PRIMARY = VISIBLE_WORKSPACE_NAV_ITEMS.map((item) => ({
  href: `/?mode=${item.id}`,
  label: item.label,
  icon: item.iconName,
}));

const NAV_ICON = CAVE_ICON_SIZE.sidePanelNav;

/**
 * Standalone-route left side-panel. Destination routes (/dashboard, /weaves,
 * /proposals, /settings, /profile, /daily-report, familiar analytics) render
 * OUTSIDE the SPA workspace (which owns SidebarMinimal), so on their own they
 * have no nav. This shell gives every one of them the app's left rail at EVERY
 * screen size, matching the main shell's sidebar behavior:
 * - Expanded (navOpen): 240px with icons + labels, synced via NAV_OPEN_PREF_KEY.
 * - Collapsed (!navOpen on desktop): 56px icon-only rail — never fully hidden.
 * - Mobile: always shows the 56px icon rail.
 * route-inventory.test.ts enforces that every destination page mounts it.
 */
export function AnalyticsPageShell({ children }: { children: ReactNode }) {
  // Only the Dashboard foot link can be "current" — the PRIMARY rows deep-link
  // into the SPA at `/`, which this shell never wraps.
  const pathname = usePathname();
  const onDashboard = pathname === "/dashboard";
  const isMobile = useIsMobile();

  // Match the main shell's compact SSR default, then restore the shared desktop
  // preference before paint. CSS keeps mobile compact during viewport hydration.
  const [navOpen, setNavOpen] = useState(false);
  useLayoutEffect(() => {
    const pref = readNavOpenPref();
    if (pref !== null) setNavOpen(pref);
  }, []);

  const handleToggleNav = () => {
    setNavOpen((current) => {
      const next = !current;
      writeNavOpenPref(next);
      return next;
    });
  };

  // On mobile the sidebar is always the 56px icon rail; on desktop it
  // expands/collapses based on preference. The rail is never fully hidden —
  // collapsing only switches from 240px+labels to 56px icons.
  const isExpanded = !isMobile && navOpen;

  const desktopChrome = !isMobile ? (
    <header className="aps-top shell-top" data-tauri-drag-region="deep">
      <div className="shell-titlebar-drag-lane" data-tauri-drag-region="deep" aria-hidden="true" />
      <button
        type="button"
        className={`shell-top-toggle shell-top-toggle--nav focus-ring${navOpen ? " shell-top-toggle--active" : ""}`}
        aria-label={navOpen ? "Collapse navigation" : "Expand navigation"}
        aria-expanded={navOpen}
        title={navOpen ? "Collapse navigation" : "Expand navigation"}
        onClick={handleToggleNav}
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
        {/* The rail is always rendered — collapsing shrinks it to 56px icons,
            never hides it, matching the main shell's collapsed-nav behavior. */}
        <nav
          className={`aps-rail${isExpanded ? " aps-rail--expanded" : ""}`}
          aria-label="Primary"
        >
          <a className="aps-brand" href="/" aria-label="CovenCave home" title="CovenCave">
            <Icon name="ph:sparkle-bold" width={NAV_ICON} height={NAV_ICON} aria-hidden />
            <span className="aps-rail-label aps-brand-label">CovenCave</span>
          </a>
          <ul className="aps-rail-list">
            {PRIMARY.map((d) => (
              <li key={d.href}>
                <a className="aps-rail-link" href={d.href} aria-label={d.label} title={d.label}>
                  <Icon name={d.icon} width={NAV_ICON} height={NAV_ICON} aria-hidden />
                  <span className="aps-rail-label">{d.label}</span>
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
            <span className="aps-rail-label">Dashboard</span>
          </a>
        </nav>
        <main className="aps-main">{children}</main>
      </div>
    </div>
  );
}

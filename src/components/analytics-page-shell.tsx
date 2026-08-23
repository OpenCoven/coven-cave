"use client";

import { useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { NavSectionTabs } from "@/components/nav-section-tabs";
import { Shell, type ShellHandle } from "@/components/shell";
import { SidebarFooter, type SidebarFooterDestination } from "@/components/sidebar-footer";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import {
  DEFAULT_NAV_SECTION,
  navItemsForSection,
  type NavSection,
} from "@/lib/nav-section";
import "@/styles/analytics-page-shell.css";

function activeFooterDestination(pathname: string): SidebarFooterDestination {
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

function destinationTitle(pathname: string): string {
  if (pathname.endsWith("/analytics")) return "Familiar analytics";
  if (pathname.startsWith("/dashboard/familiars/") && pathname.endsWith("/profile")) {
    return "Familiar profile";
  }
  if (pathname === "/dashboard/familiars/growth") return "Familiar growth";
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/weaves")) return "Weaves";
  if (pathname.startsWith("/proposals")) return "Proposals";
  if (pathname.startsWith("/daily-report")) return "Daily report";
  if (pathname.startsWith("/profile")) return "Profile";
  return "Coven";
}

function DestinationSidebar({ pathname }: { pathname: string }) {
  const router = useRouter();
  const [section, setSection] = useState<NavSection>(DEFAULT_NAV_SECTION);
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  useRovingTabIndex({
    containerRef: navScrollRef,
    itemSelector: ".sidebar-folder-row",
    orientation: "vertical",
    itemsVersion: section,
  });

  const rows = navItemsForSection(section);

  return (
    <nav className="sidebar-minimal" aria-label="Primary">
      <NavSectionTabs section={section} onSectionChange={setSection} />
      <div
        className="sidebar-nav-scroll"
        ref={navScrollRef}
        role="tabpanel"
        id={`nav-section-panel-${section}`}
        aria-labelledby={`nav-section-tab-${section}`}
      >
        {rows.map((item, index) => (
          <a
            key={item.id}
            className={`sidebar-folder-row focus-ring${item.quiet ? " sidebar-folder-row--quiet" : ""}${item.quiet && !rows[index - 1]?.quiet ? " sidebar-folder-row--quiet-lead" : ""}`}
            href={`/?mode=${item.id}`}
            title={`${item.label} — ${item.description}${item.kbd ? ` (${item.kbd})` : ""}`}
          >
            <Icon
              name={item.iconName}
              width={CAVE_ICON_SIZE.sidePanelNav}
              height={CAVE_ICON_SIZE.sidePanelNav}
              className="sidebar-folder-icon"
              aria-hidden
            />
            <span className="sidebar-folder-label">{item.label}</span>
          </a>
        ))}
      </div>
      <SidebarFooter
        onOpenSettings={() => router.push("/settings")}
        activeDestination={activeFooterDestination(pathname)}
      />
    </nav>
  );
}

/**
 * Standalone destinations use the exact workspace Shell rather than carrying
 * a parallel approximation of its rail, title bar, inset panel, and mobile
 * behavior. Route pages keep owning their content; this component owns the
 * universal application frame around it.
 */
export function AnalyticsPageShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const shellRef = useRef<ShellHandle>(null);
  const title = destinationTitle(pathname);

  return (
    <Shell
      ref={shellRef}
      nav={<DestinationSidebar pathname={pathname} />}
      detail={children}
      navPolicy="remembered"
      mobileTabs={
        <MobileBottomTabs
          mode=""
          onSelect={(mode) => router.push(`/?mode=${mode}`)}
        />
      }
      topBar={({ navDrawerOpen }) => (
        <header className="top-bar destination-shell__mobile-bar">
          <div className="top-bar__lead">
            <button
              type="button"
              className="top-bar__mobile-toggle focus-ring"
              onClick={() => shellRef.current?.toggleNav()}
              aria-label={navDrawerOpen ? "Close navigation" : "Open navigation"}
              aria-expanded={navDrawerOpen}
              aria-controls="nav"
              title={navDrawerOpen ? "Close navigation" : "Open navigation"}
            >
              <Icon
                name={navDrawerOpen ? "ph:sidebar-simple-fill" : "ph:sidebar-simple"}
                width={CAVE_ICON_SIZE.headerToggle}
                height={CAVE_ICON_SIZE.headerToggle}
                aria-hidden
              />
            </button>
          </div>
          <strong className="destination-shell__mobile-title">{title}</strong>
          <div className="top-bar__actions" aria-hidden />
        </header>
      )}
    />
  );
}

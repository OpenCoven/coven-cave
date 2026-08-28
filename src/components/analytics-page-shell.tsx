"use client";

import { useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { MobileBottomTabs } from "@/components/mobile-bottom-tabs";
import { Shell, type ShellHandle } from "@/components/shell";
import { SidebarFooter, type SidebarFooterDestination } from "@/components/sidebar-footer";
import { SidebarSection } from "@/components/sidebar-section";
import { useRovingTabIndex } from "@/lib/use-roving-tabindex";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { VISIBLE_WORKSPACE_NAV_ITEMS } from "@/lib/workspace-navigation";
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
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  useRovingTabIndex({
    containerRef: navScrollRef,
    itemSelector: ".sidebar-folder-row",
    orientation: "vertical",
  });

  // Same grouping as the workspace rail (cave-fh9so): Navigation, then Explore
  // for the quiet destinations. Settings and Dashboard render through this
  // shell, and a flat list here made them the two pages whose sidebar did not
  // match the rest of the app.
  //
  // The rows stay anchors rather than SidebarMinimal's FolderRow buttons: this
  // shell is a standalone Next route, so a destination is a navigation to
  // `/?mode=…`, not an in-place mode switch. What has to be shared is the
  // structure and the registry, and both are.
  const primaryRows = VISIBLE_WORKSPACE_NAV_ITEMS.filter((item) => !item.quiet);
  const exploreRows = VISIBLE_WORKSPACE_NAV_ITEMS.filter((item) => item.quiet);

  const renderRow = (item: (typeof VISIBLE_WORKSPACE_NAV_ITEMS)[number]) => (
    <a
      key={item.id}
      // No --quiet-lead here. That class drew the unlabelled step that used to
      // separate Explore from Navigation; the heading carries that meaning now,
      // and keeping both would read as a gap inside a titled group.
      className={`sidebar-folder-row focus-ring${item.quiet ? " sidebar-folder-row--quiet" : ""}`}
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
  );

  return (
    <nav className="sidebar-minimal" aria-label="Primary">
      <div className="sidebar-nav-scroll" ref={navScrollRef}>
        <SidebarSection id="navigation" label="Navigation">
          {primaryRows.map(renderRow)}
        </SidebarSection>
        <SidebarSection
          id="explore"
          label="Explore"
          hideWhenEmpty
          isEmpty={exploreRows.length === 0}
        >
          {exploreRows.map(renderRow)}
        </SidebarSection>
        {/* No Rooms section: role surfaces are registered by the workspace and
            there are none to list on a standalone route. SidebarSection's
            hideWhenEmpty is the same reason a heading over nothing is worse
            than no heading. */}
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

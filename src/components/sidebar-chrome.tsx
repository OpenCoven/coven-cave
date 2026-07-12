"use client";

import type { ReactNode } from "react";
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { APP_VERSION } from "@/lib/app-version";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

export type SidebarFamiliarScopeProps = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId?: string | null;
  selectedFamiliarIds?: ReadonlySet<string>;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  onFamiliarScopeChange: (id: string | null, opts?: { multi?: boolean }) => void;
};

/** Open the one global command palette through the same path as Command-K. */
export function openSidebarSearch(): void {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "k",
    metaKey: true,
    bubbles: true,
  }));
}

/** Product identity shared by the navigation and Chat sidepanel hosts. */
export function SidebarBrand() {
  return (
    <div className="sidebar-brand" aria-label="Coven Cave by OpenCoven">
      <span className="sidebar-brand__mark" aria-hidden="true">
        <img src="/icons/favicon-32.png" alt="" width={20} height={20} />
      </span>
      <span className="sidebar-brand__copy">
        <span className="sidebar-brand__name">Coven Cave</span>
        <span className="sidebar-brand__byline">OpenCoven</span>
      </span>
    </div>
  );
}

/** Primary action row mapped to Cave's chat-first workflow. */
export function SidebarPrimaryActions({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="sidebar-primary-actions">
      <button type="button" className="sidebar-primary-action focus-ring" onClick={onNewChat} title="New chat">
        <Icon name="ph:plus-bold" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>New chat</span>
      </button>
      <button
        type="button"
        className="sidebar-search-action focus-ring"
        onClick={openSidebarSearch}
        aria-label="Search"
        title="Search (⌘K)"
      >
        <Icon name="ph:magnifying-glass" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
      </button>
    </div>
  );
}

export function SidebarSectionLabel({ children }: { children: ReactNode }) {
  return <div className="sidebar-section-label">{children}</div>;
}

/** Lower utility group shared by both left-panel hosts. */
export function SidebarUtilityNav({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="sidebar-utility" role="group" aria-label="Sidebar utilities">
      <a className="sidebar-utility-row focus-ring" href="/dashboard" aria-label="Dashboard" title="Dashboard">
        <Icon name="ph:squares-four" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Dashboard</span>
      </a>
      <button
        type="button"
        className="sidebar-utility-row focus-ring"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
      >
        <Icon name="ph:gear-six" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Settings</span>
      </button>
      <button
        type="button"
        className="sidebar-utility-row focus-ring"
        onClick={openSidebarSearch}
        aria-label="Search"
        title="Search (⌘K)"
      >
        <Icon name="ph:magnifying-glass" width={CAVE_ICON_SIZE.sidePanelNav} aria-hidden />
        <span>Search</span>
      </button>
    </div>
  );
}

/** Reference-style identity footer, backed by Cave's existing scope selector. */
export function SidebarIdentityFooter(props: SidebarFamiliarScopeProps) {
  return (
    <footer className="sidebar-identity-footer">
      <div className="sidebar-attribution">Coven Cave v{APP_VERSION}</div>
      <div className="sidebar-identity-control">
        <FamiliarQuickSwitch
          familiars={props.familiars}
          activeFamiliarId={props.activeFamiliarId ?? null}
          selectedFamiliarIds={props.selectedFamiliarIds}
          sessions={props.sessions}
          responseNeeded={props.responseNeeded}
          onSelectFamiliar={props.onFamiliarScopeChange}
          placement="top-start"
          popoverClassName="sidebar-identity-popover"
          labeled
        />
      </div>
    </footer>
  );
}

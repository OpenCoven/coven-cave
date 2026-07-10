"use client";

import type { DragEvent } from "react";
import { Icon, CAVE_ICON_SIZE } from "@/lib/icon";
import { APP_VERSION } from "@/lib/app-version";
import {
  PAGE_DRAG_MIME,
  emitPageDragEnd,
  emitPageDragStart,
} from "@/lib/page-drag";
import {
  workspacePageDefinition,
  type WorkspacePageId,
} from "@/lib/workspace-page-registry";

type DraggablePageDestinationProps = {
  pageId: WorkspacePageId;
  iconName: Parameters<typeof Icon>[0]["name"];
  title?: string;
} & (
  | { href: string; onClick?: never }
  | { href?: never; onClick: () => void }
);

function DraggablePageDestination({
  pageId,
  iconName,
  title,
  ...destination
}: DraggablePageDestinationProps) {
  const definition = workspacePageDefinition(pageId);
  if (!definition) throw new Error(`Missing workspace page definition for ${pageId}`);
  const label = definition.title;
  const handleDragStart = (event: DragEvent<HTMLElement>) => {
    event.dataTransfer.setData(PAGE_DRAG_MIME, pageId);
    event.dataTransfer.setData("text/plain", label);
    event.dataTransfer.effectAllowed = "copy";
    emitPageDragStart({ mode: pageId, label });
  };
  const content = (
    <>
      <span className="sidebar-foot-icon-cell" aria-hidden="true">
        <Icon name={iconName} width={CAVE_ICON_SIZE.sidePanelNav} height={CAVE_ICON_SIZE.sidePanelNav} className="sidebar-foot-icon" />
      </span>
      <span className="sidebar-foot-label">{label}</span>
    </>
  );

  if (destination.href) {
    return (
      <a
        className="sidebar-foot-btn"
        href={destination.href}
        aria-label={label}
        title={title ?? label}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={emitPageDragEnd}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      className="sidebar-foot-btn"
      onClick={destination.onClick}
      aria-label={label}
      title={title ?? label}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={emitPageDragEnd}
    >
      {content}
    </button>
  );
}

/**
 * The left side-panel footer — Dashboard + Settings, then the app-version line.
 *
 * Extracted so it renders identically in BOTH nav hosts: the labeled
 * `SidebarMinimal` (shown on every non-chat surface) and the chat-thread
 * `WorkspaceSidebar` (shown on Chat, which swaps out SidebarMinimal). Without
 * this the footer vanished on chat pages — the one surface where the nav panel
 * is replaced. Styles (`.sidebar-foot*`, `.sidebar-version`) live in
 * sidebar-minimal.css, which globals.css imports app-wide, so they apply here
 * regardless of host.
 */
export function SidebarFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <>
      {/* Bottom: Dashboard + Settings */}
      <div className="sidebar-foot">
        {/* Dashboard is a standalone Next route (/dashboard), not a workspace
            mode — navigate with a real link rather than onModeChange. */}
        <DraggablePageDestination
          pageId="dashboard"
          href="/dashboard"
          iconName="ph:squares-four"
          title="Dashboard — activity overview and daily reports"
        />
        <DraggablePageDestination
          pageId="settings"
          onClick={onOpenSettings}
          iconName="ph:gear-six"
          title="Settings"
        />
      </div>

      {/* Bottommost: app version — one minimal-height muted line. */}
      <div className="sidebar-version" title={`CovenCave v${APP_VERSION}`}>
        v{APP_VERSION}
      </div>
    </>
  );
}

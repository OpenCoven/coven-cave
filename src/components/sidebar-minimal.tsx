"use client";

/**
 * SidebarMinimal -- the redesigned Cave sidebar.
 *
 * Layout (top to bottom):
 *   1. Familiar switcher (full-width) + New chat CTA
 *   2. App destinations grouped by purpose:
 *      Work  (Home / Chat / Board / Calendar / Inbox)
 *      Knowledge (Library)
 *      Tools (Browser / Terminal / Roles / Capabilities / GitHub)
 *   3. Footer: Settings
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import { computePresence, REMOTE_HARNESSES } from "@/lib/presence";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

export type FolderMode =
  | "agents"
  | "home"
  | "chat"
  | "board"
  | "calendar"
  | "inbox"
  | "terminal"
  | "browser"
  | "github"
  | "roles"
  | "library"
  | "capabilities";

export type AddonsConfig = {
  github?: boolean;
  library?: boolean;
};

export type SidebarMinimalProps = {
  mode: string;
  sessions: SessionRow[];
  activeSessionId?: string | null;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onModeChange: (mode: string) => void;
  onOpenSession: (id: string) => void;
  addons?: AddonsConfig;
  /* Notifications — when omitted, the bell is hidden. */
  inboxItems?: InboxItem[];
  inboxPrefs?: InboxPrefs;
  familiars: ResolvedFamiliar[];
  activeFamiliar?: ResolvedFamiliar | null;
  responseNeeded?: Set<string>;
  harnessInstalled?: (harnessId: string) => boolean | undefined;
  notificationBadgeCount?: number;
  onOpenInbox?: () => void;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged?: () => void;
  onSelectFamiliar: (id: string) => void;
  onAddFamiliar: () => void;
};

const FOLDER_MODES: Array<{
  id: FolderMode;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  badge?: (props: SidebarMinimalProps) => string | undefined;
  group: "work" | "knowledge" | "tools" | "addons";
  kbd?: string;
}> = [
  // Work
  { id: "home", label: "Home", iconName: "ph:house-bold", group: "work", kbd: "⌘1" },
  { id: "chat", label: "Chat", iconName: "ph:chats", group: "work", kbd: "⌘2" },
  { id: "board", label: "Board", iconName: "ph:kanban", group: "work", kbd: "⌘3" },
  { id: "calendar", label: "Calendar", iconName: "ph:calendar-blank", group: "work", kbd: "⌘4" },
  { id: "inbox", label: "Inbox", iconName: "ph:tray", group: "work", kbd: "⌘5" },
  // Knowledge
  { id: "library", label: "Library", iconName: "ph:books", group: "knowledge", kbd: "⌘6" },
  // Tools
  { id: "browser", label: "Browser", iconName: "ph:globe", group: "tools", kbd: "⌘7" },
  { id: "terminal", label: "Terminal", iconName: "ph:terminal-window", group: "tools", kbd: "⌘8" },
  { id: "roles", label: "Roles", iconName: "ph:mask-happy", group: "tools" },
  { id: "capabilities", label: "Capabilities", iconName: "ph:lightning-bold", group: "tools" },
  // Add-ons (gated)
  { id: "github", label: "GitHub", iconName: "ph:github-logo", group: "addons" },
];

export { FOLDER_MODES };

function SidebarSection({
  label,
  className = "",
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`sidebar-folders ${className}`.trim()}>
      {label ? <div className="sidebar-section-label">{label}</div> : null}
      {children}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`sidebar-action-row ${active ? "sidebar-action-row--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="sidebar-action-icon">{icon}</span>
      <span className="sidebar-action-label">{label}</span>
      {trailing && <span className="sidebar-action-trailing">{trailing}</span>}
    </button>
  );
}

function FolderRow({
  id,
  label,
  iconName,
  active,
  badge,
  kbd,
  onClick,
}: {
  id: string;
  label: string;
  iconName: Parameters<typeof Icon>[0]["name"];
  active: boolean;
  badge?: string;
  kbd?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-folder-row${active ? " sidebar-folder-row--active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={iconName} width={15} className="sidebar-folder-icon" />
      <span className="sidebar-folder-label">{label}</span>
      {badge && <span className="sidebar-badge">{badge}</span>}
      {kbd && !badge && <kbd className="sidebar-folder-kbd">{kbd}</kbd>}
    </button>
  );
}

function FamiliarSwitcher({
  familiars,
  activeFamiliar,
  sessions,
  responseNeeded,
  harnessInstalled,
  onSelectFamiliar,
  onAddFamiliar,
}: {
  familiars: ResolvedFamiliar[];
  activeFamiliar?: ResolvedFamiliar | null;
  sessions: SessionRow[];
  responseNeeded: Set<string>;
  harnessInstalled?: (harnessId: string) => boolean | undefined;
  onSelectFamiliar: (id: string) => void;
  onAddFamiliar: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activePresence = useMemo(() => {
    if (!activeFamiliar) return null;
    return computePresence({
      familiar: activeFamiliar,
      sessions,
      needsReply: responseNeeded.has(activeFamiliar.id),
      harnessInstalled: activeFamiliar.harness
        ? harnessInstalled?.(activeFamiliar.harness)
        : undefined,
      isRemoteHarness: activeFamiliar.harness
        ? REMOTE_HARNESSES.has(activeFamiliar.harness)
        : false,
    });
  }, [activeFamiliar, sessions, responseNeeded, harnessInstalled]);

  return (
    <div className="sidebar-familiar-switcher" ref={wrapRef}>
      <button
        type="button"
        className={`sidebar-familiar-switcher__trigger${open ? " sidebar-familiar-switcher__trigger--open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open ? "true" : "false"}
        aria-label={
          activeFamiliar
            ? `Active familiar: ${activeFamiliar.display_name}. Switch familiar`
            : "Select a familiar"
        }
        onClick={() => setOpen((o) => !o)}
        style={
          activeFamiliar
            ? ({ "--familiar-accent": activeFamiliar.color } as React.CSSProperties)
            : undefined
        }
      >
        <span className="sidebar-familiar-switcher__avatar" aria-hidden>
          {activeFamiliar ? (
            <FamiliarAvatar familiar={activeFamiliar} size="sm" />
          ) : (
            <Icon name="ph:sparkle" width={14} />
          )}
          {activePresence ? (
            <span
              className={`sidebar-familiar-switcher__presence ${activePresence.dot}`}
              aria-hidden
            />
          ) : null}
        </span>
        <span className="sidebar-familiar-switcher__body">
          <span className="sidebar-familiar-switcher__name">
            {activeFamiliar?.display_name ?? "No familiar selected"}
          </span>
        </span>
        <Icon
          name="ph:caret-down"
          width={12}
          className="sidebar-familiar-switcher__caret"
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Familiars"
          className="sidebar-familiar-switcher__menu"
        >
          {familiars.length === 0 ? (
            <div className="sidebar-familiar-switcher__empty">No familiars yet</div>
          ) : (
            <ul className="sidebar-familiar-switcher__list">
              {familiars.map((f) => {
                const isActive = activeFamiliar?.id === f.id;
                const needsReply = responseNeeded.has(f.id);
                const presence = computePresence({
                  familiar: f,
                  sessions,
                  needsReply,
                  harnessInstalled: f.harness
                    ? harnessInstalled?.(f.harness)
                    : undefined,
                  isRemoteHarness: f.harness
                    ? REMOTE_HARNESSES.has(f.harness)
                    : false,
                });
                return (
                  <li key={f.id} className="sidebar-familiar-switcher__item">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      className={`sidebar-familiar-switcher__option${isActive ? " sidebar-familiar-switcher__option--active" : ""}`}
                      style={
                        { "--familiar-accent": f.color } as React.CSSProperties
                      }
                      onClick={() => {
                        onSelectFamiliar(f.id);
                        setOpen(false);
                      }}
                    >
                      <span
                        className="sidebar-familiar-switcher__option-avatar"
                        aria-hidden
                      >
                        <FamiliarAvatar familiar={f} size="sm" />
                        <span
                          className={`sidebar-familiar-switcher__presence ${presence.dot}`}
                          aria-hidden
                        />
                      </span>
                      <span className="sidebar-familiar-switcher__option-name">
                        {f.display_name}
                      </span>
                      <span
                        className="sidebar-familiar-switcher__option-trailing"
                        aria-hidden={!needsReply && !isActive ? "true" : undefined}
                      >
                        {needsReply ? (
                          <span
                            className="sidebar-familiar-switcher__unread"
                            aria-label="Reply needed"
                            title="Reply needed"
                          />
                        ) : isActive ? (
                          <Icon
                            name="ph:check-bold"
                            width={12}
                            className="sidebar-familiar-switcher__check"
                          />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            className="sidebar-familiar-switcher__add"
            onClick={() => {
              setOpen(false);
              onAddFamiliar();
            }}
          >
            <Icon name="ph:plus-bold" width={12} />
            <span>Add familiar</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SidebarMinimal(props: SidebarMinimalProps) {
  const {
    mode,
    sessions,
    onNewChat,
    onOpenSettings,
    onModeChange,
    addons,
    familiars,
    activeFamiliar,
    responseNeeded,
    harnessInstalled,
    onSelectFamiliar,
    onAddFamiliar,
  } = props;

  // Filter out disabled add-on items. GitHub is gated; library is always shown.
  const visibleFolderModes = FOLDER_MODES.filter((fm) => {
    if (fm.id === "github") return addons?.github === true;
    return true;
  });

  const workModes = visibleFolderModes.filter((fm) => fm.group === "work");
  const knowledgeModes = visibleFolderModes.filter((fm) => fm.group === "knowledge");
  const toolsModes = visibleFolderModes.filter((fm) => fm.group === "tools" || fm.group === "addons");

  return (
    <nav className="sidebar-minimal">
      {/* Header: Familiar switcher (full width) + New chat */}
      <div className="sidebar-actions sidebar-action-stack">
        <FamiliarSwitcher
          familiars={familiars}
          activeFamiliar={activeFamiliar ?? null}
          sessions={sessions}
          responseNeeded={responseNeeded ?? new Set()}
          harnessInstalled={harnessInstalled}
          onSelectFamiliar={onSelectFamiliar}
          onAddFamiliar={onAddFamiliar}
        />
        <ActionRow
          icon={<Icon name="ph:note-pencil" width={14} />}
          label="New chat"
          onClick={onNewChat}
        />
      </div>

      <div className="sidebar-nav-scroll">
        <SidebarSection label="Work">
          {workModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => onModeChange(fm.id)}
            />
          ))}
        </SidebarSection>

        <SidebarSection label="Knowledge">
          {knowledgeModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => onModeChange(fm.id)}
            />
          ))}
        </SidebarSection>

        <SidebarSection label="Tools">
          {toolsModes.map((fm) => (
            <FolderRow
              key={fm.id}
              id={fm.id}
              label={fm.label}
              iconName={fm.iconName}
              active={mode === fm.id}
              badge={fm.badge?.(props)}
              kbd={fm.kbd}
              onClick={() => onModeChange(fm.id)}
            />
          ))}
        </SidebarSection>
      </div>

      {/* Bottom: Settings */}
      <div className="sidebar-foot">
        <button
          type="button"
          className="sidebar-foot-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          <span className="sidebar-foot-icon-cell" aria-hidden="true">
            <Icon name="ph:gear-six" width={14} className="sidebar-foot-icon" />
          </span>
          <span className="sidebar-foot-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}

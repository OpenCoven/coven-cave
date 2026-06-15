"use client";

import { useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { NotificationBell } from "@/components/notification-bell";
import { Popover } from "@/components/ui/popover";
import { FamiliarAvatar } from "@/components/familiar-avatar";
import type { Familiar } from "@/lib/types";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { InboxItem } from "@/lib/cave-inbox";
import type { InboxPrefs } from "@/lib/cave-inbox-prefs";

type Props = {
  onOpenPalette: () => void;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  onOpenMobileHandoff: () => void;
  inboxItems: InboxItem[];
  familiars: Familiar[];
  inboxPrefs: InboxPrefs;
  inboxBadgeCount: number;
  onOpenInboxItem?: (item: InboxItem) => void;
  onNotificationPrefsChanged: () => void;
  /** Active-familiar switcher box. When `onSelectFamiliar` + `activeFamiliar`
   *  are provided, the top bar renders a box showing the current familiar that
   *  opens a picker (desktop + mobile). Resolved familiars carry avatar glyphs. */
  activeFamiliar?: ResolvedFamiliar | null;
  familiarOptions?: ResolvedFamiliar[];
  onSelectFamiliar?: (id: string) => void;
  /** Mobile-only drawer toggles. Visibility is gated by CSS at <768px
   *  (.top-bar__mobile-toggle is `display: none` on desktop). Omit any
   *  that aren't applicable to the current surface — e.g. two-pane modes
   *  with no list panel should pass `onToggleList={undefined}`. */
  onToggleNav?: () => void;
  onToggleList?: () => void;
  onToggleFamiliar?: () => void;
  navDrawerOpen?: boolean;
  listDrawerOpen?: boolean;
  familiarDrawerOpen?: boolean;
};

export function TopBar(props: Props) {
  const {
    onOpenPalette,
    onOpenInbox,
    onOpenSettings,
    onOpenMobileHandoff,
    inboxItems,
    familiars,
    inboxPrefs,
    inboxBadgeCount,
    onOpenInboxItem,
    onNotificationPrefsChanged,
    onToggleNav,
    onToggleList,
    onToggleFamiliar,
    navDrawerOpen,
    listDrawerOpen,
    familiarDrawerOpen,
    activeFamiliar,
    familiarOptions,
    onSelectFamiliar,
  } = props;

  const [familiarPickerOpen, setFamiliarPickerOpen] = useState(false);
  const familiarBoxRef = useRef<HTMLButtonElement | null>(null);
  // Show the switcher whenever there are familiars to pick — even before one is
  // the global "active" familiar (e.g. the Home surface, where activeId is null).
  // The box previews the active familiar, falling back to the first option, so
  // it's always reachable to make a first selection.
  const displayFamiliar = activeFamiliar ?? familiarOptions?.[0] ?? null;
  const showFamiliarSwitcher = Boolean(onSelectFamiliar && displayFamiliar);

  return (
    <header className="top-bar">
      {/* Left cell: mobile drawer toggles; empty on desktop so the grid
          keeps the search bar centered. */}
      <div className="top-bar__lead">
        {onToggleNav ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleNav}
            aria-label={navDrawerOpen ? "Close navigation" : "Open navigation (⌘B)"}
            aria-expanded={Boolean(navDrawerOpen)}
            aria-controls="nav"
            title={navDrawerOpen ? "Close navigation" : "Open navigation"}
          >
            <Icon name="ph:sidebar-simple" width={18} />
          </button>
        ) : null}
        {onToggleList ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleList}
            aria-label={listDrawerOpen ? "Close list" : "Open list (⌘\\)"}
            aria-expanded={Boolean(listDrawerOpen)}
            aria-pressed={Boolean(listDrawerOpen)}
            aria-controls="list"
            title={listDrawerOpen ? "Close list" : "Open list"}
          >
            <Icon name="ph:list-checks-bold" width={18} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="top-bar__search"
        onClick={onOpenPalette}
        aria-label="Search and jump to anything"
      >
        <Icon name="ph:magnifying-glass" width={12} />
        <span>Jump to anything…</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="top-bar__actions">
        {showFamiliarSwitcher && displayFamiliar ? (
          <>
            <button
              ref={familiarBoxRef}
              type="button"
              className="top-bar__familiar"
              onClick={() => setFamiliarPickerOpen((open) => !open)}
              aria-haspopup="listbox"
              aria-expanded={familiarPickerOpen}
              aria-label={`Switch familiar — current: ${displayFamiliar.display_name}`}
              title="Switch familiar"
            >
              <FamiliarAvatar familiar={displayFamiliar} size="sm" />
              <span className="top-bar__familiar-name">{displayFamiliar.display_name}</span>
              <Icon name="ph:caret-down" width={10} />
            </button>
            <Popover
              open={familiarPickerOpen}
              onOpenChange={setFamiliarPickerOpen}
              anchorRef={familiarBoxRef}
              placement="bottom-end"
              minWidth={208}
              className="top-bar__familiar-popover"
            >
              <ul className="top-bar__familiar-list" role="listbox" aria-label="Switch familiar">
                {(familiarOptions ?? []).map((option) => {
                  const isActive = option.id === activeFamiliar?.id;
                  return (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`top-bar__familiar-option${isActive ? " is-active" : ""}`}
                        onClick={() => {
                          onSelectFamiliar?.(option.id);
                          setFamiliarPickerOpen(false);
                        }}
                      >
                        <FamiliarAvatar familiar={option} size="sm" />
                        <span className="top-bar__familiar-option-name">{option.display_name}</span>
                        {option.harness ? (
                          <span className="top-bar__familiar-option-meta">{option.harness}</span>
                        ) : null}
                        {isActive ? <Icon name="ph:check" width={12} /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Popover>
          </>
        ) : null}
        <button
          type="button"
          className="top-bar__icon-btn top-bar__mobile-handoff"
          onClick={onOpenMobileHandoff}
          aria-label="Open on phone"
          title="Open on phone"
        >
          <Icon name="ph:phone" width={14} />
        </button>
        <NotificationBell
          items={inboxItems}
          familiars={familiars}
          prefs={inboxPrefs}
          badgeCount={inboxBadgeCount}
          onOpenInbox={onOpenInbox}
          onOpenItem={onOpenInboxItem}
          onPrefsChanged={onNotificationPrefsChanged}
        />
        <button
          type="button"
          className="top-bar__account"
          onClick={onOpenSettings}
          aria-label="Account / settings"
          title="Settings (⌘,)"
        >
          <Icon name="ph:user" width={13} />
        </button>
        {onToggleFamiliar ? (
          <button
            type="button"
            className="top-bar__mobile-toggle"
            onClick={onToggleFamiliar}
            aria-label={familiarDrawerOpen ? "Close familiar panel" : "Open familiar panel (⌘J)"}
            aria-expanded={Boolean(familiarDrawerOpen)}
            aria-pressed={Boolean(familiarDrawerOpen)}
            aria-controls="agent"
            title={familiarDrawerOpen ? "Close familiar panel" : "Open familiar panel"}
          >
            <Icon name="ph:cat" width={18} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

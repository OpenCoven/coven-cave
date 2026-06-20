"use client";

import { Icon } from "@/lib/icon";
import { FamiliarSwitcher } from "@/components/familiar-switcher";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { SessionRow } from "@/lib/types";

type Props = {
  familiars: ResolvedFamiliar[];
  activeFamiliarId: string | null;
  sessions: SessionRow[];
  responseNeeded?: Set<string>;
  /** Open task count (board cards not yet done) — drives the Tasks badge. */
  taskCount: number;
  /** Items needing attention — drives the Inbox badge. */
  inboxCount: number;
  /** Open the shared context-aware search palette. */
  onOpenSearch: () => void;
  /** Shared top-search query, mirrored with the mobile top bar and palette. */
  searchQuery: string;
  /** Update shared top-search query. */
  onSearchQueryChange: (query: string) => void;
  /** Change the active-familiar scope (the switcher menu's "All"/per-familiar). */
  onSelectFamiliar: (id: string | null) => void;
  /** Jump to the task board. */
  onViewTasks: () => void;
  /** Jump to the inbox / schedules. */
  onViewInbox: () => void;
};

function fmtBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * A slim, always-visible desktop top menu bar with the familiar selector,
 * global search, and task/inbox counters. It is the desktop counterpart to the
 * mobile `.top-bar` (which stays hidden ≥1024px); this bar is hidden below
 * 1024px so the two never both render.
 */
export function FamiliarMenuBar({
  familiars,
  activeFamiliarId,
  sessions,
  responseNeeded,
  taskCount,
  inboxCount,
  onOpenSearch,
  searchQuery,
  onSearchQueryChange,
  onSelectFamiliar,
  onViewTasks,
  onViewInbox,
}: Props) {
  return (
    <nav className="menu-bar" aria-label="Chat with familiars and view tasks">
      <div className="menu-bar__group menu-bar__group--chat">
        <FamiliarSwitcher
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          placement="bottom-start"
          labeled
        />
      </div>

      <form
        className="menu-bar__search"
        role="search"
        // Open the palette on an explicit click (or Enter via onSubmit), NOT on
        // focus. The palette restores focus to this input when it closes, so
        // opening on focus would immediately reopen it — making Escape and
        // click-off impossible to escape.
        onClick={onOpenSearch}
        onSubmit={(e) => {
          e.preventDefault();
          onOpenSearch();
        }}
      >
        <Icon name="ph:magnifying-glass" width={13} className="menu-bar__search-icon" aria-hidden />
        <input
          type="search"
          className="menu-bar__search-input"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search or ask Salem..."
          aria-label="Search anything or ask Salem"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>⌘K</kbd>
      </form>

      <div className="menu-bar__group menu-bar__group--tasks">
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewTasks}
          aria-label={taskCount > 0 ? `View tasks — ${taskCount} open` : "View tasks"}
        >
          <Icon name="ph:kanban" width={15} aria-hidden />
          <span>Tasks</span>
          {taskCount > 0 ? <span className="menu-bar__badge">{fmtBadge(taskCount)}</span> : null}
        </button>
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewInbox}
          aria-label={inboxCount > 0 ? `View inbox — ${inboxCount} need attention` : "View inbox"}
        >
          <Icon name="ph:tray" width={15} aria-hidden />
          <span>Inbox</span>
          {inboxCount > 0 ? (
            <span className="menu-bar__badge menu-bar__badge--alert">{fmtBadge(inboxCount)}</span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}


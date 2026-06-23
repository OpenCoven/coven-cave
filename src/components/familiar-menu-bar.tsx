"use client";

import { Icon } from "@/lib/icon";
import { FamiliarQuickSwitch } from "@/components/familiar-quick-switch";
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
  /** Enrich active tasks for the selected familiar. */
  onEnrichTasks?: () => void;
  enrichingTasks?: boolean;
  enrichProgress?: { done: number; total: number } | null;
  /** Jump to the inbox / schedules. */
  onViewInbox: () => void;
};

const ENRICH_TASKS_TITLE =
  "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats";

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
  onEnrichTasks,
  enrichingTasks,
  enrichProgress,
  onViewInbox,
}: Props) {
  const enrichLabel = enrichingTasks
    ? enrichProgress
      ? `${enrichProgress.done}/${enrichProgress.total}`
      : "Starting..."
    : "Enhance";

  return (
    <nav className="menu-bar" aria-label="Chat with familiars and view tasks">
      <div className="menu-bar__group menu-bar__group--chat">
        <FamiliarQuickSwitch
          familiars={familiars}
          activeFamiliarId={activeFamiliarId}
          sessions={sessions}
          responseNeeded={responseNeeded}
          onSelectFamiliar={onSelectFamiliar}
          placement="bottom-start"
          labeled
          // Surface every familiar in the top bar, not just the 6 most-recent.
          // The strip stays pin/recency-ordered and scrolls horizontally when
          // they overflow the available width.
          max={familiars.length}
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
        <Icon name="ph:magnifying-glass" width={20} className="menu-bar__search-icon" aria-hidden />
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
        {onEnrichTasks ? (
          <button
            type="button"
            className="menu-bar__task focus-ring"
            onClick={onEnrichTasks}
            disabled={enrichingTasks || !activeFamiliarId}
            aria-label={enrichingTasks ? `Enhancing tasks ${enrichLabel}` : activeFamiliarId ? ENRICH_TASKS_TITLE : "Select a familiar to enhance tasks"}
            title={activeFamiliarId ? ENRICH_TASKS_TITLE : "Select a familiar to enhance tasks"}
          >
            <Icon name="ph:sparkle" width={22} height={22} aria-hidden />
            <span>{enrichingTasks ? enrichLabel : "Enhance"}</span>
          </button>
        ) : null}
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewTasks}
          aria-label={taskCount > 0 ? `View tasks — ${taskCount} open` : "View tasks"}
        >
          <Icon name="ph:kanban" width={22} height={22} aria-hidden />
          <span>Tasks</span>
          {taskCount > 0 ? <span className="menu-bar__badge">{fmtBadge(taskCount)}</span> : null}
        </button>
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewInbox}
          aria-label={inboxCount > 0 ? `View inbox — ${inboxCount} need attention` : "View inbox"}
        >
          <Icon name="ph:tray" width={22} height={22} aria-hidden />
          <span>Inbox</span>
          {inboxCount > 0 ? (
            <span className="menu-bar__badge menu-bar__badge--alert">{fmtBadge(inboxCount)}</span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}

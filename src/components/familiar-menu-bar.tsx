"use client";

import { Icon } from "@/lib/icon";
import { useKeySymbols } from "@/lib/platform-keys";

type Props = {
  /** Gates the Enhance action (needs a selected familiar). Familiar SELECTION
   *  itself lives in the chat sidebar's header switcher, not this bar. */
  activeFamiliarId: string | null;
  /** Open task count (board cards not yet done) — drives the Tasks badge. */
  taskCount: number;
  /** Schedule items needing attention — drives the Schedules badge. */
  scheduleNeedsCount: number;
  /** Open the shared context-aware search palette. */
  onOpenSearch: () => void;
  /** Shared top-search query, mirrored with the mobile top bar and palette. */
  searchQuery: string;
  /** Update shared top-search query. */
  onSearchQueryChange: (query: string) => void;
  /** Jump to the task board. */
  onViewTasks: () => void;
  /** Enrich active tasks for the selected familiar. */
  onEnrichTasks?: () => void;
  enrichingTasks?: boolean;
  enrichProgress?: { done: number; total: number } | null;
  /** Jump to the Schedules surface (calendar + crons). */
  onViewSchedules: () => void;
  /** Open the quick-chat dropdown (anchored under its trigger in this bar). */
  onOpenQuickChat?: () => void;
};

const ENRICH_TASKS_TITLE =
  "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats";

function fmtBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/**
 * A slim, always-visible desktop top menu bar with global search and
 * task/schedule counters. It is the desktop counterpart to the mobile
 * `.top-bar` (which stays hidden ≥1024px); this bar is hidden below 1024px so
 * the two never both render. Familiar selection lives in the chat sidebar's
 * header switcher, not here.
 */
export function FamiliarMenuBar({
  activeFamiliarId,
  taskCount,
  scheduleNeedsCount,
  onOpenSearch,
  searchQuery,
  onSearchQueryChange,
  onViewTasks,
  onEnrichTasks,
  enrichingTasks,
  enrichProgress,
  onViewSchedules,
  onOpenQuickChat,
}: Props) {
  const keys = useKeySymbols();
  const enrichLabel = enrichingTasks
    ? enrichProgress
      ? `${enrichProgress.done}/${enrichProgress.total}`
      : "Starting..."
    : "Enhance";

  return (
    <nav className="menu-bar" aria-label="Chat with familiars and view tasks">
      {/* Familiar selection moved to the chat sidebar's header switcher —
          the bar keeps search + task/schedule chrome only. */}
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
          aria-label="Search anything or ask Salem, the docs familiar"
          title="Search everything — or ask Salem, the familiar trained on the OpenCoven docs"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>{keys.mod}K</kbd>
      </form>

      <div className="menu-bar__group menu-bar__group--tasks">
        {onOpenQuickChat ? (
          <button
            type="button"
            className="menu-bar__task focus-ring"
            data-quick-chat-trigger
            onClick={onOpenQuickChat}
            aria-label="Quick chat"
            title="Quick chat (⌘J)"
          >
            <Icon name="ph:chat-circle-dots" width={22} height={22} aria-hidden />
            <span className="menu-bar__task-label">Chat</span>
          </button>
        ) : null}
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
            {/* Live progress is information, not chrome — it stays visible
                while a run is in flight; the idle label is icon-only. */}
            <span className={enrichingTasks ? "menu-bar__task-label menu-bar__task-label--live" : "menu-bar__task-label"}>
              {enrichingTasks ? enrichLabel : "Enhance"}
            </span>
          </button>
        ) : null}
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewTasks}
          aria-label={taskCount > 0 ? `View tasks — ${taskCount} open` : "View tasks"}
        >
          <Icon name="ph:kanban" width={22} height={22} aria-hidden />
          <span className="menu-bar__task-label">Tasks</span>
          {taskCount > 0 ? <span className="menu-bar__badge">{fmtBadge(taskCount)}</span> : null}
        </button>
        {/* This button lands on the Schedules surface (workspace mode "inbox"
            is the Schedules view — calendar + crons), so it is labelled
            Schedules and badged with the schedule needs-you count. There is no
            dedicated Inbox surface; inbox items live in the notification bell. */}
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewSchedules}
          aria-label={scheduleNeedsCount > 0 ? `View schedules — ${scheduleNeedsCount} need attention` : "View schedules"}
        >
          <Icon name="ph:calendar-check" width={22} height={22} aria-hidden />
          <span className="menu-bar__task-label">Schedules</span>
          {scheduleNeedsCount > 0 ? (
            <span className="menu-bar__badge">{fmtBadge(scheduleNeedsCount)}</span>
          ) : null}
        </button>
      </div>
    </nav>
  );
}

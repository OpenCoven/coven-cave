"use client";

import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { workspacePageDefinition } from "@/lib/workspace-page-registry";
import { platformizeHint, useKeySymbols } from "@/lib/platform-keys";

type Props = {
  /** Gates the Enhance action (needs a selected familiar). Familiar SELECTION
   *  itself lives in the sidenav header switcher (cave-vtk9), not this bar. */
  activeFamiliarId: string | null;
  /** Running-processes control (waveform trigger + popover), rendered by the
   *  workspace (it owns the sessions state and chat navigation) so this bar
   *  stays markup-thin. Hidden at zero by the control itself. */
  runningStatus?: ReactNode;
  /** Notification bell, rendered by the workspace (it owns the inbox state)
   *  so this bar stays markup-thin. Joins the right-side status controls. */
  bell?: ReactNode;
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
  /** Start a blank chat through the shell's acting-familiar gate. */
  onOpenQuickChat: () => void;
};

const ENRICH_TASKS_TITLE =
  "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats";
const SEARCH_LABEL = "Search Cave";
const NEW_CHAT_LABEL = "New chat";
const TASKS_LABEL = workspacePageDefinition("board")?.title ?? "Tasks";
const RITUALS_LABEL = workspacePageDefinition("inbox")?.title ?? "Rituals";

function fmtBadge(n: number): string {
  // Cap at 9+: two adjacent three-glyph "99+" pills read as duplicate noise
  // in the corner — one glyph says "many" just as well, and the button's
  // aria-label/tooltip still carries the exact count (cave-gf5l).
  return n > 9 ? "9+" : String(n);
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
  runningStatus,
  bell,
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
  const searchShortcut = platformizeHint("⌘K", keys);
  const newChatShortcut = platformizeHint("⌘J", keys);
  const enrichLabel = enrichingTasks
    ? enrichProgress
      ? `${enrichProgress.done}/${enrichProgress.total}`
      : "Starting..."
    : "Enhance";
  return (
    <nav className="menu-bar" aria-label="Chat with familiars and view tasks">
      {/* Familiar scope moved to the sidenav header (cave-vtk9) — present on
          every page there; this bar keeps search + the task verbs. */}
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
          placeholder="Search Cave..."
          aria-label={SEARCH_LABEL}
          title={`Search everything in your Cave (${searchShortcut} opens the command palette)`}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>{searchShortcut}</kbd>
      </form>

      <div className="menu-bar__group menu-bar__group--tasks">
        <button
          type="button"
          data-quick-chat-trigger
          className="menu-bar__task focus-ring"
          onClick={onOpenQuickChat}
          aria-label={NEW_CHAT_LABEL}
          title={`${NEW_CHAT_LABEL} (${newChatShortcut})`}
        >
          <Icon name="ph:note-pencil" width={22} height={22} aria-hidden />
          <span className="menu-bar__task-label">{NEW_CHAT_LABEL}</span>
        </button>
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
          aria-label={taskCount > 0 ? `${TASKS_LABEL} — ${taskCount} open` : TASKS_LABEL}
          title={taskCount > 0 ? `${TASKS_LABEL} — ${taskCount} open` : TASKS_LABEL}
        >
          <Icon name="ph:kanban" width={22} height={22} aria-hidden />
          <span className="menu-bar__task-label">{TASKS_LABEL}</span>
          {taskCount > 0 ? <span className="menu-bar__badge">{fmtBadge(taskCount)}</span> : null}
        </button>
        {/* This button lands on the Rituals surface (workspace mode "inbox"
            is the Rituals view — calendar + crons), so it is labelled
            Rituals and badged with the schedule needs-you count. There is no
            dedicated Inbox surface; inbox items live in the notification bell. */}
        <button
          type="button"
          className="menu-bar__task focus-ring"
          onClick={onViewSchedules}
          aria-label={scheduleNeedsCount > 0 ? `View rituals — ${scheduleNeedsCount} need attention` : "View rituals"}
          title={scheduleNeedsCount > 0 ? `View rituals — ${scheduleNeedsCount} need attention` : "View rituals"}
        >
          <Icon name="ph:calendar-check" width={22} height={22} aria-hidden />
          <span className="menu-bar__task-label">{RITUALS_LABEL}</span>
          {scheduleNeedsCount > 0 ? (
            <span className="menu-bar__badge">{fmtBadge(scheduleNeedsCount)}</span>
          ) : null}
        </button>
        {/* The Settings button that used to close this cluster is gone. It was
            drawn with `ph:user`, and because the task labels collapse to
            icon-only on desktop, nothing corrected the misread — it looked like
            an account/profile avatar while its click opened Settings. It
            also duplicated SidebarFooter's Settings button, which carries a
            visible label. Settings remains reachable from the sidebar footer,
            the ⌘K palette and ⌘, (cave-fh9so). */}
      </div>

      {/* Right edge (chat-revamp phase D): the running-processes control
          (waveform + count trigger opening the process list, hidden at zero)
          and the notification bell. */}
      <div className="menu-bar__group menu-bar__group--status">
        {runningStatus}
        {bell}
      </div>
    </nav>
  );
}

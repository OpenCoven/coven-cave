"use client";

import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
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
  /** Open the shared context-aware search palette. */
  onOpenSearch: () => void;
  /** Shared top-search query, mirrored with the mobile top bar and palette. */
  searchQuery: string;
  /** Update shared top-search query. */
  onSearchQueryChange: (query: string) => void;
  /** Enrich active tasks for the selected familiar. */
  onEnrichTasks?: () => void;
  enrichingTasks?: boolean;
  enrichProgress?: { done: number; total: number } | null;
};

const ENRICH_TASKS_TITLE =
  "Enhance assigned familiar tasks: update subtasks, dates, description, status, priority, links, issues, and chats";
const SEARCH_LABEL = "Search Cave";

/**
 * A slim, always-visible desktop top menu bar: centered global search, the
 * Enhance action, and the workspace-owned status slots (running processes +
 * notification bell).
 *
 * It carries NO counters. The Tasks and Rituals buttons and their badges were
 * removed in cave-l9slw because the sidebar navigation already lists both as
 * labelled destinations and badges the same counts from the same sources —
 * this bar is for what has no other desktop home. New chat went with them
 * (⌘J and four other entry points remain).
 *
 * It is the desktop counterpart to the mobile `.top-bar` (which stays hidden
 * ≥1024px); this bar is hidden below 1024px so the two never both render.
 * Note the mobile bar is NOT a mirror — it keeps its own New chat trigger and
 * Tasks row, because those alternatives are not at hand on a phone. Familiar
 * selection lives in the chat sidebar's header switcher, not here.
 */
export function FamiliarMenuBar({
  activeFamiliarId,
  runningStatus,
  bell,
  onOpenSearch,
  searchQuery,
  onSearchQueryChange,
  onEnrichTasks,
  enrichingTasks,
  enrichProgress,
}: Props) {
  const keys = useKeySymbols();
  const searchShortcut = platformizeHint("⌘K", keys);
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

      {/* No New chat trigger here (cave-l9slw). It opened the cluster while
          ⌘J, the sidebar rail CTA, the chat project sidebar, the right-panel
          dropdown and the mobile top bar all still offer it — this bar keeps
          the destinations that have no other desktop home. */}
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
            {/* Live progress is information, not chrome — it stays visible
                while a run is in flight; the idle label is icon-only. */}
            <span className={enrichingTasks ? "menu-bar__task-label menu-bar__task-label--live" : "menu-bar__task-label"}>
              {enrichingTasks ? enrichLabel : "Enhance"}
            </span>
          </button>
        ) : null}
        {/* No Tasks button here either (cave-l9slw). The sidebar navigation
            already carries Tasks as a labelled destination, so this was a
            second, icon-only route to the same board. Its open-task badge went
            with it; the sidebar row still badges the same count from the same
            source, so no signal was lost.

            No Rituals button either. It landed on workspace mode "inbox" and
            badged the schedule needs-you count; that surface is still reached
            from the home dashboard cards, the mobile bottom tabs, the ⌘K
            palette and the tray, and the needs-you count is still surfaced by
            the dashboard and the bottom-tab badge.

            With both badges gone this cluster no longer counts anything, which
            is why fmtBadge went too rather than lingering as a helper with no
            caller. */}
        {/* No Settings button either (cave-fh9so). It closed this cluster
            wearing a `ph:user` glyph, so it read as an account/profile avatar
            while its click opened Settings — and it duplicated SidebarFooter's
            Settings entry, which carries a visible label. Settings is still
            reachable from the sidebar footer and ⌘,. */}
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

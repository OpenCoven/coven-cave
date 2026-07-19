"use client";

// "Open work" — the hearth card's collapsible work ledger (chat revamp 1a).
// One disclosure (expanded by default, preference persisted) that folds the
// signals the removed home digest carousel used to drift past you:
//   · the active project's branch PR (useBranchPr — same source as the
//     composer git chip / status bar) with its state chip,
//   · pending board tasks (count + freshest title) → the Task board,
//   · the needs-you attention tier (same groupInboxFeed slice as the
//     Schedules badge) → the item's target, or Schedules when several wait,
//   · an uncommitted-changes summary from the shared /api/changes poll
//     (useChangesSummary — display-only here; Git changes open from a chat).
// Collapsed, the header row carries a one-line summary of the same counts.

import { useMemo } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { useChangesSummary } from "@/lib/use-changes-summary";
import { useBranchPr } from "@/components/composer-git-chip";
import { openExternalUrl } from "@/lib/open-external";
import type { InboxItem } from "@/lib/cave-inbox";
import type { SuggestionCard } from "@/lib/home-suggestions";
import { pendingBoardTasks } from "@/components/home/use-board-cards";
import { useHomeDisclosure } from "@/components/home/use-home-disclosure";

export const HOME_OPEN_WORK_PREF_KEY = "cave:home:open-work-expanded";

type Props = {
  /** Active project root ("" / null → no git rows). */
  projectRoot: string | null;
  /** The shared /api/board snapshot (use-board-cards). */
  boardCards: SuggestionCard[];
  /** The "needs you" tier — SAME groupInboxFeed slice the Schedules badge counts. */
  needsYou: InboxItem[];
  onOpenBoard: () => void;
  onOpenInboxItem: (item: InboxItem) => void;
  onOpenSchedules: () => void;
};

export function HomeOpenWork({
  projectRoot,
  boardCards,
  needsYou,
  onOpenBoard,
  onOpenInboxItem,
  onOpenSchedules,
}: Props) {
  const [open, toggle] = useHomeDisclosure(HOME_OPEN_WORK_PREF_KEY, true);
  const root = projectRoot?.trim() ? projectRoot : undefined;
  const changes = useChangesSummary(root, Boolean(root));
  const branch = changes.loaded && !changes.notARepo ? changes.branch : null;
  const pr = useBranchPr(root, branch);
  const dirtyCount = changes.loaded && !changes.notARepo ? changes.count : 0;

  const tasks = useMemo(() => pendingBoardTasks(boardCards), [boardCards]);
  const firstNeed = needsYou[0] ?? null;

  const rowCount =
    (pr ? 1 : 0) + (tasks.length ? 1 : 0) + (firstNeed ? 1 : 0) + (dirtyCount ? 1 : 0);
  if (rowCount === 0) return null;

  const prState = pr ? (pr.isDraft ? "draft" : pr.state.toLowerCase()) : null;
  const summary = [
    pr ? `PR #${pr.number} ${prState}` : null,
    tasks.length ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}` : null,
    firstNeed ? `${needsYou.length} need${needsYou.length === 1 ? "s" : ""} you` : null,
    dirtyCount ? `${dirtyCount} uncommitted` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const chevron: IconName = open ? "ph:caret-down" : "ph:caret-right";

  return (
    <section className="home-disclosure" aria-label="Open work">
      <button
        type="button"
        className="home-disclosure__head"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name={chevron} width={11} aria-hidden />
        <span className="home-disclosure__title">Open work</span>
        <span className="home-disclosure__count">
          {open ? `· ${rowCount}` : `· ${summary}`}
        </span>
      </button>
      {open ? (
        <div className="home-disclosure__rows">
          {pr && branch ? (
            <button
              type="button"
              className="home-work-row"
              onClick={() => void openExternalUrl(pr.url)}
              title={`Open PR #${pr.number} (${prState}) on GitHub`}
            >
              <Icon
                name={prState === "merged" ? "ph:git-merge" : "ph:git-pull-request"}
                width={13}
                className="home-work-row__icon home-work-row__icon--accent"
                aria-hidden
              />
              <span className="home-work-row__title">
                PR #{pr.number} — {branch}
              </span>
              <span className="home-work-row__meta home-work-row__meta--pr" data-pr-state={prState}>
                <span className="home-work-row__dot" aria-hidden />
                {prState}
              </span>
              <Icon name="ph:caret-right" width={11} className="home-work-row__chev" aria-hidden />
            </button>
          ) : null}
          {tasks.length ? (
            <button
              type="button"
              className="home-work-row"
              onClick={onOpenBoard}
              title="Open the Task board"
            >
              <Icon name="ph:kanban" width={13} className="home-work-row__icon" aria-hidden />
              <span className="home-work-row__title">Task: {tasks[0].title}</span>
              <span className="home-work-row__meta">
                {tasks.length === 1 ? "pending" : `+${tasks.length - 1} more`}
              </span>
              <Icon name="ph:caret-right" width={11} className="home-work-row__chev" aria-hidden />
            </button>
          ) : null}
          {firstNeed ? (
            <button
              type="button"
              className="home-work-row"
              onClick={() =>
                needsYou.length === 1 ? onOpenInboxItem(firstNeed) : onOpenSchedules()
              }
              title={needsYou.length === 1 ? "Open this item" : "Open Rituals"}
            >
              <Icon name="ph:alarm-fill" width={13} className="home-work-row__icon" aria-hidden />
              <span className="home-work-row__title">{firstNeed.title}</span>
              <span className="home-work-row__meta">
                {needsYou.length === 1 ? "needs you" : `+${needsYou.length - 1} more need you`}
              </span>
              <Icon name="ph:caret-right" width={11} className="home-work-row__chev" aria-hidden />
            </button>
          ) : null}
          {dirtyCount ? (
            // Display-only: the Git changes panel opens from a chat's git chip,
            // not from home — no dead click affordance here.
            <div className="home-work-row home-work-row--static">
              <Icon name="ph:git-diff" width={13} className="home-work-row__icon" aria-hidden />
              <span className="home-work-row__title">
                {dirtyCount} uncommitted change{dirtyCount === 1 ? "" : "s"}
              </span>
              {branch ? <span className="home-work-row__meta">{branch}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

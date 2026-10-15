"use client";

import "@/styles/composer-environment-popover.css";

// ComposerEnvironmentPopover (#5958) — the chat's Environment card, anchored to
// the composer's branch chip at every width. It replaces the floating HUD that
// used to sit at the transcript's top-right on panes ≥1536px (cave-68vv):
//
//   Environment
//   ⇄ Changes                 +128 −42
//   🖥 Local                   · wt-name
//   ⎇ fix/some-branch                ▸
//   ◦ Commit or push
//   ⑂ Create pull request / Pull request #N
//
// Design constraints:
// - No fetch here. The data is the composer chip's own hooks (useChangesSummary
//   through the shared /api/changes gate, useBranchPr), passed in as props.
// - Rows LAUNCH existing surfaces instead of duplicating them: Changes /
//   Commit / Create-PR dispatch "cave:changes-open" through the caller's
//   onOpenChanges (the code rail's Changes tab owns the diff list, commit
//   composer and PR form); the Branch row chains into the shared branch list
//   on the same anchor via onOpenBranchMenu.
// - Each outbound row closes the popover first, then acts, so a chained
//   menu's open state wins the batch over this close (runtime → model parity).
// - Keyboard: a keyboard-opened popover moves focus to the first row; pointer
//   opening leaves focus on the chip. Arrow keys / Home / End rove between the
//   rows. Escape closes and focus returns to the chip (the Popover scaffold
//   restores it when focus would otherwise land on <body>).

import type { KeyboardEvent, RefObject } from "react";
import { Icon } from "@/lib/icon";
import {
  Popover,
  PopoverBody,
  PopoverItem,
  PopoverLabel,
  usePopoverInitialFocus,
} from "@/components/ui/popover";
import {
  environmentLabel,
  prRowAction,
  type EnvPanelPr,
} from "@/lib/chat-environment-panel-model";

export const COMPOSER_ENVIRONMENT_PANEL_CLASS = "composer-environment__panel";

export type ComposerEnvironmentSummary = {
  /** Summed per-file numstat vs HEAD (`+N −N`). */
  totals: { additions: number; deletions: number };
  /** Number of changed files. */
  count: number;
  branch: string | null;
  worktree: string | null;
  /** True once the first /api/changes fetch settled. */
  loaded: boolean;
  notARepo: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: "bottom-start" | "top-start";
  /** True when the chip was activated by keyboard (Enter / Space): focus moves
   *  to the first row. Pointer opening leaves focus on the chip. */
  openedWithKeyboard?: boolean;
  /** The conversation's recorded execution runtime ("local:<cwd>" |
   *  "ssh:<host>:<cwd>") — NOT the model harness. */
  executionRuntime?: string | null;
  summary: ComposerEnvironmentSummary;
  pr: EnvPanelPr | null;
  onOpenPr: (url: string) => void;
  onOpenChanges: () => void;
  onOpenBranchMenu: () => void;
  /** Re-reads the summary (the "Retry" action when it couldn't load). */
  onReload?: () => void;
};

const ROW_SELECTOR = "button.ui-popover-item:not(:disabled)";

/** ArrowUp / ArrowDown / Home / End rove between the rows (select.tsx parity). */
function moveRowFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
  if (rows.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  const current = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0
    : event.key === "End" ? rows.length - 1
    : event.key === "ArrowDown" ? (current + 1) % rows.length
    : current < 0 ? rows.length - 1 : (current - 1 + rows.length) % rows.length;
  rows[next].focus();
}

export function ComposerEnvironmentPopover({
  open,
  onOpenChange,
  anchorRef,
  placement = "top-start",
  openedWithKeyboard = false,
  executionRuntime,
  summary,
  pr,
  onOpenPr,
  onOpenChanges,
  onOpenBranchMenu,
  onReload,
}: Props) {
  usePopoverInitialFocus(open && openedWithKeyboard, `.${COMPOSER_ENVIRONMENT_PANEL_CLASS}`);

  const { totals, count, branch, worktree, loaded, notARepo } = summary;
  const envLabel = environmentLabel(executionRuntime);
  const prRow = prRowAction(pr);
  // The summary hook keeps its last answer on a transient failure and only
  // reports "settled"; a settled repo with no branch is the one shape that
  // means the read never produced anything to show.
  const failed = loaded && !notARepo && branch === null;

  const closeThen = (act: () => void) => {
    onOpenChange(false);
    act();
  };

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      placement={placement}
      minWidth={240}
      className={COMPOSER_ENVIRONMENT_PANEL_CLASS}
      ariaLabel="Environment"
    >
      <PopoverBody className="composer-environment__body" onKeyDown={moveRowFocus}>
        <PopoverLabel>Environment</PopoverLabel>
        {notARepo ? (
          <div className="ui-popover-item composer-environment__note" role="status">
            Not a git repository
          </div>
        ) : !loaded ? (
          <div className="ui-popover-item composer-environment__note" role="status">
            Loading changes…
          </div>
        ) : failed ? (
          <>
            <div className="ui-popover-item composer-environment__note" role="alert">
              Couldn't load changes
            </div>
            <PopoverItem
              semantic="button"
              icon="ph:arrow-clockwise"
              onSelect={() => onReload?.()}
              disabled={!onReload}
            >
              Retry
            </PopoverItem>
          </>
        ) : (
          <>
            <PopoverItem
              semantic="button"
              icon="ph:git-diff"
              title={`${count} changed file${count === 1 ? "" : "s"} — open the Changes panel`}
              onSelect={() => closeThen(onOpenChanges)}
            >
              <span className="composer-environment__row">
                <span className="composer-environment__row-label">Changes</span>
                <span className="composer-environment__diffstat">
                  <span className="composer-environment__additions">
                    +{totals.additions.toLocaleString()}
                  </span>{" "}
                  <span className="composer-environment__deletions">
                    −{totals.deletions.toLocaleString()}
                  </span>
                </span>
              </span>
            </PopoverItem>
            <div className="ui-popover-item composer-environment__static">
              <Icon name="ph:desktop" width={13} aria-hidden />
              <span className="composer-environment__row">
                <span className="composer-environment__row-label">{envLabel}</span>
                {worktree ? (
                  <span className="composer-environment__worktree">{worktree}</span>
                ) : null}
              </span>
            </div>
            {branch ? (
              <PopoverItem
                semantic="button"
                icon="ph:git-branch"
                title={`On ${branch} — switch branch or create a worktree`}
                onSelect={() => closeThen(onOpenBranchMenu)}
              >
                <span className="composer-environment__row">
                  <span className="composer-environment__branch">{branch}</span>
                  <Icon
                    name="ph:caret-right"
                    width={11}
                    aria-hidden
                    className="composer-environment__caret"
                  />
                </span>
              </PopoverItem>
            ) : null}
            <PopoverItem
              semantic="button"
              icon="ph:git-commit"
              title="Open the Changes panel to commit or push"
              onSelect={() => closeThen(onOpenChanges)}
            >
              Commit or push
            </PopoverItem>
            <PopoverItem
              semantic="button"
              icon="ph:git-pull-request"
              title={
                prRow.kind === "view"
                  ? `Open ${prRow.label}`
                  : "Open the Changes panel to create a pull request"
              }
              onSelect={() =>
                closeThen(() => {
                  if (prRow.kind === "view") onOpenPr(prRow.url);
                  else onOpenChanges();
                })
              }
            >
              <span className="composer-environment__row">
                <span className="composer-environment__row-label">{prRow.label}</span>
                {prRow.kind === "view" ? (
                  <Icon
                    name="ph:arrow-square-out"
                    width={11}
                    aria-hidden
                    className="composer-environment__caret"
                  />
                ) : null}
              </span>
            </PopoverItem>
          </>
        )}
      </PopoverBody>
    </Popover>
  );
}

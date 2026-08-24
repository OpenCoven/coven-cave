"use client";

/**
 * review-workbench-header — everything that identifies the item being read.
 *
 * Item-scoped only. Deck-scoped chrome (filters, item navigation, help) lives
 * in the top bar, so a control's position tells you what it acts on.
 */

import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import type { CockpitBucket } from "./review-cockpit";
import { COCKPIT_BUCKETS } from "./review-cockpit";
import type { ReviewWorkItem } from "@/lib/review-landing";

const SHORTCUTS = [
  ["j / k", "Next or previous file"],
  ["[ / ]", "Previous or next review item"],
  ["r", "Mark the current file reviewed"],
  ["f", "Collapse or show the queue"],
  ["e", "Collapse or show the inspector"],
  ["esc", "Close a dialog"],
  ["?", "This overlay"],
  ["drag", "Resize either side pane"],
] as const;

const STATE_ICON: Record<CockpitBucket, IconName> = {
  blocked: "ph:prohibit",
  changes: "ph:arrow-bend-up-left",
  awaiting: "ph:eye",
  ready: "ph:check-circle-fill",
  draft: "ph:pencil-simple",
};

export function ReviewWorkbenchHeader({
  workItem,
  title,
  bucket,
  reference,
  branchLine,
  agent,
  age,
  fileCount,
  additions,
  deletions,
  sourceExplain,
  pullRequestUrl,
  queueCollapsed,
  inspectorOpen,
  shortcutsOpen,
  onExpandQueue,
  onToggleInspector,
  onOpenPullRequest,
  onOpenSession,
  onCloseShortcuts,
}: {
  workItem: ReviewWorkItem | null;
  title: string | null;
  bucket: CockpitBucket | null;
  reference: string | null;
  branchLine: string | null;
  agent: string | null;
  age: string | null;
  fileCount: number;
  additions: number;
  deletions: number;
  sourceExplain: string;
  pullRequestUrl: string | null;
  queueCollapsed: boolean;
  inspectorOpen: boolean;
  shortcutsOpen: boolean;
  onExpandQueue: () => void;
  onToggleInspector: () => void;
  onOpenPullRequest: () => void;
  onOpenSession: () => void;
  onCloseShortcuts: () => void;
}) {
  const state = bucket ? COCKPIT_BUCKETS[bucket] : null;
  const total = Math.max(additions + deletions, 1);

  return (
    <>
      <header className="rd-workbench-head">
        {queueCollapsed ? (
          <button
            type="button"
            className="rd-pane-toggle rd-pane-toggle--flip rd-pane-toggle--bordered focus-ring"
            title="Show queue (f)"
            aria-label="Show review queue"
            onClick={onExpandQueue}
          >
            <Icon name="ph:sidebar-simple" width={13} height={13} aria-hidden />
          </button>
        ) : null}

        <div className="rd-workbench-subject">
          <div className="rd-workbench-line">
            {state && bucket ? (
              <span className="rd-state-pill" data-tone={state.tone}>
                <Icon name={STATE_ICON[bucket]} width={12} height={12} aria-hidden />
                {state.label}
              </span>
            ) : null}
            <h1 title={title ?? undefined}>{title ?? "No session selected"}</h1>
            {reference ? (
              <span className="rd-ref-chip" title={reference}>
                {reference}
              </span>
            ) : null}
          </div>
          <div className="rd-workbench-meta">
            {branchLine ? (
              <span title={sourceExplain}>
                <Icon name="ph:git-branch" width={12} height={12} aria-hidden />
                {branchLine}
              </span>
            ) : null}
            {agent ? (
              <span>
                <Icon name="ph:user" width={12} height={12} aria-hidden />
                {agent}
              </span>
            ) : null}
            {age ? (
              <span>
                <Icon name="ph:clock" width={12} height={12} aria-hidden />
                {age}
              </span>
            ) : null}
            <span className="rd-diffstat">
              <span>
                <Icon name="ph:file-code" width={12} height={12} aria-hidden />
                {fileCount} {fileCount === 1 ? "file" : "files"}
              </span>
              <span className="rd-diffstat-bar" aria-hidden>
                <i className="rd-add-bar" style={{ flexGrow: additions / total }} />
                <i className="rd-del-bar" style={{ flexGrow: deletions / total }} />
              </span>
              <span className="rd-add">+{additions}</span>
              <span className="rd-del">−{deletions}</span>
            </span>
          </div>
        </div>

        <div className="rd-workbench-actions">
          {pullRequestUrl ? (
            <button
              type="button"
              className="rd-chip-btn focus-ring"
              title="Open this pull request on GitHub"
              onClick={onOpenPullRequest}
            >
              <Icon name="ph:git-pull-request" width={13} height={13} aria-hidden />
              Open PR
              <Icon name="ph:arrow-up-right" width={10} height={10} aria-hidden />
            </button>
          ) : null}
          {workItem ? (
            <button
              type="button"
              className="rd-chip-btn focus-ring"
              title="Open the agent session that produced this change"
              onClick={onOpenSession}
            >
              <Icon name="ph:terminal-window" width={13} height={13} aria-hidden />
              Session
              <Icon name="ph:arrow-up-right" width={10} height={10} aria-hidden />
            </button>
          ) : null}
          {inspectorOpen ? null : (
            <button
              type="button"
              className="rd-well-btn rd-well-btn--solo focus-ring"
              title="Show inspector (e)"
              aria-label="Show the review inspector"
              onClick={onToggleInspector}
            >
              <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
            </button>
          )}
        </div>
      </header>

      <Modal
        open={shortcutsOpen}
        onClose={onCloseShortcuts}
        breadcrumb={["Review Deck", "Keyboard shortcuts"]}
        footerActions={
          <button type="button" className="rd-btn focus-ring" onClick={onCloseShortcuts}>
            Close
          </button>
        }
      >
        <div className="rd-shortcuts">
          {SHORTCUTS.map(([keys, label]) => (
            <span key={keys} className="rd-shortcut-row">
              <kbd>{keys}</kbd>
              <span>{label}</span>
            </span>
          ))}
        </div>
        <p className="rd-hint">
          Character shortcuts pause while you type in a field, select, or editable
          region.
        </p>
      </Modal>
    </>
  );
}

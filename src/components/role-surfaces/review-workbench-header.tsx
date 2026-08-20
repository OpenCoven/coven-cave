"use client";

import { Modal } from "@/components/ui/modal";
import { Icon } from "@/lib/icon";
import type { ReviewWorkItem } from "@/lib/review-landing";

export type ReviewMobileView = "queue" | "files" | "evidence";

const SHORTCUTS = [
  ["j / k", "Next or previous file"],
  ["[ / ]", "Previous or next review item"],
  ["f", "Toggle file navigator"],
  ["e", "Toggle evidence dock"],
  ["r", "Mark the current file reviewed"],
  ["?", "Show keyboard shortcuts"],
] as const;

export function ReviewWorkbenchHeader({
  workItem,
  title,
  sourceLabel,
  sourceExplain,
  fileCount,
  additions,
  deletions,
  progressLabel,
  queueCollapsed,
  evidenceOpen,
  mobileView,
  shortcutsOpen,
  onToggleQueue,
  onToggleEvidence,
  onMobileView,
  onOpenShortcuts,
  onCloseShortcuts,
}: {
  workItem: ReviewWorkItem | null;
  title: string | null;
  sourceLabel: string;
  sourceExplain: string;
  fileCount: number;
  additions: number;
  deletions: number;
  progressLabel: string;
  queueCollapsed: boolean;
  evidenceOpen: boolean;
  mobileView: ReviewMobileView;
  shortcutsOpen: boolean;
  onToggleQueue: () => void;
  onToggleEvidence: () => void;
  onMobileView: (view: ReviewMobileView) => void;
  onOpenShortcuts: () => void;
  onCloseShortcuts: () => void;
}) {
  return (
    <>
      <header className="rd-workbench-head">
        <span className="rd-workbench-subject">
          <span className="rd-eyebrow">Under review</span>
          <strong>{workItem?.title ?? title ?? "No session selected"}</strong>
          <span className="rd-workbench-lineage">
            {workItem?.kind === "pull-request" ? (
              <>
                <span>{workItem.repo}#{workItem.number}</span>
                <span>{workItem.baseRef} ← {workItem.headRef}</span>
                <span>head {workItem.revision.slice(0, 7)}</span>
              </>
            ) : workItem?.kind === "local" ? (
              <>
                <span>{workItem.branch ?? "local branch"}</span>
                <span>{workItem.revision}</span>
              </>
            ) : (
              <span>{sourceExplain}</span>
            )}
          </span>
        </span>
        <span className="rd-workbench-stats">
          <span className="rd-pill" data-tone={workItem?.kind === "pull-request" ? "accent" : "warning"}>
            <Icon
              name={workItem?.kind === "pull-request" ? "ph:git-pull-request" : "ph:git-diff"}
              width={11}
              height={11}
              aria-hidden
            />
            {sourceLabel}
          </span>
          <span>{fileCount} files</span>
          <span className="rd-add">+{additions}</span>
          <span className="rd-del">−{deletions}</span>
          <span className="rd-progress-label">{progressLabel}</span>
        </span>
        <span className="rd-workbench-actions">
          <button
            type="button"
            className="rd-icon-btn focus-ring"
            aria-label={queueCollapsed ? "Expand review queue" : "Collapse review queue"}
            title={queueCollapsed ? "Expand queue (f)" : "Collapse queue"}
            onClick={onToggleQueue}
          >
            <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-icon-btn focus-ring"
            data-active={evidenceOpen ? "true" : undefined}
            aria-label={evidenceOpen ? "Close evidence dock" : "Open evidence dock"}
            title="Toggle evidence dock (e)"
            onClick={onToggleEvidence}
          >
            <Icon name="ph:info" width={14} height={14} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-icon-btn focus-ring"
            aria-label="Review Deck keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            onClick={onOpenShortcuts}
          >
            <Icon name="ph:question" width={14} height={14} aria-hidden />
          </button>
        </span>
      </header>

      <div className="rd-mobile-tabs" role="tablist" aria-label="Review Deck views">
        {(["queue", "files", "evidence"] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            className="rd-mobile-tab focus-ring"
            aria-selected={mobileView === view}
            onClick={() => onMobileView(view)}
          >
            {view === "queue" ? "Queue" : view === "files" ? "Files" : "Evidence"}
          </button>
        ))}
      </div>

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
          <p className="rd-hint">
            Character shortcuts pause while you type in a field, select, or editable region.
          </p>
        </div>
      </Modal>
    </>
  );
}

"use client";

/**
 * review-cockpit-topbar — the Review Deck's one strip of global chrome.
 *
 * Everything here acts on the *deck*, never on the selected item: what the
 * queue is scoped to, which attention bucket it is filtered to, where you are
 * in it, and the two disclosures (help, overflow). Item-scoped controls live in
 * the workspace header below it, so a reader never has to ask which of two
 * toolbars owns a button.
 */

import { Icon } from "@/lib/icon";
import { OverflowMenu } from "@/components/ui/overflow-menu";
import { PopoverItem } from "@/components/ui/popover";
import { COCKPIT_BUCKETS } from "./review-cockpit";
import type { DeckSummary } from "./review-readiness";

/** The filter tabs, in the order the queue itself groups by. */
const FILTER_ORDER: readonly (keyof DeckSummary)[] = [
  "blocked",
  "awaiting",
  "changes",
  "ready",
];

export function ReviewCockpitTopBar({
  scope,
  total,
  summary,
  bucketFilter,
  position,
  navTotal,
  checkpointsAvailable,
  refreshing,
  refreshLabel,
  onBucketFilter,
  onPreviousItem,
  onNextItem,
  onOpenShortcuts,
  onOpenCheckpoints,
  onRefresh,
}: {
  scope: string | null;
  total: number;
  summary: DeckSummary;
  bucketFilter: keyof DeckSummary | null;
  /** 1-based position of the selected item within the filtered queue. */
  position: number;
  navTotal: number;
  checkpointsAvailable: boolean;
  refreshing: boolean;
  refreshLabel: string;
  onBucketFilter: (bucket: keyof DeckSummary | null) => void;
  onPreviousItem: () => void;
  onNextItem: () => void;
  onOpenShortcuts: () => void;
  onOpenCheckpoints: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="rd-topbar">
      <span className="rd-topbar-brand">
        <Icon name="ph:git-pull-request" width={15} height={15} aria-hidden />
        <strong>Review Deck</strong>
        {scope ? <span className="rd-topbar-scope">{scope}</span> : null}
      </span>

      <span
        className="rd-segments"
        role="group"
        aria-label="Filter the queue by attention"
      >
        <button
          type="button"
          className="rd-segment focus-ring"
          data-active={bucketFilter == null ? "true" : undefined}
          aria-pressed={bucketFilter == null}
          title="Everything on the deck"
          onClick={() => onBucketFilter(null)}
        >
          All <b>{total}</b>
        </button>
        {FILTER_ORDER.map((bucket) => {
          const meta = COCKPIT_BUCKETS[bucket];
          const active = bucketFilter === bucket;
          return (
            <button
              key={bucket}
              type="button"
              className="rd-segment focus-ring"
              data-rd-tone={meta.tone}
              data-active={active ? "true" : undefined}
              aria-pressed={active}
              title={`Show only ${meta.label.toLowerCase()} — ${meta.hint}`}
              onClick={() => onBucketFilter(active ? null : bucket)}
            >
              <i className="rd-segment-dot" aria-hidden />
              {meta.label}
              <b>{summary[bucket]}</b>
            </button>
          );
        })}
      </span>

      <span className="rd-spacer" />

      <span className="rd-topbar-nav">
        <span
          className="rd-topbar-position"
          title={`Item ${position} of ${navTotal} in the current filter`}
        >
          <b>{position}</b>
          <span aria-hidden>/</span>
          <span>{navTotal}</span>
        </span>
        <span className="rd-well">
          <button
            type="button"
            className="rd-well-btn focus-ring"
            aria-label="Previous item"
            title="Previous item ([)"
            disabled={navTotal < 2}
            onClick={onPreviousItem}
          >
            <Icon name="ph:caret-left" width={13} height={13} aria-hidden />
          </button>
          <button
            type="button"
            className="rd-well-btn focus-ring"
            aria-label="Next item"
            title="Next item (])"
            disabled={navTotal < 2}
            onClick={onNextItem}
          >
            <Icon name="ph:caret-right" width={13} height={13} aria-hidden />
          </button>
        </span>
      </span>

      <button
        type="button"
        className="rd-well-btn rd-well-btn--solo rd-topbar-help focus-ring"
        aria-label="Review Deck keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        onClick={onOpenShortcuts}
      >
        ?
      </button>

      <OverflowMenu ariaLabel="More Review Deck actions" size="xs">
        <PopoverItem
          icon="ph:clock-counter-clockwise"
          disabled={!checkpointsAvailable}
          title={
            checkpointsAvailable
              ? "Read-only patch snapshots saved for this session"
              : "Checkpoints exist for a local session with a project on this machine."
          }
          onSelect={onOpenCheckpoints}
        >
          Local checkpoints
        </PopoverItem>
        <PopoverItem
          icon="ph:arrows-clockwise"
          disabled={refreshing}
          title={refreshLabel}
          onSelect={onRefresh}
        >
          {refreshing ? "Re-reading GitHub state…" : "Refresh GitHub state"}
        </PopoverItem>
        <PopoverItem icon="ph:question" onSelect={onOpenShortcuts}>
          Keyboard shortcuts
        </PopoverItem>
      </OverflowMenu>
    </header>
  );
}

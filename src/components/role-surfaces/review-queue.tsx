"use client";

import { Icon } from "@/lib/icon";
import { Segmented } from "@/components/ui/settings-controls";
import { SurfaceEmpty } from "./surface-room";
import type { DeckSummary, ReviewTone } from "./review-readiness";

export type ReviewSourceFilter = "all" | "prs" | "local";

const SOURCE_FILTERS: readonly ReviewSourceFilter[] = ["all", "prs", "local"];
const SOURCE_FILTER_LABELS: Record<ReviewSourceFilter, string> = {
  all: "All",
  prs: "PRs",
  local: "Local",
};

export type ReviewQueueRowView = {
  id: string;
  title: string;
  reference: string;
  hasPullRequest: boolean;
  additions: number;
  deletions: number;
  age: string;
  stateLabel: string;
  stateTitle: string;
  stateTone: ReviewTone;
};

export type ReviewQueueGroupView = {
  id: keyof DeckSummary;
  label: string;
  items: ReviewQueueRowView[];
};

const FILTER_LABELS: Record<keyof DeckSummary, string> = {
  awaiting: "Needs review",
  changes: "Changes requested",
  blocked: "Blocked",
  ready: "Ready",
};

const FILTER_TONES: Record<keyof DeckSummary, ReviewTone> = {
  awaiting: "accent",
  changes: "warning",
  blocked: "danger",
  ready: "success",
};

export function ReviewQueueScopeBar({
  summary,
  bucketFilter,
  queueCount,
  scope,
  oldest,
  refreshLabel,
  caption,
  onToggleBucket,
}: {
  summary: DeckSummary;
  bucketFilter: keyof DeckSummary | null;
  queueCount: number;
  scope: string | null;
  oldest: string | null;
  refreshLabel: string;
  caption: string;
  onToggleBucket: (bucket: keyof DeckSummary) => void;
}) {
  return (
    <section className="rd-scopebar" aria-label="Review queue attention">
      <span className="rd-scopebar-title">
        <span className="rd-eyebrow">Review run</span>
        <strong>{queueCount} to review</strong>
        {scope ? <span>{scope}</span> : null}
      </span>
      <span className="rd-attention-filters" role="group" aria-label="Filter by attention">
        {(Object.keys(summary) as Array<keyof DeckSummary>).map((bucket) => {
          const active = bucketFilter === bucket;
          return (
            <button
              key={bucket}
              type="button"
              className="rd-attention-filter focus-ring"
              data-tone={FILTER_TONES[bucket]}
              data-active={active ? "true" : undefined}
              aria-pressed={active}
              onClick={() => onToggleBucket(bucket)}
            >
              <span aria-hidden className="rd-attention-mark" />
              {FILTER_LABELS[bucket]}
              <span className="rd-attention-count">{summary[bucket]}</span>
            </button>
          );
        })}
      </span>
      <span className="rd-scopebar-meta" title={caption}>
        {oldest ? <span>oldest {oldest}</span> : null}
        <span>{refreshLabel}</span>
      </span>
    </section>
  );
}

export function ReviewQueue({
  groups,
  selectedId,
  sourceFilter,
  collapsed,
  total,
  emptyTitle,
  emptyHint,
  onSourceFilter,
  onSelect,
  onCollapse,
  onExpand,
}: {
  groups: readonly ReviewQueueGroupView[];
  selectedId: string | null;
  sourceFilter: ReviewSourceFilter;
  collapsed: boolean;
  total: number;
  emptyTitle: string;
  emptyHint: string;
  onSourceFilter: (filter: ReviewSourceFilter) => void;
  onSelect: (id: string) => void;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="rd-panel rd-collapsed rd-queue-spine focus-ring-inset"
        title="Expand review queue"
        aria-label={`Expand review queue, ${total} items`}
        onClick={onExpand}
      >
        <Icon name="ph:sidebar-simple" width={16} height={16} aria-hidden />
        <span className="rd-collapsed-badge">{total}</span>
        <span className="rd-collapsed-label">Queue</span>
      </button>
    );
  }

  return (
    <nav className="rd-panel rd-queue" aria-label="Review queue">
      <div className="rd-queue-head">
        <div className="rd-queue-head-row">
          <span className="rd-eyebrow">Attention queue</span>
          <span className="rd-count">{total}</span>
          <span className="rd-spacer" />
          <button
            type="button"
            className="rd-icon-btn focus-ring"
            title="Collapse queue"
            aria-label="Collapse review queue"
            onClick={onCollapse}
          >
            <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
          </button>
        </div>
        <Segmented
          options={SOURCE_FILTERS}
          value={sourceFilter}
          onChange={onSourceFilter}
          getLabel={(option) => SOURCE_FILTER_LABELS[option]}
          ariaLabel="Filter review queue by source"
        />
      </div>
      <div className="rd-queue-list rd-scroll">
        {groups.length === 0 ? (
          <SurfaceEmpty
            iconName="ph:check-circle-fill"
            title={emptyTitle}
            hint={emptyHint}
          />
        ) : (
          groups.map((group) => (
            <section key={group.id} className="rd-queue-group" aria-labelledby={`rd-group-${group.id}`}>
              <h3 id={`rd-group-${group.id}`} className="rd-queue-group-head" data-tone={FILTER_TONES[group.id]}>
                <span className="rd-attention-mark" aria-hidden />
                {group.label}
                <span>{group.items.length}</span>
              </h3>
              <ul className="role-surface-list">
                {group.items.map((item) => {
                  const active = item.id === selectedId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="rd-row focus-ring-inset"
                        data-active={active ? "true" : undefined}
                        aria-current={active ? "true" : undefined}
                        title={`${item.title} — ${item.hasPullRequest ? "reviewed as the GitHub pull-request diff" : "reviewed as the local working tree"}`}
                        onClick={() => onSelect(item.id)}
                      >
                        <span className="rd-row-top">
                          <Icon
                            name={item.hasPullRequest ? "ph:git-pull-request" : "ph:git-diff"}
                            width={11}
                            height={11}
                            aria-hidden
                          />
                          <span className="rd-row-ref">{item.reference}</span>
                          <span className="rd-spacer" />
                          <span className="rd-pill" data-tone={item.stateTone} title={item.stateTitle}>
                            {item.stateLabel}
                          </span>
                        </span>
                        <span className="rd-row-title">{item.title}</span>
                        <span className="rd-row-meta">
                          <span className="rd-add">+{item.additions}</span>
                          <span className="rd-del">−{item.deletions}</span>
                          <span className="rd-spacer" />
                          <span>{item.age}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </nav>
  );
}

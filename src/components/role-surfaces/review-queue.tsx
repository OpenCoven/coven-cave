"use client";

/**
 * review-queue — the cockpit's left pane: what is waiting, in what order.
 *
 * Three things distinguish it from a list of pull requests. The **mix bar**
 * answers "what is this queue made of?" before any row is read. The **sticky
 * group heads** keep the bucket you are inside named while you scroll.
 * Deck-wide zero counts live in the top bar rather than empty queue groups.
 */

import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Icon } from "@/lib/icon";
import type { IconName } from "@/lib/icon";
import {
  COCKPIT_BUCKETS,
  COCKPIT_BUCKET_ORDER,
  REVIEW_QUEUE_SORT_TITLES,
  type CockpitBucket,
  type QueueMixSegment,
  type ReviewQueueSort,
} from "./review-cockpit";
import type { ReviewTone } from "./review-readiness";

export type ReviewSourceFilter = "all" | "prs" | "local" | "branches";

const SOURCE_FILTERS: readonly {
  id: ReviewSourceFilter;
  label: string;
  title: string;
}[] = [
  { id: "all", label: "All", title: "Active pull requests and local working changes" },
  { id: "prs", label: "PRs", title: "Only sessions with an active linked pull request" },
  { id: "local", label: "Local changes", title: "Working changes without a pull request" },
  { id: "branches", label: "Branches", title: "Browse sessions with a branch but no recorded working changes" },
];

const BUCKET_ICON: Record<CockpitBucket, IconName> = {
  blocked: "ph:prohibit",
  changes: "ph:arrow-bend-up-left",
  awaiting: "ph:eye",
  ready: "ph:check-circle-fill",
  draft: "ph:pencil-simple",
};

export type ReviewQueueRowView = {
  id: string;
  bucket: CockpitBucket;
  title: string;
  reference: string;
  hasPullRequest: boolean;
  statsKnown?: boolean;
  additions: number;
  deletions: number;
  age: string;
  /** The short "why is this here", derived from the queue's one GitHub read. */
  reason: string;
  /** Model that produced the work, when the session recorded one. */
  agent: string | null;
  stateLabel: string;
  stateTitle: string;
  stateTone: ReviewTone;
};

export type ReviewQueueGroupView = {
  id: CockpitBucket;
  items: ReviewQueueRowView[];
};

function QueueMixBar({
  segments,
  total,
}: {
  segments: readonly QueueMixSegment[];
  total: number;
}) {
  if (segments.length === 0) return <span className="rd-mix rd-mix--empty" />;
  const summary = segments
    .map((segment) => `${segment.count} ${segment.label.toLowerCase()}`)
    .join(" · ");
  return (
    <span className="rd-mix" tabIndex={0} role="img" aria-label={`Queue mix: ${summary}`}>
      <span className="rd-mix-track" aria-hidden>
        {segments.map((segment) => (
          <i
            key={segment.bucket}
            data-rd-tone={segment.tone}
            style={{ flexGrow: segment.count }}
          />
        ))}
      </span>
      <span className="rd-mix-detail" aria-hidden>
        {segments.map((segment) => (
          <span key={segment.bucket}>
            <i data-rd-tone={segment.tone} />
            <span>{segment.label}</span>
            <b>{segment.count}</b>
          </span>
        ))}
        <small>{total} in view</small>
      </span>
    </span>
  );
}

export function ReviewQueue({
  groups,
  selectedId,
  sort,
  sourceFilter,
  total,
  mix,
  showEmptyGroups,
  footnote,
  emptyTitle,
  emptyHint,
  query,
  loading,
  error,
  unreadSearchTitles,
  filtered,
  onQuery,
  onRetry,
  onSort,
  onSourceFilter,
  onSelect,
  onCollapse,
  onClearFilters,
}: {
  groups: readonly ReviewQueueGroupView[];
  selectedId: string | null;
  sort: ReviewQueueSort;
  sourceFilter: ReviewSourceFilter;
  total: number;
  mix: readonly QueueMixSegment[];
  /**
   * Whether an empty bucket still gets a heading. True only when nothing is
   * filtered out — inside a filter, "Nothing blocked" would describe the
   * filter rather than the deck.
   */
  showEmptyGroups: boolean;
  footnote: string;
  emptyTitle: string;
  emptyHint: string;
  query: string;
  loading: boolean;
  error: string | null;
  unreadSearchTitles: number;
  filtered: boolean;
  onQuery: (value: string) => void;
  onRetry: () => void;
  onSort: (sort: ReviewQueueSort) => void;
  onSourceFilter: (filter: ReviewSourceFilter) => void;
  onSelect: (id: string) => void;
  onCollapse: () => void;
  onClearFilters: () => void;
}) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const rendered = COCKPIT_BUCKET_ORDER.flatMap((bucket) => {
    const items = byId.get(bucket)?.items ?? [];
    if (items.length > 0) return [{ bucket, items, empty: false }];
    // The draft group has no reassuring empty state — "Outside the counts" is
    // a container, not an outcome, so an empty one is simply absent.
    if (!showEmptyGroups || bucket === "draft") return [];
    return [{ bucket, items, empty: true }];
  });

  return (
    <nav className="rd-queue" aria-label="Review queue">
      <div className="rd-queue-head">
        <span className="rd-eyebrow">Queue</span>
        <span className="rd-queue-count">{total}</span>
        <QueueMixBar segments={mix} total={total} />
        <span className="rd-well rd-well--pill" role="group" aria-label="Queue order">
          <button
            type="button"
            className="rd-well-seg focus-ring"
            data-active={sort === "attention" ? "true" : undefined}
            aria-pressed={sort === "attention"}
            title={REVIEW_QUEUE_SORT_TITLES.attention}
            onClick={() => onSort("attention")}
          >
            Priority
          </button>
          <button
            type="button"
            className="rd-well-seg focus-ring"
            data-active={sort === "repo" ? "true" : undefined}
            aria-pressed={sort === "repo"}
            title={REVIEW_QUEUE_SORT_TITLES.repo}
            onClick={() => onSort("repo")}
          >
            Repo
          </button>
        </span>
        <button
          type="button"
          className="rd-pane-toggle rd-pane-toggle--flip focus-ring"
          title="Collapse queue (f)"
          aria-label="Collapse review queue"
          onClick={onCollapse}
        >
          <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
        </button>
      </div>

      <SearchInput
        value={query}
        onValueChange={onQuery}
        onClear={() => onQuery("")}
        placeholder="Search review items…"
        aria-label="Search review items"
        containerClassName="rd-queue-search"
      />
      {error ? (
        <div className="rd-queue-notice rd-error" role="alert">
          <span>{error}</span>
          <Button size="xs" disabled={loading} onClick={onRetry}>Retry queue</Button>
        </div>
      ) : loading ? (
        <p className="rd-queue-notice" role="status">Reading GitHub state…</p>
      ) : null}

      {unreadSearchTitles > 0 ? (
        <p className="rd-queue-notice" role="status">
          Search covers loaded titles and session details. {unreadSearchTitles} PR{" "}
          {unreadSearchTitles === 1 ? "title is" : "titles are"} unread.
          {" "}Clear the search to browse unread reviews.
        </p>
      ) : null}

      <div className="rd-queue-list rd-scroll">
        {total === 0 ? (
          <div className="rd-queue-empty">
            <span className="rd-queue-empty-mark" aria-hidden>
              <Icon name="ph:check-circle-fill" width={19} height={19} />
            </span>
            <strong>{loading ? "Reading the queue…" : emptyTitle}</strong>
            <span>{loading ? "Unverified pull requests stay outside the attention counts." : emptyHint}</span>
            {filtered ? (
              <Button size="xs" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          rendered.map(({ bucket, items, empty }) => {
            const meta = COCKPIT_BUCKETS[bucket];
            return (
              <section
                key={bucket}
                className="rd-queue-group"
                aria-labelledby={`rd-group-${bucket}`}
              >
                <h3
                  id={`rd-group-${bucket}`}
                  className="rd-queue-group-head"
                  data-rd-tone={meta.tone}
                >
                  <Icon name={BUCKET_ICON[bucket]} width={13} height={13} aria-hidden />
                  <span className="rd-queue-group-label">{meta.label}</span>
                  <span className="rd-queue-group-count">{items.length}</span>
                  <span className="rd-spacer" />
                  <span className="rd-queue-group-hint">{meta.hint}</span>
                </h3>
                {empty ? (
                  <p className="rd-queue-group-empty">{meta.empty}</p>
                ) : (
                  <ul className="rd-queue-rows">
                    {items.map((item) => {
                      const active = item.id === selectedId;
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="rd-row focus-ring-inset"
                            data-rd-tone={meta.tone}
                            data-active={active ? "true" : undefined}
                            aria-current={active ? "true" : undefined}
                            title={`${item.title} — ${item.stateTitle}`}
                            onClick={() => onSelect(item.id)}
                            onKeyDown={(event) => {
                              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
                              const rows = Array.from(
                                event.currentTarget.closest(".rd-queue-list")?.querySelectorAll<HTMLButtonElement>(".rd-row") ?? [],
                              );
                              const index = rows.indexOf(event.currentTarget);
                              const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
                                : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
                              event.preventDefault();
                              rows[next]?.focus();
                            }}
                          >
                            <span className="rd-row-line">
                              <i className="rd-row-dot" data-rd-tone={meta.tone} aria-hidden />
                              <span className="rd-row-title">{item.title}</span>
                              <span className="rd-row-age">{item.age}</span>
                            </span>
                            <span className="rd-row-line">
                              <span
                                className="rd-row-ref"
                                data-local={item.hasPullRequest ? undefined : "true"}
                              >
                                {item.reference}
                              </span>
                              {item.reason ? (
                                <span className="rd-row-reason" data-rd-tone={meta.tone}>
                                  {item.reason}
                                </span>
                              ) : null}
                            </span>
                            <span className="rd-row-line rd-row-meta">
                              {item.statsKnown === false ? (
                                <span>Diff totals unavailable</span>
                              ) : (
                                <>
                                  <span className="rd-add">+{item.additions}</span>
                                  <span className="rd-del">−{item.deletions}</span>
                                </>
                              )}
                              {item.agent ? <span>· {item.agent}</span> : null}
                              <span className="rd-spacer" />
                              <span className="rd-visually-hidden">{item.stateLabel}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>

      <div className="rd-queue-foot">
        <span className="rd-well rd-well--pill" role="group" aria-label="Filter queue by source">
          {SOURCE_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="rd-well-seg focus-ring"
              data-active={sourceFilter === filter.id ? "true" : undefined}
              aria-pressed={sourceFilter === filter.id}
              title={filter.title}
              onClick={() => onSourceFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </span>
        <span className="rd-queue-footnote" title={footnote}>
          {footnote}
        </span>
      </div>
    </nav>
  );
}

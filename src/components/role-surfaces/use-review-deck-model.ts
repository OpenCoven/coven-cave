"use client";

/**
 * use-review-deck-model — everything the deck knows about the *queue*.
 *
 * Reading sessions, asking GitHub for one state per pull request, bucketing,
 * filtering, ordering, and shaping rows is one responsibility; selecting an
 * item and posting a verdict is another. Splitting them keeps the surface an
 * orchestrator rather than a monolith, and means every derivation here can be
 * re-read without scrolling past a mutation.
 *
 * Nothing here fetches per row beyond the single `/api/github/item?pull=1`
 * read `useDeckBuckets` already makes — the row's reason and pill are derived
 * from that one response, never from a fan-out the queue cannot afford.
 */

import { useCallback, useMemo } from "react";
import { relativeTime } from "@/lib/relative-time";
import type { SessionRow } from "@/lib/types";
import {
  countedTotal,
  deckCaption,
  deckSummary,
  reviewBucket,
  reviewStateMeta,
  type DeckSummary,
  type ReviewBucket,
} from "./review-readiness";
import {
  orderReviewQueue,
  queueMix,
  queueRowReason,
  type CockpitBucket,
  type QueueMixSegment,
  type ReviewQueueSort,
} from "./review-cockpit";
import { prLabel, reviewQueue, type ReviewItem } from "./review-deck";
import type {
  ReviewQueueGroupView,
  ReviewQueueRowView,
  ReviewSourceFilter,
} from "./review-queue";
import { prKey, useDeckBuckets } from "./use-deck-buckets";

export type ReviewDeckCounts = {
  queue: number;
  pullRequests: number;
  scope: string | null;
  oldest: string | null;
};

/** The four counted buckets. Drafts and unread pull requests fold into
 *  "awaiting" for the *filter tabs* only — see `cockpitBucket` for grouping. */
function attentionBucket(bucket: ReviewBucket): keyof DeckSummary {
  return bucket === "draft" || bucket === "unread" ? "awaiting" : bucket;
}

/**
 * The bucket a queue *row* is grouped under. Drafts and not-yet-read pull
 * requests share the "Outside the counts" group: neither is a state a reviewer
 * is being asked to act on, and folding either into "Needs review" would
 * inflate a count the deck has not earned.
 */
export function cockpitBucket(bucket: ReviewBucket): CockpitBucket {
  return bucket === "unread" ? "draft" : bucket;
}

export type ReviewDeckModel = {
  /** Everything on the deck, before any filter. */
  all: ReviewItem<SessionRow>[];
  /** What is in view, in the chosen order. */
  ordered: Array<{ id: string; bucket: CockpitBucket; item: ReviewItem<SessionRow> }>;
  groups: ReviewQueueGroupView[];
  mix: QueueMixSegment[];
  summary: DeckSummary;
  counts: ReviewDeckCounts;
  caption: string;
  loading: boolean;
  bucketOf: (session: SessionRow) => ReviewBucket;
};

export function useReviewDeckModel({
  sessions,
  sourceFilter,
  bucketFilter,
  sort,
}: {
  sessions: readonly SessionRow[];
  sourceFilter: ReviewSourceFilter;
  bucketFilter: keyof DeckSummary | null;
  sort: ReviewQueueSort;
}): ReviewDeckModel {
  const all = useMemo(() => reviewQueue(sessions), [sessions]);
  const pullRequests = useMemo(
    () =>
      all.flatMap((item) => {
        const pullRequest = item.session.pullRequest;
        return pullRequest?.number == null
          ? []
          : [{ repo: pullRequest.repo, number: pullRequest.number }];
      }),
    [all],
  );
  const deckBuckets = useDeckBuckets(pullRequests);

  const factsFor = useCallback(
    (session: SessionRow) => {
      const pullRequest = session.pullRequest;
      if (pullRequest?.number == null) return null;
      return (
        deckBuckets.facts.get(
          prKey({ repo: pullRequest.repo, number: pullRequest.number }),
        ) ?? null
      );
    },
    [deckBuckets.facts],
  );
  const bucketOf = useCallback(
    (session: SessionRow) =>
      reviewBucket(factsFor(session), session.pullRequest?.number != null),
    [factsFor],
  );

  const summary = useMemo<DeckSummary>(() => {
    const out: DeckSummary = { awaiting: 0, changes: 0, blocked: 0, ready: 0 };
    for (const item of all) out[attentionBucket(bucketOf(item.session))] += 1;
    return out;
  }, [all, bucketOf]);

  const outside = useMemo(() => {
    let drafts = 0;
    let unread = 0;
    let local = 0;
    for (const item of all) {
      const bucket = bucketOf(item.session);
      if (bucket === "draft") drafts += 1;
      if (bucket === "unread") unread += 1;
      if (item.session.pullRequest?.number == null) local += 1;
    }
    return { drafts, unread, local };
  }, [all, bucketOf]);

  const ordered = useMemo(() => {
    const visible = all.filter((item) => {
      const hasPullRequest = item.session.pullRequest?.number != null;
      if (sourceFilter === "prs" && !hasPullRequest) return false;
      if (sourceFilter === "local" && hasPullRequest) return false;
      if (bucketFilter && attentionBucket(bucketOf(item.session)) !== bucketFilter) {
        return false;
      }
      return true;
    });
    return orderReviewQueue(
      visible.map((item) => ({
        id: item.session.id,
        bucket: cockpitBucket(bucketOf(item.session)),
        repo: item.session.pullRequest?.repo ?? item.session.project_root ?? "",
        updatedAt: item.session.updated_at,
        item,
      })),
      sort,
    );
  }, [all, bucketFilter, bucketOf, sort, sourceFilter]);

  const groups = useMemo<ReviewQueueGroupView[]>(() => {
    const byBucket = new Map<CockpitBucket, ReviewQueueRowView[]>();
    for (const entry of ordered) {
      const session = entry.item.session;
      const pullRequest = session.pullRequest;
      const hasPullRequest = pullRequest?.number != null;
      const facts = factsFor(session);
      const hasLocalChanges =
        (session.diff?.additions ?? 0) + (session.diff?.deletions ?? 0) > 0;
      const meta = reviewStateMeta(facts, { hasPullRequest, hasLocalChanges });
      const row: ReviewQueueRowView = {
        id: session.id,
        bucket: entry.bucket,
        title: session.title || session.id,
        reference: hasPullRequest
          ? (prLabel(pullRequest) ?? pullRequest.repo)
          : (session.workBranch ?? session.git?.branch ?? "local changes"),
        hasPullRequest,
        additions: session.diff?.additions ?? 0,
        deletions: session.diff?.deletions ?? 0,
        age: relativeTime(session.updated_at),
        reason: queueRowReason(facts, { hasPullRequest, hasLocalChanges }),
        agent: session.model ?? null,
        stateLabel: meta.label,
        stateTitle: meta.title,
        stateTone: meta.tone,
      };
      const bucket = byBucket.get(entry.bucket);
      if (bucket) bucket.push(row);
      else byBucket.set(entry.bucket, [row]);
    }
    return [...byBucket].map(([id, items]) => ({ id, items }));
  }, [factsFor, ordered]);

  const mix = useMemo(
    () => queueMix(ordered.map((entry) => entry.bucket)),
    [ordered],
  );

  const counts = useMemo<ReviewDeckCounts>(() => {
    const repos = [...new Set(pullRequests.map((item) => item.repo))];
    const bases = [
      ...new Set(
        pullRequests
          .map((pullRequest) => deckBuckets.facts.get(prKey(pullRequest))?.baseRef)
          .filter((base): base is string => Boolean(base)),
      ),
    ];
    const repoScope =
      repos.length === 0
        ? all.length > 0
          ? "local sessions only"
          : null
        : repos.length === 1
          ? repos[0]
          : `${repos.length} repos`;
    const oldest = all.at(-1)?.session ?? null;
    return {
      queue: all.length,
      pullRequests: pullRequests.length,
      scope:
        repoScope && bases.length === 1 ? `${repoScope} → ${bases[0]}` : repoScope,
      oldest: oldest ? relativeTime(oldest.updated_at) : null,
    };
  }, [all, deckBuckets.facts, pullRequests]);

  const caption = deckCaption({
    counted: countedTotal(
      deckSummary(all.map((item) => bucketOf(item.session))),
    ),
    local: outside.local,
    drafts: outside.drafts,
    unread: outside.unread,
    skipped: deckBuckets.skipped,
  });

  return {
    all,
    ordered,
    groups,
    mix,
    summary,
    counts,
    caption,
    loading: deckBuckets.loading,
    bucketOf,
  };
}

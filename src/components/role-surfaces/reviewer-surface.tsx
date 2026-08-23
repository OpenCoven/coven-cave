"use client";

/**
 * Reviewer Surface — a focused review run.
 *
 * ReviewerSurface owns selection, data reads, persistence, and mutations. The
 * queue, diff, evidence, verdict, and checkpoint regions are bounded
 * renderers. The selected session still decides the review source: a linked
 * pull request is read from GitHub, and only a session without one falls back
 * to its local working tree. Unknown GitHub state never enables an action.
 */

import "@/styles/review-deck.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { GITHUB_REVIEW_BODY_MAX_LENGTH } from "@/lib/github-review";
import {
  localReviewRevision,
  localReviewWorkItem,
  pullRequestReviewWorkItem,
  type ReviewWorkItem,
} from "@/lib/review-landing";
import { relativeTime } from "@/lib/relative-time";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import {
  countedTotal,
  deckCaption,
  deckSummary,
  isReadyToMerge,
  prBlockers,
  readinessBanner,
  reviewBucket,
  reviewStateMeta,
  checksMeta,
  type DeckSummary,
  type ReviewBucket,
} from "./review-readiness";
import { diffStatLabel, prLabel, prUrl, reviewQueue } from "./review-deck";
import { ReviewCheckpointsDrawer } from "./review-checkpoints-drawer";
import { ReviewDiffWorkbench } from "./review-diff-workbench";
import {
  ReviewEvidenceDock,
  type ReviewEvidenceTab,
} from "./review-evidence-dock";
import {
  ReviewQueue,
  ReviewQueueScopeBar,
  type ReviewQueueGroupView,
  type ReviewQueueRowView,
  type ReviewSourceFilter,
} from "./review-queue";
import { ReviewVerdictDock } from "./review-verdict-dock";
import {
  ReviewWorkbenchHeader,
  type ReviewMobileView,
} from "./review-workbench-header";
import {
  groupReviewQueue,
  nextReviewItemId,
  resolveReviewShortcut,
  reviewActionsAvailable,
} from "./review-workbench-model";
import { prKey, useDeckBuckets } from "./use-deck-buckets";
import { usePrReadiness } from "./use-pr-readiness";
import { useReviewPreferences } from "./use-review-preferences";
import { useReviewProgress } from "./use-review-progress";
import { useReviewSource } from "./use-review-source";
import { REVIEWER_SURFACE_ID } from "./ids";

export type ReviewDeckCounts = {
  queue: number;
  pullRequests: number;
  scope: string | null;
  oldest: string | null;
};

export type ReviewerState = {
  selectedSessionId: string | null;
  drawerOpen: boolean;
  lastCounts: ReviewDeckCounts | null;
};

export const REVIEWER_INITIAL_STATE: ReviewerState = {
  selectedSessionId: null,
  drawerOpen: false,
  lastCounts: null,
};

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (/^(input|textarea|select)$/i.test(element.tagName) ||
        element.isContentEditable),
  );
}

function attentionBucket(bucket: ReviewBucket): keyof DeckSummary {
  return bucket === "draft" || bucket === "unread" ? "awaiting" : bucket;
}

export function ReviewerSurface({
  context,
}: {
  context: RoleSurfaceContext;
}) {
  const familiar = context.activeFamiliar;
  const familiarId = familiar.id;
  const [state, patch] = useRoleSurfaceState<ReviewerState>(
    familiarId,
    REVIEWER_SURFACE_ID,
    REVIEWER_INITIAL_STATE,
  );
  const { announce } = useAnnouncer();

  const [sourceFilter, setSourceFilter] =
    useState<ReviewSourceFilter>("all");
  const [bucketFilter, setBucketFilter] =
    useState<keyof DeckSummary | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceTab, setEvidenceTab] =
    useState<ReviewEvidenceTab>("overview");
  const [mobileView, setMobileView] = useState<ReviewMobileView>("files");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    "approve" | "changes" | "merge" | null
  >(null);
  const [preferences, patchPreferences] = useReviewPreferences();
  const evidenceRef = useRef<HTMLElement | null>(null);

  const fullQueue = useMemo(
    () => reviewQueue(context.runtimeState.sessions),
    [context.runtimeState.sessions],
  );
  const queuePullRequests = useMemo(
    () =>
      fullQueue.flatMap((item) => {
        const pullRequest = item.session.pullRequest;
        return pullRequest?.number == null
          ? []
          : [{ repo: pullRequest.repo, number: pullRequest.number }];
      }),
    [fullQueue],
  );
  const deckBuckets = useDeckBuckets(queuePullRequests);
  const bucketOf = useCallback(
    (session: (typeof fullQueue)[number]["session"]) => {
      const pullRequest = session.pullRequest;
      if (pullRequest?.number == null) return reviewBucket(null, false);
      return reviewBucket(
        deckBuckets.facts.get(
          prKey({ repo: pullRequest.repo, number: pullRequest.number }),
        ),
        true,
      );
    },
    [deckBuckets.facts],
  );

  const countedSummary = useMemo(
    () => deckSummary(fullQueue.map((item) => bucketOf(item.session))),
    [bucketOf, fullQueue],
  );
  const attentionSummary = useMemo<DeckSummary>(() => {
    const summary: DeckSummary = {
      awaiting: 0,
      changes: 0,
      blocked: 0,
      ready: 0,
    };
    for (const item of fullQueue) {
      summary[attentionBucket(bucketOf(item.session))] += 1;
    }
    return summary;
  }, [bucketOf, fullQueue]);
  const outsideCounts = useMemo(() => {
    let drafts = 0;
    let unread = 0;
    let local = 0;
    for (const item of fullQueue) {
      const bucket = bucketOf(item.session);
      if (bucket === "draft") drafts += 1;
      if (bucket === "unread") unread += 1;
      if (item.session.pullRequest?.number == null) local += 1;
    }
    return { drafts, unread, local };
  }, [bucketOf, fullQueue]);

  const sourceFiltered = useMemo(
    () =>
      fullQueue.filter((item) => {
        const hasPullRequest = item.session.pullRequest?.number != null;
        if (sourceFilter === "prs" && !hasPullRequest) return false;
        if (sourceFilter === "local" && hasPullRequest) return false;
        if (
          bucketFilter &&
          attentionBucket(bucketOf(item.session)) !== bucketFilter
        ) {
          return false;
        }
        return true;
      }),
    [bucketFilter, bucketOf, fullQueue, sourceFilter],
  );

  const queueRows = useMemo(() => {
    const rows = new Map<string, ReviewQueueRowView>();
    for (const item of sourceFiltered) {
      const pullRequest = item.session.pullRequest;
      const hasPullRequest = pullRequest?.number != null;
      const rowFacts =
        pullRequest?.number == null
          ? null
          : deckBuckets.facts.get(
              prKey({
                repo: pullRequest.repo,
                number: pullRequest.number,
              }),
            );
      const meta = reviewStateMeta(rowFacts, {
        hasPullRequest,
        hasLocalChanges:
          (item.session.diff?.additions ?? 0) +
            (item.session.diff?.deletions ?? 0) >
          0,
      });
      rows.set(item.session.id, {
        id: item.session.id,
        title: item.session.title || item.session.id,
        reference: hasPullRequest
          ? (prLabel(pullRequest) ?? pullRequest.repo)
          : item.session.git?.branch ?? "local changes",
        hasPullRequest,
        additions: item.session.diff?.additions ?? 0,
        deletions: item.session.diff?.deletions ?? 0,
        age: relativeTime(item.session.updated_at),
        stateLabel: meta.label,
        stateTitle: meta.title,
        stateTone: meta.tone,
      });
    }
    return rows;
  }, [deckBuckets.facts, sourceFiltered]);
  const queueGroups = useMemo<ReviewQueueGroupView[]>(
    () =>
      groupReviewQueue(
        sourceFiltered,
        (item) => attentionBucket(bucketOf(item.session)),
      ).map((group) => ({
        ...group,
        items: group.items.flatMap((item) => {
          const row = queueRows.get(item.session.id);
          return row ? [row] : [];
        }),
      })),
    [bucketOf, queueRows, sourceFiltered],
  );

  const counts = useMemo<ReviewDeckCounts>(() => {
    const repos = [...new Set(queuePullRequests.map((item) => item.repo))];
    const bases = [
      ...new Set(
        queuePullRequests
          .map(
            (pullRequest) =>
              deckBuckets.facts.get(prKey(pullRequest))?.baseRef,
          )
          .filter((base): base is string => Boolean(base)),
      ),
    ];
    const repoScope =
      repos.length === 0
        ? fullQueue.length > 0
          ? "local sessions only"
          : null
        : repos.length === 1
          ? repos[0]
          : `${repos.length} repos`;
    const oldest = fullQueue.at(-1)?.session ?? null;
    return {
      queue: fullQueue.length,
      pullRequests: queuePullRequests.length,
      scope:
        repoScope && bases.length === 1
          ? `${repoScope} → ${bases[0]}`
          : repoScope,
      oldest: oldest ? relativeTime(oldest.updated_at) : null,
    };
  }, [deckBuckets.facts, fullQueue, queuePullRequests]);

  useEffect(() => {
    const previous = state.lastCounts;
    if (
      previous?.queue === counts.queue &&
      previous?.pullRequests === counts.pullRequests &&
      previous?.scope === counts.scope &&
      previous?.oldest === counts.oldest
    ) {
      return;
    }
    patch({ lastCounts: counts });
  }, [counts, patch, state.lastCounts]);

  const selected = useMemo(
    () =>
      fullQueue.find(
        (item) => item.session.id === state.selectedSessionId,
      ) ?? null,
    [fullQueue, state.selectedSessionId],
  );
  const sessionPullRequest = selected?.session.pullRequest ?? null;
  const selectedPullRequest = useMemo(
    () =>
      sessionPullRequest?.number == null
        ? null
        : {
            repo: sessionPullRequest.repo,
            number: sessionPullRequest.number,
          },
    [sessionPullRequest],
  );
  const projectRoot = selected?.session.project_root ?? null;
  const selectedScope = `${familiarId}:${selected?.session.id ?? "none"}:${projectRoot ?? "none"}`;
  const source = useReviewSource({
    pr: selectedPullRequest,
    projectRoot,
    scope: selectedScope,
  });
  const readiness = usePrReadiness(selectedPullRequest);
  const facts = readiness.facts;
  const isPr = source.kind === "pull-request";
  const blockers = useMemo(() => prBlockers(facts), [facts]);
  const ready = isReadyToMerge(facts);
  const banner = useMemo(
    () => readinessBanner(facts, blockers),
    [blockers, facts],
  );
  const checks = useMemo(() => checksMeta(facts), [facts]);
  const selectedPullRequestUrl = prUrl(sessionPullRequest);
  const sourceLabel = !selected
    ? "No session"
    : isPr
      ? "Pull request diff"
      : "Local working tree";
  const sourceExplain = !selected
    ? "Pick a session in the queue to read what it changed."
    : isPr
      ? "Files come from GitHub for this pull request, never from this machine's working tree."
      : "No pull request is linked, so the deck reads this session project's uncommitted work. GitHub actions stay unavailable.";

  const workItem = useMemo<ReviewWorkItem | null>(() => {
    if (!selected || source.phase !== "ready") return null;
    const title = selected.session.title || selected.session.id;
    if (isPr) {
      if (!facts?.headSha) return null;
      return pullRequestReviewWorkItem({
        title,
        repo: facts.repo,
        number: facts.number,
        baseRef: facts.baseRef,
        headRef: facts.headRef,
        headSha: facts.headSha,
      });
    }
    return localReviewWorkItem({
      title,
      sessionId: selected.session.id,
      branch: source.localBranch ?? selected.session.git?.branch ?? null,
      revision: localReviewRevision(
        selected.session.updated_at,
        source.files,
      ),
    });
  }, [facts, isPr, selected, source.files, source.localBranch, source.phase]);
  const readablePaths = useMemo(
    () =>
      source.files
        .filter((file) => file.noPatchReason == null)
        .map((file) => file.path),
    [source.files],
  );
  const progress = useReviewProgress({
    familiarId,
    sourceId: workItem?.id ?? null,
    revision: workItem?.revision ?? null,
    readablePaths,
  });
  const commentCounts = useMemo(() => {
    const countsByPath = new Map<string, number>();
    for (const thread of facts?.threads.items ?? []) {
      const path = source.files.find(
        (file) =>
          thread.where === file.path ||
          thread.where.startsWith(`${file.path}:`),
      )?.path;
      if (path) countsByPath.set(path, (countsByPath.get(path) ?? 0) + 1);
    }
    return countsByPath;
  }, [facts?.threads.items, source.files]);

  const note = selected ? notes[selected.session.id] ?? "" : "";
  const setNote = useCallback(
    (value: string) => {
      if (!selected) return;
      const bounded = value.slice(0, GITHUB_REVIEW_BODY_MAX_LENGTH);
      setNotes((current) => ({
        ...current,
        [selected.session.id]: bounded,
      }));
      if (bounded.trim()) setNoteError(null);
    },
    [selected],
  );

  useEffect(() => {
    setNoteError(null);
    setActionError(null);
    setEvidenceTab("overview");
    setMobileView("files");
  }, [state.selectedSessionId]);

  const canAct = reviewActionsAvailable({
    sourceKind: source.kind,
    readinessPhase: readiness.phase,
    state: facts?.state,
    draft: facts?.draft,
  });

  const approve = useCallback(async () => {
    if (!canAct || !selectedPullRequest || busy) return false;
    setBusy("approve");
    setActionError(null);
    try {
      const response = await fetch("/api/github/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: selectedPullRequest.repo,
          number: selectedPullRequest.number,
          event: "APPROVE",
          body: note.trim(),
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!json?.ok) throw new Error(json?.error || "review failed");
      announce(
        `Approved ${prLabel(selectedPullRequest)}. Re-reading GitHub state.`,
      );
      readiness.refresh();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, note, readiness, selectedPullRequest]);

  const requestChanges = useCallback(async () => {
    if (!canAct || !selectedPullRequest || busy) return false;
    const body = note.trim();
    if (!body) {
      const message =
        "A note is required — GitHub sends it to the familiar as the review body.";
      setNoteError(message);
      announce("Write a note before requesting changes.", "assertive");
      return false;
    }
    setBusy("changes");
    setActionError(null);
    setNoteError(null);
    try {
      const response = await fetch("/api/github/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: selectedPullRequest.repo,
          number: selectedPullRequest.number,
          event: "REQUEST_CHANGES",
          body,
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!json?.ok) throw new Error(json?.error || "review failed");
      announce(
        `Requested changes on ${prLabel(selectedPullRequest)}. Re-reading GitHub state.`,
      );
      readiness.refresh();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, note, readiness, selectedPullRequest]);

  const merge = useCallback(async () => {
    if (!ready || !selectedPullRequest || busy) return false;
    setBusy("merge");
    setActionError(null);
    try {
      const response = await fetch("/api/github/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: selectedPullRequest.repo,
          number: selectedPullRequest.number,
          method: "squash",
        }),
      });
      const json = (await response.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!json?.ok) throw new Error(json?.error || "merge failed");
      announce(
        `Merged ${prLabel(selectedPullRequest)} (squash). It leaves the review queue on the next read.`,
      );
      readiness.refresh();
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, readiness, ready, selectedPullRequest]);

  const toggleBucket = useCallback(
    (bucket: keyof DeckSummary) => {
      const next = bucketFilter === bucket ? null : bucket;
      setBucketFilter(next);
      announce(
        next
          ? `Queue filtered to ${next === "awaiting" ? "needs review" : next}.`
          : "Queue filter cleared.",
      );
    },
    [announce, bucketFilter],
  );

  const focusBlockers = useCallback(() => {
    setEvidenceOpen(true);
    setEvidenceTab("overview");
    setMobileView("evidence");
    requestAnimationFrame(() => evidenceRef.current?.focus());
    announce("Moved to merge evidence. Blockers are listed there.");
  }, [announce]);

  const markCurrentReviewed = useCallback(() => {
    const path = source.openPath;
    if (!path || !workItem) return;
    const result = progress.toggle(path);
    announce(
      result.completed
        ? `Reviewed ${path}. Every readable file on head ${workItem.revision.slice(0, 7)} is reviewed.`
        : result.reviewed
          ? `Marked ${path} reviewed.`
          : `Marked ${path} unread.`,
    );
  }, [announce, progress, source.openPath, workItem]);

  const openUnread = useCallback(
    (direction: 1 | -1) => {
      const path = progress.nextUnread(source.openPath, direction);
      if (!path) {
        announce("Every readable file on this revision is reviewed.");
        return;
      }
      source.open(path);
      announce(`Moved to unread file ${path}.`);
    },
    [announce, progress, source],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = resolveReviewShortcut({
        key: event.key,
        editable: isEditableTarget(event.target),
        composing: event.isComposing,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
      if (!action) return;
      event.preventDefault();
      if (action === "next-file" || action === "previous-file") {
        const paths = source.files.map((file) => file.path);
        const current = source.openPath
          ? paths.indexOf(source.openPath)
          : -1;
        const offset = action === "next-file" ? 1 : -1;
        const next =
          paths.length === 0
            ? null
            : paths[
                current < 0
                  ? 0
                  : (current + offset + paths.length) % paths.length
              ];
        if (next) source.open(next);
        return;
      }
      if (action === "next-item" || action === "previous-item") {
        const next = nextReviewItemId(
          sourceFiltered.map((item) => item.session.id),
          state.selectedSessionId,
          action === "next-item" ? 1 : -1,
        );
        if (next) patch({ selectedSessionId: next });
        return;
      }
      if (action === "toggle-files") {
        setNavCollapsed((collapsed) => !collapsed);
        setMobileView("files");
        return;
      }
      if (action === "toggle-evidence") {
        setEvidenceOpen((open) => !open);
        setMobileView("evidence");
        return;
      }
      if (action === "mark-reviewed") {
        markCurrentReviewed();
        return;
      }
      setShortcutsOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    markCurrentReviewed,
    patch,
    source,
    sourceFiltered,
    state.selectedSessionId,
  ]);

  const caption = deckCaption({
    counted: countedTotal(countedSummary),
    local: outsideCounts.local,
    drafts: outsideCounts.drafts,
    unread: outsideCounts.unread,
    skipped: deckBuckets.skipped,
  });
  const refreshLabel = readiness.refreshing
    ? "refreshing…"
    : deckBuckets.loading
      ? "reading GitHub…"
      : readiness.checkedAt
        ? `checked ${relativeTime(new Date(readiness.checkedAt).toISOString())}`
        : "not checked";
  const queueEmptyTitle = bucketFilter
    ? "Nothing in this attention group."
    : sourceFilter === "all"
      ? "Deck clear."
      : "Nothing matches this filter.";
  const queueEmptyHint = bucketFilter
    ? "Clear the attention filter to see the rest of the queue."
    : sourceFilter === "all"
      ? "Sessions appear here when they carry a pull request, working changes, or a branch."
      : "Try All — the other source may still have review work.";
  const additions =
    facts?.additions ?? selected?.session.diff?.additions ?? 0;
  const deletions =
    facts?.deletions ?? selected?.session.diff?.deletions ?? 0;
  const progressLabel = workItem
    ? `${progress.reviewedCount}/${progress.readableCount} reviewed`
    : isPr && selected
      ? "waiting for exact head"
      : selected
        ? diffStatLabel(selected.session.diff)
        : "no selection";

  return (
    <div className="rd-stage" data-mobile-view={mobileView}>
      <ReviewQueueScopeBar
        summary={attentionSummary}
        bucketFilter={bucketFilter}
        queueCount={fullQueue.length}
        scope={counts.scope}
        oldest={counts.oldest}
        refreshLabel={refreshLabel}
        caption={caption}
        onToggleBucket={toggleBucket}
      />
      <ReviewWorkbenchHeader
        workItem={workItem}
        title={selected?.session.title || selected?.session.id || null}
        sourceLabel={sourceLabel}
        sourceExplain={sourceExplain}
        fileCount={source.filesTotal}
        additions={additions}
        deletions={deletions}
        progressLabel={progressLabel}
        queueCollapsed={queueCollapsed}
        evidenceOpen={evidenceOpen}
        mobileView={mobileView}
        shortcutsOpen={shortcutsOpen}
        onToggleQueue={() => setQueueCollapsed((collapsed) => !collapsed)}
        onToggleEvidence={() => setEvidenceOpen((open) => !open)}
        onMobileView={(view) => {
          setMobileView(view);
          if (view === "evidence") setEvidenceOpen(true);
        }}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onCloseShortcuts={() => setShortcutsOpen(false)}
      />

      <div
        className="rd-layout"
        data-queue-collapsed={queueCollapsed ? "true" : undefined}
        data-evidence-open={evidenceOpen ? "true" : undefined}
      >
        <ReviewQueue
          groups={queueGroups}
          selectedId={state.selectedSessionId}
          sourceFilter={sourceFilter}
          collapsed={queueCollapsed}
          total={sourceFiltered.length}
          emptyTitle={queueEmptyTitle}
          emptyHint={queueEmptyHint}
          onSourceFilter={setSourceFilter}
          onSelect={(id) => {
            patch({ selectedSessionId: id });
            setMobileView("files");
          }}
          onCollapse={() => setQueueCollapsed(true)}
          onExpand={() => setQueueCollapsed(false)}
        />

        <main className="rd-main">
          <ReviewDiffWorkbench
            selected={Boolean(selected)}
            workItem={workItem}
            source={source}
            selectedPrUrl={selectedPullRequestUrl}
            navCollapsed={navCollapsed}
            preferences={preferences}
            reviewed={progress.reviewed}
            reviewedCount={progress.reviewedCount}
            readableCount={progress.readableCount}
            commentCounts={commentCounts}
            onOpenUrl={context.openUrl}
            onToggleNav={() => setNavCollapsed((collapsed) => !collapsed)}
            onPreferences={patchPreferences}
            onMarkReviewed={markCurrentReviewed}
            onPreviousUnread={() => openUnread(-1)}
            onNextUnread={() => openUnread(1)}
          />
          <ReviewVerdictDock
            selectionKey={selectedScope}
            selected={Boolean(selected)}
            isPr={isPr}
            facts={facts}
            canAct={canAct}
            ready={ready}
            blockers={blockers}
            busy={busy}
            actionError={actionError}
            note={note}
            noteError={noteError}
            reviewedCount={progress.reviewedCount}
            readableCount={progress.readableCount}
            onNote={setNote}
            onFocusBlockers={focusBlockers}
            onApprove={approve}
            onRequestChanges={requestChanges}
            onMerge={merge}
          />
        </main>

        <ReviewEvidenceDock
          open={evidenceOpen}
          tab={evidenceTab}
          selected={Boolean(selected)}
          isPr={isPr}
          readinessPhase={readiness.phase}
          readinessError={readiness.error}
          refreshing={readiness.refreshing}
          checkedLabel={refreshLabel}
          facts={facts}
          blockers={blockers}
          banner={banner}
          checks={checks}
          sourceLabel={sourceLabel}
          sourceExplain={sourceExplain}
          branch={
            facts?.headRef ??
            source.localBranch ??
            selected?.session.git?.branch ??
            null
          }
          pullRequestLabel={prLabel(sessionPullRequest)}
          updatedLabel={
            selected ? relativeTime(selected.session.updated_at) : null
          }
          focusRef={evidenceRef}
          onTab={setEvidenceTab}
          onClose={() => setEvidenceOpen(false)}
          onRefresh={readiness.refresh}
          onOpenSession={() => {
            if (selected) {
              context.openSession(selected.session.id, familiarId);
            }
          }}
          onOpenPullRequest={() => {
            if (selectedPullRequestUrl) context.openUrl(selectedPullRequestUrl);
          }}
        />
      </div>

      {selected && !isPr && projectRoot ? (
        <ReviewCheckpointsDrawer
          projectRoot={projectRoot}
          selectedScope={selectedScope}
          open={state.drawerOpen}
          onToggle={() => patch({ drawerOpen: !state.drawerOpen })}
        />
      ) : null}
    </div>
  );
}

"use client";

/**
 * Reviewer Surface — the Review Deck cockpit.
 *
 * Three columns, each answering one question and nothing else: the queue says
 * *what is waiting*, the centre says *what changed*, the inspector says *can
 * this land, and what do I do about it*. A control's column tells you what it
 * acts on, and the top bar holds the only chrome that acts on the deck itself.
 *
 * This surface still owns selection, reads, persistence, and every mutation.
 * The panes are bounded renderers, and the selected session still decides the
 * review source: a linked pull request is read from GitHub, and only a session
 * without one falls back to its local working tree. Unknown GitHub state never
 * enables an action.
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
  isReadyToMerge,
  mergeChecklist,
  prBlockers,
  checksMeta,
  type DeckSummary,
} from "./review-readiness";
import {
  fileChipCapacity,
  reviewDecision,
  triageBlockers,
  type ReviewQueueSort,
} from "./review-cockpit";
import {
  parseCheckpointEnvelope,
  prLabel,
  prUrl,
  type ReviewCheckpoint,
} from "./review-deck";
import { ReviewCockpitTopBar } from "./review-cockpit-topbar";
import { ReviewDiffWorkbench } from "./review-diff-workbench";
import { ReviewFileRail } from "./review-file-rail";
import {
  ReviewInspector,
  type InspectorDisclosure,
} from "./review-inspector";
import { ReviewQueue, type ReviewSourceFilter } from "./review-queue";
import { ReviewToast } from "./review-toast";
import { ReviewVerdictDock } from "./review-verdict-dock";
import {
  ReviewMobileTabs,
  type ReviewMobileView,
} from "./review-mobile-tabs";
import { ReviewWorkbenchHeader } from "./review-workbench-header";
import {
  nextReviewItemId,
  resolveReviewShortcut,
  reviewActionsAvailable,
} from "./review-workbench-model";
import { usePrReadiness } from "./use-pr-readiness";
import {
  cockpitBucket,
  useReviewDeckModel,
  type ReviewDeckCounts,
} from "./use-review-deck-model";
import { useReviewPanes } from "./use-review-panes";
import { useReviewPreferences } from "./use-review-preferences";
import { useReviewProgress } from "./use-review-progress";
import { useReviewSource } from "./use-review-source";
import { useReviewToast } from "./use-review-toast";
import { REVIEWER_SURFACE_ID } from "./ids";

export type { ReviewDeckCounts };

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

export function ReviewerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiar = context.activeFamiliar;
  const familiarId = familiar.id;
  const [state, patch] = useRoleSurfaceState<ReviewerState>(
    familiarId,
    REVIEWER_SURFACE_ID,
    REVIEWER_INITIAL_STATE,
  );
  const { announce } = useAnnouncer();
  const toast = useReviewToast();
  /**
   * Confirm an action on both channels. `announce` alone writes into an
   * `sr-only` live region, so a sighted reviewer saw nothing after approving or
   * merging — the frame raises a visible toast at exactly these moments.
   */
  const confirm = useCallback(
    (message: string) => {
      announce(message);
      toast.show(message);
    },
    [announce, toast],
  );

  const [sourceFilter, setSourceFilter] = useState<ReviewSourceFilter>("all");
  const [bucketFilter, setBucketFilter] = useState<keyof DeckSummary | null>(null);
  const [sort, setSort] = useState<ReviewQueueSort>("attention");
  const [mobileView, setMobileView] = useState<ReviewMobileView>("files");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<ReviewCheckpoint[] | null>(null);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [disclosures, setDisclosures] = useState<ReadonlySet<InspectorDisclosure>>(
    () => new Set(),
  );
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "changes" | "merge" | null>(null);
  const [preferences, patchPreferences] = useReviewPreferences();
  const inspectorRef = useRef<HTMLElement | null>(null);
  const panes = useReviewPanes();

  const deck = useReviewDeckModel({
    sessions: context.runtimeState.sessions,
    sourceFilter,
    bucketFilter,
    sort,
  });
  const { all: fullQueue, ordered, counts } = deck;

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
    () => fullQueue.find((item) => item.session.id === state.selectedSessionId) ?? null,
    [fullQueue, state.selectedSessionId],
  );
  const sessionPullRequest = selected?.session.pullRequest ?? null;
  const selectedPullRequest = useMemo(
    () =>
      sessionPullRequest?.number == null
        ? null
        : { repo: sessionPullRequest.repo, number: sessionPullRequest.number },
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
  const rawBlockers = useMemo(() => prBlockers(facts), [facts]);
  const blockers = useMemo(
    () =>
      triageBlockers(rawBlockers, {
        canResolveThreads: facts?.threads.canResolve ?? false,
      }),
    [facts?.threads.canResolve, rawBlockers],
  );
  const ready = isReadyToMerge(facts);
  const checks = useMemo(() => checksMeta(facts), [facts]);
  const selectedPullRequestUrl = prUrl(sessionPullRequest);
  const selectedBucket = selected ? cockpitBucket(deck.bucketOf(selected.session)) : null;
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
      revision: localReviewRevision(selected.session.updated_at, source.files),
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
        (file) => thread.where === file.path || thread.where.startsWith(`${file.path}:`),
      )?.path;
      if (path) countsByPath.set(path, (countsByPath.get(path) ?? 0) + 1);
    }
    return countsByPath;
  }, [facts?.threads.items, source.files]);

  const openFile = useMemo(
    () => source.files.find((file) => file.path === source.openPath) ?? null,
    [source.files, source.openPath],
  );
  const openThreads = useMemo(
    () =>
      (facts?.threads.items ?? []).filter(
        (thread) =>
          openFile != null &&
          (thread.where === openFile.path ||
            thread.where.startsWith(`${openFile.path}:`)),
      ),
    [facts?.threads.items, openFile],
  );

  const checklist = useMemo(
    () =>
      mergeChecklist(
        facts,
        workItem
          ? { reviewed: progress.reviewedCount, readable: progress.readableCount }
          : undefined,
      ),
    [facts, progress.readableCount, progress.reviewedCount, workItem],
  );

  const canAct = reviewActionsAvailable({
    sourceKind: source.kind,
    readinessPhase: readiness.phase,
    state: facts?.state,
    draft: facts?.draft,
  });

  const decision = useMemo(
    () =>
      reviewDecision({
        selected: Boolean(selected),
        isPr,
        draft: facts?.draft ?? false,
        ready,
        blockers,
        checksPending: checks.tone === "warning",
        mergeableUnknown: isPr && readiness.phase === "ready" && facts?.mergeable == null,
        reviewedCount: progress.reviewedCount,
        readableCount: progress.readableCount,
      }),
    [
      blockers,
      checks.tone,
      facts?.draft,
      facts?.mergeable,
      isPr,
      progress.readableCount,
      progress.reviewedCount,
      readiness.phase,
      ready,
      selected,
    ],
  );

  const note = selected ? (notes[selected.session.id] ?? "") : "";
  const setNote = useCallback(
    (value: string) => {
      if (!selected) return;
      const bounded = value.slice(0, GITHUB_REVIEW_BODY_MAX_LENGTH);
      setNotes((current) => ({ ...current, [selected.session.id]: bounded }));
      if (bounded.trim()) setNoteError(null);
    },
    [selected],
  );

  useEffect(() => {
    setNoteError(null);
    setActionError(null);
    setMobileView("files");
    toast.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear on selection change only
  }, [state.selectedSessionId]);

  // Checkpoints are read only when the drawer is opened — the list is a
  // filesystem walk, and nothing on the deck needs it until it is asked for.
  useEffect(() => {
    if (!checkpointsOpen || !projectRoot) return;
    let cancelled = false;
    setCheckpoints(null);
    setCheckpointsError(null);
    void (async () => {
      try {
        const response = await fetch(
          `/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`,
        );
        if (!response.ok) throw new Error("checkpoint request failed");
        const parsed = parseCheckpointEnvelope(await response.json());
        if (!cancelled) setCheckpoints(parsed);
      } catch {
        if (!cancelled) setCheckpointsError("Couldn't read checkpoints for this project.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkpointsOpen, projectRoot]);

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
      confirm(`Approved ${prLabel(selectedPullRequest)}. Re-reading GitHub state.`);
      readiness.refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, confirm, note, readiness, selectedPullRequest]);

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
      confirm(
        `Requested changes on ${prLabel(selectedPullRequest)}. Re-reading GitHub state.`,
      );
      readiness.refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, confirm, note, readiness, selectedPullRequest]);

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
      confirm(
        `Merged ${prLabel(selectedPullRequest)} (squash). It leaves the review queue on the next read.`,
      );
      readiness.refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
      return false;
    } finally {
      setBusy(null);
    }
  }, [announce, busy, confirm, readiness, ready, selectedPullRequest]);

  const toggleDisclosure = useCallback((id: InspectorDisclosure) => {
    setDisclosures((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const revealBlocker = useCallback(
    (reveal: "checks" | "threads") => {
      panes.setInspectorOpen(true);
      setMobileView("evidence");
      setDisclosures((current) => new Set(current).add(reveal));
      announce(
        reveal === "checks"
          ? "Opened the checks list in the inspector."
          : "Opened the review threads in the inspector.",
      );
    },
    [announce, panes],
  );

  const moveItem = useCallback(
    (direction: 1 | -1) => {
      const next = nextReviewItemId(
        ordered.map((entry) => entry.id),
        state.selectedSessionId,
        direction,
      );
      if (next) patch({ selectedSessionId: next });
    },
    [ordered, patch, state.selectedSessionId],
  );

  const markCurrentReviewed = useCallback(() => {
    const path = source.openPath;
    if (!path || !workItem) return;
    const result = progress.toggle(path);
    confirm(
      result.completed
        ? `Reviewed ${path}. Every readable file on head ${workItem.revision.slice(0, 7)} is reviewed.`
        : result.reviewed
          ? `Marked ${path} reviewed.`
          : `Marked ${path} unread.`,
    );
  }, [confirm, progress, source.openPath, workItem]);

  const openUnread = useCallback(
    (direction: 1 | -1) => {
      const path = progress.nextUnread(source.openPath, direction);
      if (!path) {
        // Nothing unread left: fall through to plain file traversal rather
        // than stranding the reader on the last file with a dead control.
        const paths = source.files.map((file) => file.path);
        if (paths.length < 2) {
          announce("Every readable file on this revision is reviewed.");
          return;
        }
        const current = source.openPath ? paths.indexOf(source.openPath) : -1;
        const next =
          paths[current < 0 ? 0 : (current + direction + paths.length) % paths.length];
        source.open(next);
        announce(`Moved to ${next}.`);
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
        const current = source.openPath ? paths.indexOf(source.openPath) : -1;
        const offset = action === "next-file" ? 1 : -1;
        const next =
          paths.length === 0
            ? null
            : paths[current < 0 ? 0 : (current + offset + paths.length) % paths.length];
        if (next) source.open(next);
        return;
      }
      if (action === "next-item" || action === "previous-item") {
        moveItem(action === "next-item" ? 1 : -1);
        return;
      }
      if (action === "toggle-files") {
        panes.toggleQueue();
        setMobileView("queue");
        return;
      }
      if (action === "toggle-evidence") {
        panes.toggleInspector();
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
  }, [markCurrentReviewed, moveItem, panes, source]);

  const refreshLabel = readiness.refreshing
    ? "refreshing…"
    : deck.loading
      ? "reading GitHub…"
      : readiness.checkedAt
        ? `checked ${relativeTime(new Date(readiness.checkedAt).toISOString())}`
        : "not checked";
  const position = Math.max(
    1,
    ordered.findIndex((entry) => entry.id === state.selectedSessionId) + 1,
  );
  const additions = facts?.additions ?? selected?.session.diff?.additions ?? 0;
  const deletions = facts?.deletions ?? selected?.session.diff?.deletions ?? 0;
  const hasNextUnread = progress.nextUnread(source.openPath, 1) != null;

  return (
    <div
      ref={panes.stageRef}
      className="rd-stage"
      data-mobile-view={mobileView}
      data-queue-open={panes.queueOpen ? "true" : undefined}
      data-inspector-open={panes.inspectorOpen ? "true" : undefined}
      style={{
        "--rd-queue-width": `${panes.queueWidth}px`,
        "--rd-inspector-width": `${panes.inspectorWidth}px`,
      } as React.CSSProperties}
    >
      <ReviewCockpitTopBar
        scope={counts.scope}
        total={fullQueue.length}
        summary={deck.summary}
        bucketFilter={bucketFilter}
        position={ordered.length === 0 ? 0 : position}
        navTotal={ordered.length}
        checkpointsAvailable={Boolean(projectRoot) && !isPr}
        refreshing={readiness.refreshing || deck.loading}
        refreshLabel={refreshLabel}
        onBucketFilter={(bucket) => {
          setBucketFilter(bucket);
          announce(
            bucket
              ? `Queue filtered to ${bucket === "awaiting" ? "needs review" : bucket}.`
              : "Queue filter cleared.",
          );
        }}
        onPreviousItem={() => moveItem(-1)}
        onNextItem={() => moveItem(1)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onOpenCheckpoints={() => setCheckpointsOpen(true)}
        onRefresh={readiness.refresh}
      />

      <ReviewMobileTabs
        view={mobileView}
        onView={(view) => {
          setMobileView(view);
          if (view === "evidence") panes.setInspectorOpen(true);
          if (view === "queue") panes.setQueueOpen(true);
        }}
      />

      <div className="rd-layout">
        {panes.queueOpen ? (
          <>
            <ReviewQueue
              groups={deck.groups}
              selectedId={state.selectedSessionId}
              sort={sort}
              sourceFilter={sourceFilter}
              total={ordered.length}
              mix={deck.mix}
              showEmptyGroups={bucketFilter == null && sourceFilter === "all"}
              footnote={deck.caption}
              emptyTitle={
                bucketFilter
                  ? "Nothing in this attention group."
                  : sourceFilter === "all"
                    ? "Queue clear"
                    : "Nothing matches this filter."
              }
              emptyHint={
                bucketFilter || sourceFilter !== "all"
                  ? "Verdicts move items between buckets live."
                  : "Sessions appear here when they carry a pull request, working changes, or a branch."
              }
              onSort={setSort}
              onSourceFilter={setSourceFilter}
              onSelect={(id) => {
                patch({ selectedSessionId: id });
                setMobileView("files");
              }}
              onCollapse={panes.toggleQueue}
              onClearFilters={() => {
                setBucketFilter(null);
                setSourceFilter("all");
              }}
            />
            <div
              className="rd-gutter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the queue"
              title="Drag to resize"
              onPointerDown={panes.dragQueue}
            />
          </>
        ) : null}

        <main className="rd-main">
          <ReviewWorkbenchHeader
            workItem={workItem}
            title={selected?.session.title || selected?.session.id || null}
            bucket={selectedBucket}
            reference={
              selectedPullRequest
                ? prLabel(selectedPullRequest)
                : (selected?.session.workBranch ??
                  selected?.session.git?.branch ??
                  null)
            }
            branchLine={
              facts
                ? `${facts.headRef} → ${facts.baseRef}`
                : (source.localBranch ??
                  selected?.session.git?.branch ??
                  null)
            }
            agent={selected?.session.model ?? null}
            age={selected ? relativeTime(selected.session.updated_at) : null}
            fileCount={source.filesTotal}
            additions={additions}
            deletions={deletions}
            sourceExplain={sourceExplain}
            pullRequestUrl={selectedPullRequestUrl}
            queueCollapsed={!panes.queueOpen}
            inspectorOpen={panes.inspectorOpen}
            shortcutsOpen={shortcutsOpen}
            onExpandQueue={panes.toggleQueue}
            onToggleInspector={panes.toggleInspector}
            onOpenPullRequest={() => {
              if (selectedPullRequestUrl) context.openUrl(selectedPullRequestUrl);
            }}
            onOpenSession={() => {
              if (selected) context.openSession(selected.session.id, familiarId);
            }}
            onCloseShortcuts={() => setShortcutsOpen(false)}
          />

          {selected && source.phase === "ready" && source.files.length > 0 ? (
            <ReviewFileRail
              files={source.files}
              filesShown={source.filesShown}
              filesTotal={source.filesTotal}
              openPath={source.openPath}
              capacity={fileChipCapacity(panes.centreWidth)}
              reviewed={progress.reviewed}
              reviewedCount={progress.reviewedCount}
              readableCount={progress.readableCount}
              commentCounts={commentCounts}
              canMarkReviewed={Boolean(
                workItem && openFile && openFile.noPatchReason == null,
              )}
              onOpen={source.open}
              onMarkReviewed={markCurrentReviewed}
            />
          ) : null}

          <ReviewDiffWorkbench
            selected={Boolean(selected)}
            workItem={workItem}
            source={source}
            openFile={openFile}
            threads={openThreads}
            selectedPrUrl={selectedPullRequestUrl}
            preferences={preferences}
            reviewedCount={progress.reviewedCount}
            readableCount={progress.readableCount}
            hasNextUnread={hasNextUnread}
            onOpenUrl={context.openUrl}
            onPreferences={patchPreferences}
            onNextUnread={() => openUnread(1)}
          />
        </main>

        {panes.inspectorOpen ? (
          <>
            <div
              className="rd-gutter"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the inspector"
              title="Drag to resize"
              onPointerDown={panes.dragInspector}
            />
            <ReviewInspector
              selected={Boolean(selected)}
              isPr={isPr}
              bucket={selectedBucket}
              decision={decision}
              blockers={blockers}
              checklist={checklist}
              checks={checks}
              facts={facts}
              readinessPhase={readiness.phase}
              readinessError={readiness.error}
              checkedLabel={refreshLabel}
              branch={
                facts?.headRef ??
                source.localBranch ??
                selected?.session.git?.branch ??
                null
              }
              pullRequestLabel={prLabel(sessionPullRequest)}
              updatedLabel={selected ? relativeTime(selected.session.updated_at) : null}
              sourceLabel={sourceLabel}
              sourceExplain={sourceExplain}
              note={note}
              noteError={noteError}
              openDisclosures={disclosures}
              focusRef={inspectorRef}
              onToggleDisclosure={toggleDisclosure}
              onRevealBlocker={revealBlocker}
              onOpenBlockerUrl={context.openUrl}
              onNote={setNote}
              onCollapse={panes.toggleInspector}
              verdictDock={
                <ReviewVerdictDock
                  selectionKey={selectedScope}
                  selected={Boolean(selected)}
                  isPr={isPr}
                  facts={facts}
                  canAct={canAct}
                  ready={ready}
                  blockers={blockers}
                  checklist={checklist}
                  busy={busy}
                  actionError={actionError}
                  note={note}
                  noteError={noteError}
                  checkpoints={checkpoints}
                  checkpointsOpen={checkpointsOpen}
                  checkpointsError={checkpointsError}
                  onNote={setNote}
                  onApprove={approve}
                  onRequestChanges={requestChanges}
                  onMerge={merge}
                  onSkip={() => moveItem(1)}
                  onCloseCheckpoints={() => setCheckpointsOpen(false)}
                />
              }
            />
          </>
        ) : null}
      </div>

      <ReviewToast message={toast.message} />
    </div>
  );
}

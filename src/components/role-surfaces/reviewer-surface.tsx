"use client";

/**
 * Reviewer Surface — the Review Deck.
 *
 * Change review over the familiar's real work, laid out as a tri-pane deck.
 *
 * The rule the deck is built around: **the review source is decided by the
 * session, never by which fetch resolved first.** A session with a linked pull
 * request is reviewed as that pull request's diff, read from GitHub; only a
 * session with no pull request falls back to its project's uncommitted work.
 * Pull-request actions gate on the source, so the deck can never offer Approve
 * or Squash & merge while a local working tree is on screen.
 *
 * A summary strip counts the deck into four exclusive buckets read from live
 * GitHub state, each one a filter. Left: the review queue. Center: a file
 * navigator over a colored unified diff, with a verdict bar that dispatches
 * approve / request-changes / merge to the real GitHub routes. Right: PR
 * readiness — one verdict plus blockers written in plain words, each naming who
 * clears it — session facts, and a note for the familiar. Footer: the deck's
 * saved checkpoints for the selected root.
 *
 * The deck never edits the working tree, never applies a checkpoint, and never
 * infers a GitHub fact it did not read: `mergeable: null` reports as unknown,
 * and a pull request whose state hasn't been read stays out of the counts.
 */

import "@/styles/review-deck.css";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useAnnouncer } from "@/components/ui/live-region";
import { Icon } from "@/lib/icon";
import type { RoleSurfaceContext } from "@/lib/role-surfaces";
import { useRoleSurfaceState } from "@/lib/role-surface-state";
import { relativeTime } from "@/lib/relative-time";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/settings-controls";
import {
  createReviewRequestGate,
  diffStatLabel,
  parseCheckpointEnvelope,
  parseDiffLines,
  prLabel,
  prUrl,
  reviewQueue,
  type ReviewCheckpoint,
} from "./review-deck";
import {
  checksMeta,
  DECK_BUCKETS,
  deckSummary,
  draftChangeRequest,
  evidenceItems,
  failingCheckNames,
  isReadyToMerge,
  mergeChecklist,
  prBlockers,
  readinessBanner,
  reviewBucket,
  reviewStateMeta,
  type DeckSummary,
} from "./review-readiness";
import { noPatchCopy } from "./review-file-tree";
import { ReviewFileNavigator, ReviewFileSpine } from "./review-file-navigator";
import { prKey, useDeckBuckets } from "./use-deck-buckets";
import { usePrReadiness } from "./use-pr-readiness";
import { useReviewSource } from "./use-review-source";
import { SurfaceEmpty, SurfaceError, SurfaceLoading } from "./surface-room";
import { REVIEWER_SURFACE_ID } from "./ids";

/** Queue size plus the scope and pressure the room header shows as status chips. */
export type ReviewDeckCounts = {
  queue: number;
  pullRequests: number;
  /** "owner/repo → main", or how many repos when the deck spans more than one. */
  scope: string | null;
  /** How long the longest-waiting item has been waiting. */
  oldest: string | null;
};

export type ReviewerState = {
  selectedSessionId: string | null;
  drawerOpen: boolean;
  /** Latest queue counts — read by the registration manifest's status chips. */
  lastCounts: ReviewDeckCounts | null;
};

export const REVIEWER_INITIAL_STATE: ReviewerState = {
  selectedSessionId: null,
  drawerOpen: false,
  lastCounts: null,
};

type SourceFilter = "all" | "prs" | "local";

const SOURCE_FILTERS: readonly SourceFilter[] = ["all", "prs", "local"];
const SOURCE_FILTER_LABELS: Record<SourceFilter, string> = { all: "All", prs: "PRs", local: "Local" };

const BUCKET_LABELS: Record<keyof DeckSummary, string> = {
  awaiting: "Awaiting review",
  changes: "Changes requested",
  blocked: "Blocked",
  ready: "Ready to merge",
};
const BUCKET_TONES: Record<keyof DeckSummary, string> = {
  awaiting: "accent",
  changes: "warning",
  blocked: "danger",
  ready: "success",
};
const BUCKET_TITLES: Record<keyof DeckSummary, string> = {
  awaiting: "Review material with no approving review on GitHub.",
  changes: "A standing review on GitHub requests changes.",
  blocked: "Open, non-draft pull requests GitHub will not merge yet.",
  ready: "Approved, and GitHub reports the branch clean against its base.",
};

/** How many evidence chips the composer shows before it needs expanding. */
const EVIDENCE_PREVIEW = 2;

export function ReviewerSurface({ context }: { context: RoleSurfaceContext }) {
  const familiar = context.activeFamiliar;
  const familiarId = familiar.id;
  const [state, patch] = useRoleSurfaceState<ReviewerState>(familiarId, REVIEWER_SURFACE_ID, REVIEWER_INITIAL_STATE);
  const { announce } = useAnnouncer();

  // Ephemeral view state — collapse, filters, and the reviewer's note live for
  // the visit; only the selection and the checkpoints drawer persist.
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [bucketFilter, setBucketFilter] = useState<keyof DeckSummary | null>(null);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [headOpen, setHeadOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [factsOpen, setFactsOpen] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteError, setNoteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "changes" | "merge" | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [evidenceOff, setEvidenceOff] = useState<Record<string, boolean>>({});
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  const readinessRef = useRef<HTMLElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // ── The review queue: real sessions with review material ──────────────────
  const fullQueue = useMemo(() => reviewQueue(context.runtimeState.sessions), [context.runtimeState.sessions]);

  const queuePullRequests = useMemo(
    () =>
      fullQueue
        .map((item) => item.session.pullRequest)
        .filter((pr): pr is { repo: string; number: number } => pr?.number != null)
        .map((pr) => ({ repo: pr.repo, number: pr.number })),
    [fullQueue],
  );
  const deckBuckets = useDeckBuckets(queuePullRequests);

  const bucketOf = useCallback(
    (session: { pullRequest?: { repo: string; number?: number } | null }) => {
      const pr = session.pullRequest;
      if (pr?.number == null) return reviewBucket(null, false);
      return reviewBucket(deckBuckets.facts.get(prKey({ repo: pr.repo, number: pr.number })), true);
    },
    [deckBuckets.facts],
  );

  const summary = useMemo(() => deckSummary(fullQueue.map((item) => bucketOf(item.session))), [fullQueue, bucketOf]);

  const queue = useMemo(
    () =>
      fullQueue.filter((item) => {
        const hasPr = item.session.pullRequest?.number != null;
        if (sourceFilter === "prs" && !hasPr) return false;
        if (sourceFilter === "local" && hasPr) return false;
        if (bucketFilter && bucketOf(item.session) !== bucketFilter) return false;
        return true;
      }),
    [fullQueue, sourceFilter, bucketFilter, bucketOf],
  );

  // ── Deck scope and pressure, published to the room header ─────────────────
  const counts = useMemo<ReviewDeckCounts>(() => {
    const repos = [...new Set(queuePullRequests.map((pr) => pr.repo))];
    const bases = [
      ...new Set(
        queuePullRequests
          .map((pr) => deckBuckets.facts.get(prKey(pr))?.baseRef)
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
    const scope = repoScope && bases.length === 1 ? `${repoScope} → ${bases[0]}` : repoScope;
    // reviewQueue sorts newest first, so the deck's longest wait is last.
    const oldest = fullQueue.at(-1)?.session ?? null;
    return {
      queue: fullQueue.length,
      pullRequests: queuePullRequests.length,
      scope,
      oldest: oldest ? relativeTime(oldest.updated_at) : null,
    };
  }, [fullQueue, queuePullRequests, deckBuckets.facts]);

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
  }, [counts, state.lastCounts, patch]);

  // ── Selection ─────────────────────────────────────────────────────────────
  const selected = useMemo(
    () => fullQueue.find((item) => item.session.id === state.selectedSessionId) ?? null,
    [fullQueue, state.selectedSessionId],
  );
  const sessionPr = selected?.session.pullRequest ?? null;
  const selectedPr = useMemo(
    () => (sessionPr?.number != null ? { repo: sessionPr.repo, number: sessionPr.number } : null),
    [sessionPr],
  );
  const projectRoot = selected?.session.project_root ?? null;
  const selectedScope = `${familiarId}:${selected?.session.id ?? "none"}:${projectRoot ?? "none"}`;

  // The note, the composer, and any dispatch error are scoped to the selected
  // session — a note typed for one workload can never ride along on a verdict
  // dispatched to another's pull request.
  useEffect(() => {
    setNoteError(null);
    setActionError(null);
    setChangesOpen(false);
    setMergeOpen(false);
    setEvidenceOff({});
    setDetailOpen(false);
    setThreadsOpen(false);
  }, [state.selectedSessionId]);

  // ── The review source, and GitHub's state for it ──────────────────────────
  const source = useReviewSource({ pr: selectedPr, projectRoot, scope: selectedScope });
  const readiness = usePrReadiness(selectedPr);
  const facts = readiness.facts;
  const isPr = source.kind === "pull-request";
  const blockers = useMemo(() => prBlockers(facts), [facts]);
  const ready = isReadyToMerge(facts);
  const banner = useMemo(() => readinessBanner(facts, blockers), [facts, blockers]);
  const checks = useMemo(() => checksMeta(facts), [facts]);
  const evidence = useMemo(() => evidenceItems(facts), [facts]);
  const keptEvidence = useMemo(() => evidence.filter((item) => !evidenceOff[item.key]), [evidence, evidenceOff]);

  const note = selected ? (notes[selected.session.id] ?? "") : "";
  const setNote = useCallback(
    (next: string) => {
      if (!selected) return;
      setNotes((prev) => ({ ...prev, [selected.session.id]: next }));
      if (next.trim()) setNoteError(null);
    },
    [selected],
  );

  // ── Saved checkpoints for the selected root (footer) ──────────────────────
  const [checkpoints, setCheckpoints] = useState<ReviewCheckpoint[] | null>(null);
  const [checkpointError, setCheckpointError] = useState<string | null>(null);
  const checkpointRequests = useRef(createReviewRequestGate());
  const latestSelectedScope = useRef(selectedScope);
  latestSelectedScope.current = selectedScope;
  const loadCheckpoints = useCallback(async () => {
    const request = checkpointRequests.current.begin(selectedScope);
    setCheckpoints(null);
    setCheckpointError(null);
    if (!projectRoot || !state.drawerOpen) return;
    try {
      const res = await fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot)}&checkpoints=1`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("checkpoint request failed");
      const json = await res.json();
      if (!checkpointRequests.current.isCurrent(request, latestSelectedScope.current)) return;
      setCheckpoints(parseCheckpointEnvelope(json));
    } catch {
      if (!checkpointRequests.current.isCurrent(request, latestSelectedScope.current)) return;
      setCheckpointError("Couldn't load checkpoints.");
      setCheckpoints(null);
    }
  }, [projectRoot, selectedScope, state.drawerOpen]);
  useEffect(() => {
    void loadCheckpoints();
    return () => checkpointRequests.current.invalidate();
  }, [loadCheckpoints]);

  // ── Verdict dispatch — real GitHub review + merge routes ──────────────────
  // A pull-request action may never ride on a local diff: this gates on the
  // review source and GitHub's state, not on what the queue row happens to say.
  const canAct = isPr && readiness.phase === "ready" && facts?.state === "open" && !facts.draft;

  const approve = useCallback(async () => {
    if (!canAct || !selectedPr || busy) return;
    setBusy("approve");
    setActionError(null);
    try {
      const res = await fetch("/api/github/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selectedPr.repo, number: selectedPr.number, event: "APPROVE", body: note.trim() }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!json?.ok) throw new Error(json?.error || "review failed");
      announce(`Approved ${prLabel(selectedPr)}. Re-reading GitHub state.`);
      readiness.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, note, readiness, selectedPr]);

  const sendChangeRequest = useCallback(async () => {
    if (!canAct || !selectedPr || busy) return;
    const body = note.trim();
    if (!body) {
      setNoteError("A note is required — GitHub sends it to the familiar as the review body.");
      announce("Write or draft a note before requesting changes.", "assertive");
      composerRef.current?.focus();
      return;
    }
    setChangesOpen(false);
    setBusy("changes");
    setActionError(null);
    setNoteError(null);
    try {
      const res = await fetch("/api/github/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selectedPr.repo, number: selectedPr.number, event: "REQUEST_CHANGES", body }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!json?.ok) throw new Error(json?.error || "review failed");
      announce(`Requested changes on ${prLabel(selectedPr)}. Re-reading GitHub state.`);
      readiness.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
    } finally {
      setBusy(null);
    }
  }, [announce, busy, canAct, note, readiness, selectedPr]);

  const confirmMerge = useCallback(async () => {
    if (!ready || !selectedPr || busy) return;
    setMergeOpen(false);
    setBusy("merge");
    setActionError(null);
    try {
      const res = await fetch("/api/github/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: selectedPr.repo, number: selectedPr.number, method: "squash" }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!json?.ok) throw new Error(json?.error || "merge failed");
      announce(`Merged ${prLabel(selectedPr)} (squash). It leaves the review queue on the next read.`);
      readiness.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't reach GitHub.";
      setActionError(message);
      announce(message, "assertive");
    } finally {
      setBusy(null);
    }
  }, [announce, busy, ready, readiness, selectedPr]);

  const focusBlockers = useCallback(() => {
    setRailCollapsed(false);
    // The rail may still be collapsed this tick; focus once it has painted.
    requestAnimationFrame(() => readinessRef.current?.focus());
    announce("Moved to PR readiness — blockers are listed there.");
  }, [announce]);

  const toggleBucket = useCallback(
    (bucket: keyof DeckSummary) => {
      setBucketFilter((prev) => {
        const next = prev === bucket ? null : bucket;
        announce(next ? `Queue filtered to ${BUCKET_LABELS[next].toLowerCase()}.` : "Queue filter cleared.");
        return next;
      });
    },
    [announce],
  );

  const draft = useCallback(() => {
    if (!facts) return;
    if (keptEvidence.length === 0) {
      setNoteError("Keep at least one piece of evidence, or write the note yourself.");
      return;
    }
    setNote(draftChangeRequest(`${facts.repo}#${facts.number}`, keptEvidence));
    setNoteError(null);
    announce("Draft composed from this pull request's blockers — edit it before sending.");
  }, [announce, facts, keptEvidence, setNote]);

  // ── Derived view models ───────────────────────────────────────────────────
  const diffLines = useMemo(
    () => (source.openPatch.text ? parseDiffLines(source.openPatch.text) : []),
    [source.openPatch.text],
  );
  const openFile = useMemo(
    () => source.files.find((file) => file.path === source.openPath) ?? null,
    [source.files, source.openPath],
  );
  const noPatch = openFile ? noPatchCopy(openFile.noPatchReason) : null;
  const selectedPrUrl = prUrl(sessionPr);
  const deckTotal = fullQueue.length;
  const sourceLabel = !selected ? "No session" : isPr ? "Pull request diff" : "Local working tree";
  const sourceExplain = !selected
    ? "Pick a session in the queue to read what it changed."
    : isPr
      ? "Files come from GitHub for this pull request — not from this machine's working tree."
      : "No pull request is linked, so this is the session project's uncommitted work. Pull-request actions stay unavailable until a PR exists.";

  const mergeDisabled = !ready || busy != null;
  const mergeTitle = !isPr
    ? "A pull request is required to merge."
    : facts?.draft
      ? "Draft pull requests can't be merged."
      : blockers.length > 0
        ? `Blocked: ${blockers.map((blocker) => blocker.title).join(" · ")}`
        : ready
          ? "Squash-merge — asks for confirmation first"
          : "Waiting on GitHub before a merge is safe.";

  const verdictTone =
    facts?.latestReview?.state === "APPROVED"
      ? "success"
      : facts?.latestReview?.state === "CHANGES_REQUESTED"
        ? "warning"
        : "muted";

  return (
    <div className="rd-stage">
      {/* ── Summary strip: one hairline-divided bar; each segment filters the queue ── */}
      <div className="rd-summary" role="group" aria-label="Deck summary">
        {DECK_BUCKETS.map((bucket) => {
          const value = summary[bucket];
          const share = deckTotal === 0 ? 0 : Math.round((value / deckTotal) * 100);
          const active = bucketFilter === bucket;
          return (
            <button
              key={bucket}
              type="button"
              className="rd-stat focus-ring-inset"
              data-tone={BUCKET_TONES[bucket]}
              data-active={active ? "true" : undefined}
              data-empty={value === 0 ? "true" : undefined}
              aria-pressed={active}
              title={`${BUCKET_TITLES[bucket]} ${value} of ${deckTotal} on the deck. Click to filter the queue.`}
              onClick={() => toggleBucket(bucket)}
            >
              <span className="rd-stat-head">
                <span className="rd-stat-dot" aria-hidden />
                <span className="rd-stat-label">{BUCKET_LABELS[bucket]}</span>
              </span>
              <span className="rd-stat-body">
                <span className="rd-stat-value">{value}</span>
                <span className="rd-stat-share">{value === 0 ? "—" : `${share}%`}</span>
              </span>
              <span className="rd-stat-track" aria-hidden>
                <span className="rd-stat-fill" style={{ "--rd-share": `${share}%` } as CSSProperties} />
              </span>
            </button>
          );
        })}
      </div>
      <div className="rd-summary-caption">
        <span>
          {deckBuckets.skipped > 0
            ? `counts from PR state when available · ${deckBuckets.skipped} beyond the read cap uncounted`
            : "counts from PR state when available · drafts & unread PRs excluded"}
        </span>
        <span className="rd-spacer" />
        <span>
          {readiness.refreshing
            ? "refreshing…"
            : deckBuckets.loading
              ? "reading GitHub…"
              : readiness.checkedAt
                ? `checked ${relativeTime(new Date(readiness.checkedAt).toISOString())}`
                : ""}
        </span>
      </div>

      {/* ── Tri-pane ── */}
      <div
        className="rd-grid"
        data-left={queueCollapsed ? "collapsed" : undefined}
        data-right={railCollapsed ? "collapsed" : undefined}
      >
        {/* ── Left: review queue ── */}
        {queueCollapsed ? (
          <button
            type="button"
            className="rd-panel rd-collapsed focus-ring-inset"
            title="Expand review queue"
            onClick={() => setQueueCollapsed(false)}
          >
            <span className="rd-collapsed-icon">
              <Icon name="ph:sidebar-simple" width={16} height={16} aria-hidden />
            </span>
            <span className="rd-collapsed-badge">{deckTotal}</span>
            <span className="rd-collapsed-label">Review queue</span>
          </button>
        ) : (
          <section className="rd-panel rd-queue" aria-label="Review queue">
            <div className="rd-queue-head">
              <div className="rd-queue-head-row">
                <span className="rd-eyebrow">Review queue</span>
                <span className="rd-count">{queue.length}</span>
                <span className="rd-spacer" />
                {bucketFilter ? (
                  <button
                    type="button"
                    className="rd-bucket-chip focus-ring"
                    title="Clear this filter"
                    onClick={() => toggleBucket(bucketFilter)}
                  >
                    {BUCKET_LABELS[bucketFilter].toLowerCase()}
                    <Icon name="ph:x" width={9} height={9} aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rd-icon-btn focus-ring"
                  title="Collapse queue"
                  aria-label="Collapse review queue"
                  onClick={() => setQueueCollapsed(true)}
                >
                  <Icon name="ph:sidebar-simple" width={14} height={14} aria-hidden />
                </button>
              </div>
              <Segmented
                options={SOURCE_FILTERS}
                value={sourceFilter}
                onChange={setSourceFilter}
                getLabel={(option) => SOURCE_FILTER_LABELS[option]}
                ariaLabel="Filter review queue by source"
              />
            </div>
            <div className="rd-queue-list rd-scroll">
              {queue.length === 0 ? (
                <SurfaceEmpty
                  iconName="ph:check-circle-fill"
                  title={
                    bucketFilter
                      ? "Nothing in this bucket."
                      : sourceFilter === "all"
                        ? "Deck clear."
                        : "Nothing matches this filter."
                  }
                  hint={
                    bucketFilter
                      ? "Clear the filter above to see the rest of the queue."
                      : sourceFilter === "all"
                        ? "Sessions appear here when they carry a pull request or uncommitted changes."
                        : "Try All — the other filter may still have items."
                  }
                />
              ) : (
                <ul className="role-surface-list" aria-label="Sessions to review">
                  {queue.map((item) => {
                    const pr = item.session.pullRequest;
                    const hasPr = pr?.number != null;
                    const rowFacts =
                      pr && pr.number != null
                        ? deckBuckets.facts.get(prKey({ repo: pr.repo, number: pr.number }))
                        : null;
                    const stat = reviewStateMeta(rowFacts, {
                      hasPullRequest: hasPr,
                      hasLocalChanges: (item.session.diff?.additions ?? 0) + (item.session.diff?.deletions ?? 0) > 0,
                    });
                    const active = item.session.id === state.selectedSessionId;
                    return (
                      <li key={item.session.id}>
                        <button
                          type="button"
                          className="rd-row focus-ring-inset"
                          data-active={active ? "true" : undefined}
                          aria-current={active ? "true" : undefined}
                          title={`${item.session.title || item.session.id} — ${hasPr ? "reviewed as the GitHub pull-request diff" : "reviewed as the local working tree"}`}
                          onClick={() => patch({ selectedSessionId: item.session.id })}
                        >
                          <span className="rd-row-top">
                            <Icon
                              name={hasPr ? "ph:git-pull-request" : "ph:git-diff"}
                              width={11}
                              height={11}
                              aria-hidden
                            />
                            <span className="rd-row-ref">
                              {hasPr ? prLabel(pr) : (item.session.git?.branch ?? "local changes")}
                            </span>
                            <span className="rd-spacer" />
                            <span className="rd-pill" data-tone={stat.tone} title={stat.title}>
                              {stat.label}
                            </span>
                          </span>
                          <span className="rd-row-title">{item.session.title || item.session.id}</span>
                          <span className="rd-row-meta">
                            <span className="rd-add">+{item.session.diff?.additions ?? 0}</span>
                            <span className="rd-del">−{item.session.diff?.deletions ?? 0}</span>
                            <span className="rd-spacer" />
                            <span>{relativeTime(item.session.updated_at)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* ── Center: change viewer ── */}
        <section className="rd-panel rd-viewer" aria-label="Change viewer">
          <div className="rd-viewer-head" data-open={headOpen ? "true" : undefined}>
            <button
              type="button"
              className="rd-viewer-head-toggle focus-ring"
              aria-expanded={headOpen}
              aria-controls="rd-review-header"
              title={headOpen ? "Collapse review header" : "Expand review header"}
              onClick={() => setHeadOpen((open) => !open)}
            >
              <span className="rd-viewer-caret" data-open={headOpen ? "true" : undefined} aria-hidden>
                <Icon name="ph:caret-right" width={13} height={13} />
              </span>
              {headOpen ? (
                <span className="rd-viewer-head-open">
                  <span className="rd-viewer-head-title">
                    <span className="rd-eyebrow">Under review</span>
                    <span className="rd-viewer-title">
                      {selected ? selected.session.title || selected.session.id : "No session selected"}
                    </span>
                  </span>
                  <span className="rd-pill rd-pill--lg" data-tone={isPr ? "accent" : "warning"}>
                    <Icon name={isPr ? "ph:git-pull-request" : "ph:git-branch"} width={12} height={12} aria-hidden />
                    {sourceLabel}
                  </span>
                </span>
              ) : (
                <span className="rd-viewer-head-compact">
                  <span className="rd-pill" data-tone={isPr ? "accent" : "warning"}>
                    <Icon name={isPr ? "ph:git-pull-request" : "ph:git-branch"} width={11} height={11} aria-hidden />
                    {isPr ? "PR diff" : "Local tree"}
                  </span>
                  <span className="rd-viewer-title rd-viewer-title--compact">
                    {selected ? selected.session.title || selected.session.id : "No session selected"}
                  </span>
                  <span className="rd-spacer" />
                  <span className="rd-add">+{facts?.additions ?? selected?.session.diff?.additions ?? 0}</span>
                  <span className="rd-del">−{facts?.deletions ?? selected?.session.diff?.deletions ?? 0}</span>
                </span>
              )}
            </button>
            {headOpen ? (
              <div id="rd-review-header" className="rd-viewer-facts">
                <div className="rd-viewer-fact-row">
                  {isPr && facts ? (
                    <>
                      <span title="Pull request the diff was read from">
                        <Icon name="ph:git-pull-request" width={11} height={11} aria-hidden />
                        {facts.repo}#{facts.number}
                      </span>
                      <span title="Base ← head">
                        <Icon name="ph:git-branch" width={11} height={11} aria-hidden />
                        {facts.baseRef} ← {facts.headRef}
                      </span>
                      <span title="Head commit the diff and checks describe">
                        <Icon name="ph:git-commit" width={11} height={11} aria-hidden />
                        head {facts.headSha.slice(0, 7)}
                      </span>
                      <span title="GitHub's own diffstat for the pull request">
                        <Icon name="ph:files" width={11} height={11} aria-hidden />
                        {facts.changedFiles} files · +{facts.additions} −{facts.deletions}
                      </span>
                    </>
                  ) : selected ? (
                    <>
                      <span title="Branch checked out in the session project">
                        <Icon name="ph:git-branch" width={11} height={11} aria-hidden />
                        {source.localBranch ?? selected.session.git?.branch ?? "—"}
                      </span>
                      <span title="Working-tree diffstat">
                        <Icon name="ph:git-diff" width={11} height={11} aria-hidden />
                        {diffStatLabel(selected.session.diff)} uncommitted
                      </span>
                      <span title="Nothing to approve or merge yet">
                        <Icon name="ph:git-pull-request" width={11} height={11} aria-hidden />
                        no pull request
                      </span>
                    </>
                  ) : null}
                </div>
                <p className="rd-viewer-explain">{sourceExplain}</p>
              </div>
            ) : null}
          </div>

          {/* file navigator + diff */}
          <div className="rd-viewer-split">
            {selected && source.phase === "ready" && source.files.length > 0 ? (
              navCollapsed ? (
                <ReviewFileSpine
                  files={source.files}
                  openPath={source.openPath}
                  filtered={false}
                  truncated={source.filesShown < source.filesTotal}
                  onExpand={() => setNavCollapsed(false)}
                />
              ) : (
                <ReviewFileNavigator
                  files={source.files}
                  filesShown={source.filesShown}
                  filesTotal={source.filesTotal}
                  openPath={source.openPath}
                  onOpen={source.open}
                  onCollapse={() => setNavCollapsed(true)}
                />
              )
            ) : null}

            <div className="rd-diff-column">
              {openFile ? (
                <div className="rd-diff-head">
                  <span className="rd-diff-status" data-status={openFile.status}>
                    {openFile.status}
                  </span>
                  <span className="rd-diff-path" title={openFile.path}>
                    {openFile.path}
                  </span>
                  <span className="rd-spacer" />
                  <span className="rd-add">+{openFile.additions}</span>
                  <span className="rd-del">−{openFile.deletions}</span>
                  {selectedPrUrl ? (
                    <a
                      className="rd-diff-link"
                      href={`${selectedPrUrl}/files`}
                      onClick={(e) => {
                        e.preventDefault();
                        context.openUrl(`${selectedPrUrl}/files`);
                      }}
                    >
                      <Icon name="ph:arrow-square-out" width={11} height={11} aria-hidden />
                      On GitHub
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div className="rd-diff rd-scroll">
                {!selected ? (
                  <SurfaceEmpty
                    iconName="ph:git-diff"
                    title="Pick a session from the queue."
                    hint="Linked pull requests are read from GitHub; sessions with only local changes show their working tree."
                  />
                ) : source.phase === "loading" ? (
                  <SurfaceLoading label={isPr ? "Reading the pull request diff…" : "Reading the working tree…"} />
                ) : source.phase === "error" ? (
                  <SurfaceError
                    title={source.error ?? "Couldn't read the change."}
                    hint="Nothing was approved or merged. Retry, or open the pull request on GitHub."
                    onRetry={source.retry}
                  />
                ) : source.files.length === 0 ? (
                  <SurfaceEmpty
                    iconName="ph:check"
                    title={isPr ? "This pull request changes no files." : "No working changes"}
                    hint={
                      isPr
                        ? "GitHub returned an empty file list for this pull request."
                        : "This workload landed clean — nothing left in the working tree to diff."
                    }
                  />
                ) : noPatch ? (
                  <div className="rd-nopatch" role="status">
                    <span className="rd-nopatch-title">
                      <Icon name="ph:file-text" width={14} height={14} aria-hidden />
                      {noPatch.title}
                    </span>
                    <span className="rd-nopatch-hint">{noPatch.hint}</span>
                    {selectedPrUrl ? (
                      <a
                        href={`${selectedPrUrl}/files`}
                        onClick={(e) => {
                          e.preventDefault();
                          context.openUrl(`${selectedPrUrl}/files`);
                        }}
                      >
                        <Icon name="ph:github-logo" width={12} height={12} aria-hidden />
                        Open the file on GitHub
                      </a>
                    ) : null}
                  </div>
                ) : source.openPatch.phase === "loading" ? (
                  <SurfaceLoading label="Loading diff…" />
                ) : source.openPatch.phase === "error" ? (
                  <SurfaceError
                    title={source.openPatch.error ?? "Couldn't load the diff."}
                    hint="Check the file, then retry."
                    onRetry={() => source.openPath && source.open(source.openPath)}
                  />
                ) : diffLines.length === 0 ? (
                  <SurfaceEmpty title="No diff to show." />
                ) : (
                  <>
                    {source.truncated || source.openPatch.truncated ? (
                      <p className="rd-diff-trunc" role="status">
                        Patch truncated server-side at the route's per-file budget — the tail isn't shown.
                      </p>
                    ) : null}
                    {diffLines.map((line, i) => (
                      <div key={i} className="rd-diff-line" data-kind={line.kind}>
                        <span className="rd-diff-mark" data-kind={line.kind} aria-hidden>
                          {line.mark}
                        </span>
                        <span className="rd-diff-text">{line.text}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Verdict bar ── */}
          <div className="rd-verdict-bar">
            <div className="rd-verdict-lead">
              <span className="rd-eyebrow">Verdict</span>
              <span
                className="rd-pill"
                data-tone={verdictTone}
                title="Latest submitted review on GitHub — never this visit's clicks."
              >
                <Icon
                  name={
                    facts?.latestReview?.state === "APPROVED"
                      ? "ph:seal-check"
                      : facts?.latestReview?.state === "CHANGES_REQUESTED"
                        ? "ph:arrow-bend-up-left"
                        : "ph:circle-dashed"
                  }
                  width={12}
                  height={12}
                  aria-hidden
                />
                {!selected
                  ? "no session selected"
                  : !isPr
                    ? "no linked pull request"
                    : facts?.latestReview
                      ? `${facts.latestReview.state === "APPROVED" ? "Approved" : "Changes requested"} · @${facts.latestReview.author}`
                      : "No review yet"}
              </span>
              {blockers.length > 0 ? (
                <button type="button" className="rd-blocker-chip focus-ring" onClick={focusBlockers}>
                  <Icon name="ph:warning-circle-fill" width={12} height={12} aria-hidden />
                  {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
                </button>
              ) : null}
              {actionError ? <span className="rd-error">{actionError}</span> : null}
            </div>
            <span className="rd-spacer" />
            {canAct ? (
              <div className="rd-verdict-actions">
                <button
                  type="button"
                  className="rd-btn rd-btn--changes focus-ring"
                  disabled={busy != null}
                  title="Compose a change request — evidence, draft, and send"
                  aria-haspopup="dialog"
                  onClick={() => setChangesOpen(true)}
                >
                  <Icon name="ph:arrow-bend-up-left" width={14} height={14} aria-hidden />
                  {busy === "changes" ? "Requesting…" : "Request changes"}
                </button>
                <button
                  type="button"
                  className="rd-btn rd-btn--approve focus-ring"
                  disabled={busy != null}
                  title="Submit an approving review on GitHub"
                  onClick={() => void approve()}
                >
                  <Icon name="ph:seal-check" width={14} height={14} aria-hidden />
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  className="rd-btn rd-btn--merge focus-ring"
                  disabled={mergeDisabled}
                  title={mergeTitle}
                  aria-haspopup="dialog"
                  onClick={() => setMergeOpen(true)}
                >
                  <Icon name="ph:git-merge" width={14} height={14} aria-hidden />
                  {busy === "merge" ? "Merging…" : "Squash & merge"}
                </button>
              </div>
            ) : selected ? (
              <span className="rd-verdict-why">
                {!isPr
                  ? "Approve, request changes, and merge are GitHub actions — this session has no pull request, so the deck offers none."
                  : facts?.draft
                    ? "This pull request is a draft. Verdicts count once the author marks it ready."
                    : "Actions are held until the pull request's state loads."}
              </span>
            ) : null}
          </div>
        </section>

        {/* ── Right: context rail ── */}
        {railCollapsed ? (
          <button
            type="button"
            className="rd-panel rd-collapsed focus-ring-inset"
            title="Expand context"
            onClick={() => setRailCollapsed(false)}
          >
            <span className="rd-collapsed-icon">
              <Icon name="ph:sidebar-simple" width={16} height={16} aria-hidden />
            </span>
            <span className="rd-collapsed-badge">{blockers.length}</span>
            <span className="rd-collapsed-label">Context</span>
          </button>
        ) : (
          <div className="rd-context rd-scroll">
            <section className="rd-panel rd-card rd-identity">
              <button
                type="button"
                className="rd-icon-btn focus-ring"
                title="Collapse context"
                aria-label="Collapse context"
                onClick={() => setRailCollapsed(true)}
              >
                <Icon name="ph:sidebar-simple" width={15} height={15} aria-hidden />
              </button>
              <div className="rd-identity-body">
                <div className="rd-identity-name-row">
                  <span className="rd-identity-name">{familiar.display_name}</span>
                  <span className="rd-presence" aria-hidden />
                </div>
                <div className="rd-identity-role">{familiar.role || "familiar"} · reviewer lane</div>
              </div>
            </section>

            {/* ── PR readiness ── */}
            <section
              className="rd-panel rd-card rd-readiness"
              aria-label="Pull request readiness"
              ref={readinessRef}
              tabIndex={-1}
            >
              <div className="rd-card-head">
                <span className="rd-eyebrow">PR readiness</span>
                <span className="rd-spacer" />
                <span className="rd-checked">
                  {readiness.refreshing
                    ? "reading…"
                    : readiness.checkedAt
                      ? relativeTime(new Date(readiness.checkedAt).toISOString())
                      : ""}
                </span>
                <button
                  type="button"
                  className="rd-icon-btn focus-ring"
                  aria-label="Refresh GitHub state"
                  title="Refresh GitHub state"
                  disabled={!isPr || readiness.refreshing}
                  onClick={readiness.refresh}
                >
                  <Icon name="ph:arrows-clockwise" width={13} height={13} aria-hidden />
                </button>
              </div>

              {!isPr || readiness.phase !== "ready" || !facts ? (
                <div className="rd-readiness-none" role="status">
                  <span className="rd-readiness-none-title">
                    {!selected
                      ? "Nothing selected"
                      : !isPr
                        ? "No pull request to check"
                        : readiness.phase === "loading"
                          ? "Reading GitHub…"
                          : "Readiness unavailable"}
                  </span>
                  <span className="rd-readiness-none-hint">
                    {!selected
                      ? "Pick a session to see its readiness."
                      : !isPr
                        ? "Readiness comes from a pull request: state, mergeability, reviews, checks, and threads. Open a PR for this branch and it appears here."
                        : readiness.phase === "loading"
                          ? "State, mergeability, reviews, checks and threads arrive together — nothing is shown until all of them do."
                          : (readiness.error ??
                            "GitHub state couldn't be read. Nothing is inferred — retry from the diff pane.")}
                  </span>
                </div>
              ) : (
                <>
                  <div className="rd-tint" data-tone={banner.tone} role="status">
                    <Icon name={banner.icon} width={15} height={15} aria-hidden />
                    <span className="rd-tint-body">
                      <span className="rd-tint-headline">{banner.headline}</span>
                      <span className="rd-tint-sub">{banner.sub}</span>
                    </span>
                  </div>

                  <div className="rd-pips">
                    <span
                      className="rd-pill"
                      data-tone={facts.draft ? "muted" : "accent"}
                      title={facts.draft ? "Draft — not open for review." : `Pull request is ${facts.state}.`}
                    >
                      <Icon name="ph:git-pull-request" width={10} height={10} aria-hidden />
                      {facts.draft ? "draft" : facts.state}
                    </span>
                    <span
                      className="rd-pill"
                      data-tone={facts.mergeable === true ? "success" : facts.mergeable === null ? "muted" : "danger"}
                      title={
                        facts.mergeable === null
                          ? "GitHub is still computing the merge commit."
                          : `GitHub mergeable_state: ${facts.mergeableState}`
                      }
                    >
                      <Icon name="ph:git-merge" width={10} height={10} aria-hidden />
                      {facts.mergeable === null ? "mergeability computing" : facts.mergeableState}
                    </span>
                    <span
                      className="rd-pill"
                      data-tone={
                        facts.reviews.changesRequested > 0 ? "warning" : facts.reviews.approved > 0 ? "success" : "muted"
                      }
                      title={
                        facts.latestReview
                          ? `Latest: ${facts.latestReview.state === "APPROVED" ? "approved" : "changes requested"} by @${facts.latestReview.author}`
                          : "No submitted reviews yet."
                      }
                    >
                      <Icon name="ph:seal-check" width={10} height={10} aria-hidden />
                      {facts.reviews.approved} approved
                    </span>
                    <span className="rd-pill" data-tone={checks.tone} title={checks.title}>
                      <Icon name={checks.icon} width={10} height={10} aria-hidden />
                      {checks.label}
                    </span>
                    <span
                      className="rd-pill"
                      data-tone={facts.threads.unresolved > 0 ? "warning" : "success"}
                      title={`${facts.threads.unresolved} unresolved of ${facts.threads.total} review threads`}
                    >
                      <Icon name="ph:chat-circle-dots" width={10} height={10} aria-hidden />
                      {facts.threads.unresolved === 0 ? "threads clear" : `${facts.threads.unresolved} threads`}
                    </span>
                  </div>

                  {blockers.length > 0 ? (
                    <div className="rd-blockers">
                      {blockers.map((blocker, i) => (
                        <div key={blocker.id} className="rd-tint rd-blocker" data-tone={blocker.tone}>
                          <span className="rd-blocker-index" aria-hidden>
                            {i + 1}
                          </span>
                          <span className="rd-tint-body">
                            <span className="rd-blocker-title">
                              <Icon name={blocker.icon} width={12} height={12} aria-hidden />
                              {blocker.title}
                            </span>
                            <span className="rd-blocker-fix">{blocker.fix}</span>
                            {blocker.reveal ? (
                              <button
                                type="button"
                                className="rd-blocker-reveal focus-ring"
                                onClick={() => {
                                  if (blocker.reveal === "threads") setThreadsOpen(true);
                                  else setDetailOpen(true);
                                  announce(
                                    blocker.reveal === "threads" ? "Review threads expanded." : "Check detail expanded.",
                                  );
                                }}
                              >
                                <Icon name="ph:caret-right" width={10} height={10} aria-hidden />
                                {blocker.reveal === "threads" ? "show the threads" : "show the checks"}
                              </button>
                            ) : null}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="rd-disclosures">
                    <button
                      type="button"
                      className="rd-disc-chip focus-ring"
                      data-open={detailOpen ? "true" : undefined}
                      aria-expanded={detailOpen}
                      aria-controls="rd-pr-detail"
                      title="State, mergeability, review tally and every check run"
                      onClick={() => setDetailOpen((open) => !open)}
                    >
                      <Icon name={detailOpen ? "ph:caret-down" : "ph:caret-right"} width={10} height={10} aria-hidden />
                      Detail · {facts.checks.runs.length} checks
                    </button>
                    {facts.threads.items.length > 0 ? (
                      <button
                        type="button"
                        className="rd-disc-chip focus-ring"
                        data-open={threadsOpen ? "true" : undefined}
                        data-tone="warning"
                        aria-expanded={threadsOpen}
                        aria-controls="rd-pr-threads"
                        title="Unresolved review threads, read from GitHub"
                        onClick={() => setThreadsOpen((open) => !open)}
                      >
                        <Icon
                          name={threadsOpen ? "ph:caret-down" : "ph:caret-right"}
                          width={10}
                          height={10}
                          aria-hidden
                        />
                        Threads · {facts.threads.unresolved}
                      </button>
                    ) : null}
                  </div>

                  {detailOpen ? (
                    <div id="rd-pr-detail" className="rd-detail">
                      <div className="rd-detail-row">
                        <span className="rd-detail-key">
                          <Icon name="ph:git-pull-request" width={12} height={12} aria-hidden />
                          State
                        </span>
                        <span className="rd-pill" data-tone={facts.draft ? "muted" : "accent"}>
                          {facts.draft ? "draft" : facts.state}
                        </span>
                      </div>
                      <div className="rd-detail-row">
                        <span className="rd-detail-key">
                          <Icon name="ph:git-merge" width={12} height={12} aria-hidden />
                          Mergeable
                        </span>
                        <span
                          className="rd-pill"
                          data-tone={
                            facts.mergeable === true ? "success" : facts.mergeable === null ? "muted" : "danger"
                          }
                        >
                          {facts.mergeable === null ? "computing…" : facts.mergeableState}
                        </span>
                      </div>
                      <div className="rd-detail-row">
                        <span className="rd-detail-key">
                          <Icon name="ph:seal-check" width={12} height={12} aria-hidden />
                          Reviews
                        </span>
                        <span
                          className="rd-pill"
                          data-tone={
                            facts.reviews.changesRequested > 0
                              ? "warning"
                              : facts.reviews.approved > 0
                                ? "success"
                                : "muted"
                          }
                        >
                          {facts.reviews.approved} approving · {facts.reviews.changesRequested} requesting changes
                        </span>
                      </div>
                      <div className="rd-detail-row">
                        <span className="rd-detail-key">
                          <Icon name="ph:check-square" width={12} height={12} aria-hidden />
                          Checks
                        </span>
                        <span className="rd-pill" data-tone={checks.tone}>
                          {checks.label}
                        </span>
                      </div>
                      <div className="rd-detail-row">
                        <span className="rd-detail-key">
                          <Icon name="ph:chat-circle-dots" width={12} height={12} aria-hidden />
                          Threads
                        </span>
                        <span className="rd-pill" data-tone={facts.threads.unresolved > 0 ? "warning" : "success"}>
                          {facts.threads.unresolved === 0
                            ? `0 of ${facts.threads.total}`
                            : `${facts.threads.unresolved} unresolved`}
                        </span>
                      </div>
                      <div className="rd-check-runs">
                        {facts.checks.runs.map((run) => {
                          const failed = failingCheckNames([run]).length > 0;
                          const pending = run.status !== "completed";
                          return (
                            <div
                              key={`${run.name}-${run.detailsUrl ?? ""}`}
                              className="rd-check-run"
                              data-tone={failed ? "danger" : pending ? "warning" : "success"}
                            >
                              <Icon
                                name={
                                  failed ? "ph:x-circle-fill" : pending ? "ph:hourglass" : "ph:check-circle-fill"
                                }
                                width={12}
                                height={12}
                                aria-hidden
                              />
                              <span className="rd-check-name">{run.name}</span>
                              <span className="rd-spacer" />
                              <span className="rd-check-state">{run.conclusion ?? run.status}</span>
                              {run.detailsUrl ? (
                                <a
                                  href={run.detailsUrl}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (run.detailsUrl) context.openUrl(run.detailsUrl);
                                  }}
                                >
                                  log
                                </a>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {threadsOpen && facts.threads.items.length > 0 ? (
                    <div id="rd-pr-threads" className="rd-threads">
                      {facts.threads.items.map((thread) => (
                        <div key={thread.id} className="rd-thread">
                          <span className="rd-thread-where" title={thread.where}>
                            <Icon name="ph:chat-circle-dots" width={10} height={10} aria-hidden />
                            {thread.where}
                          </span>
                          <span className="rd-thread-body">
                            <span className="rd-thread-author">@{thread.author}</span>
                            <span className="rd-thread-text">{thread.excerpt}</span>
                          </span>
                        </div>
                      ))}
                      <span className="rd-thread-foot">
                        {facts.threads.unresolved} unresolved of {facts.threads.total} ·{" "}
                        {facts.threads.canResolve ? "resolve on GitHub" : "read-only without a token"}
                      </span>
                    </div>
                  ) : null}
                </>
              )}
            </section>

            {/* ── Session details ── */}
            {selected ? (
              <section className="rd-panel rd-card rd-details">
                <button
                  type="button"
                  className="rd-details-toggle focus-ring-inset"
                  aria-expanded={factsOpen}
                  aria-controls="rd-facts"
                  onClick={() => setFactsOpen((open) => !open)}
                >
                  <Icon name={factsOpen ? "ph:caret-down" : "ph:caret-right"} width={11} height={11} aria-hidden />
                  <span className="rd-eyebrow">Details</span>
                  {!factsOpen ? (
                    <span className="rd-details-summary">{facts?.headRef || selected.session.git?.branch || "—"}</span>
                  ) : null}
                </button>
                {factsOpen ? (
                  <div id="rd-facts" className="rd-facts">
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-branch" width={13} height={13} aria-hidden />
                        Branch
                      </span>
                      <span className="rd-fact-val rd-fact-val--mono">
                        {facts?.headRef || source.localBranch || selected.session.git?.branch || "—"}
                      </span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-diff" width={13} height={13} aria-hidden />
                        Review source
                      </span>
                      <span className="rd-pill" data-tone={isPr ? "accent" : "warning"} title={sourceExplain}>
                        {sourceLabel}
                      </span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:git-pull-request" width={13} height={13} aria-hidden />
                        Pull request
                      </span>
                      <span className="rd-fact-val rd-fact-val--mono">
                        {selectedPrUrl ? (
                          <a
                            href={selectedPrUrl}
                            onClick={(e) => {
                              e.preventDefault();
                              context.openUrl(selectedPrUrl);
                            }}
                          >
                            {prLabel(sessionPr)}
                          </a>
                        ) : (
                          "None"
                        )}
                      </span>
                    </div>
                    <div className="rd-fact">
                      <span className="rd-fact-key">
                        <Icon name="ph:clock-counter-clockwise" width={13} height={13} aria-hidden />
                        Updated
                      </span>
                      <span className="rd-fact-val">{relativeTime(selected.session.updated_at)}</span>
                    </div>
                    <div className="rd-jump-row">
                      <button
                        type="button"
                        className="rd-jump-btn rd-jump-btn--primary focus-ring"
                        onClick={() => context.openSession(selected.session.id, familiarId)}
                      >
                        <Icon name="ph:play-fill" width={12} height={12} aria-hidden />
                        Open session
                      </button>
                      <button
                        type="button"
                        className="rd-jump-btn rd-jump-btn--ghost focus-ring"
                        disabled={!selectedPrUrl}
                        onClick={() => selectedPrUrl && context.openUrl(selectedPrUrl)}
                      >
                        <Icon name="ph:github-logo" width={13} height={13} aria-hidden />
                        Pull request
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* ── Reviewer note ── */}
            <section className="rd-panel rd-card rd-note-card">
              <div className="rd-card-head">
                <label className="rd-eyebrow" htmlFor="rd-note">
                  Reviewer note
                </label>
                <span className="rd-spacer" />
                <span className="rd-checked">{!selected ? "" : note ? "draft kept for this session" : "empty"}</span>
              </div>
              <p id="rd-note-help" className="rd-hint">
                Sent as the GitHub review body. Required when requesting changes; kept per session while you move around
                the queue.
              </p>
              <textarea
                id="rd-note"
                className="rd-note"
                placeholder="Add a note…"
                value={note}
                disabled={!selected}
                onChange={(e) => setNote(e.target.value)}
                aria-describedby="rd-note-help"
                aria-invalid={noteError ? true : undefined}
              />
              {noteError ? (
                <span className="rd-error" role="alert">
                  {noteError}
                </span>
              ) : null}
            </section>
          </div>
        )}
      </div>

      {/* ── Checkpoints footer ── */}
      <section className="rd-panel rd-checkpoints" aria-label="Checkpoints">
        <button
          type="button"
          className="rd-cp-toggle focus-ring"
          title={state.drawerOpen ? "Collapse checkpoints" : "Expand checkpoints"}
          aria-expanded={state.drawerOpen}
          aria-controls="rd-checkpoints"
          onClick={() => patch({ drawerOpen: !state.drawerOpen })}
        >
          <span className="rd-cp-caret" data-open={state.drawerOpen ? "true" : "false"}>
            <Icon name="ph:caret-up" width={13} height={13} aria-hidden />
          </span>
          <Icon name="ph:clock-counter-clockwise" width={14} height={14} aria-hidden />
          <span className="rd-eyebrow">Checkpoints</span>
          <span className="rd-cp-summary-inline">
            {state.drawerOpen
              ? "Read-only — the deck never applies a patch."
              : "Saved patches for the selected project — click to browse."}
          </span>
        </button>
        {state.drawerOpen ? (
          <div id="rd-checkpoints" className="rd-cp-list rd-scroll">
            {!projectRoot ? (
              <span className="rd-cp-summary">Select a session to see its project's checkpoints.</span>
            ) : checkpointError ? (
              <SurfaceError title={checkpointError} hint="Check the project, then retry." onRetry={loadCheckpoints} />
            ) : checkpoints == null ? (
              <span className="rd-cp-summary">Loading checkpoints…</span>
            ) : checkpoints.length === 0 ? (
              <span className="rd-cp-summary">
                No checkpoints saved. Chat's change tools snapshot working trees here before risky edits.
              </span>
            ) : (
              checkpoints.map((checkpoint) => (
                <span key={checkpoint.name} className="rd-cp-pill" title={checkpoint.name}>
                  <span className="rd-cp-name">{checkpoint.name.replace(/\.patch$/, "")}</span>
                  <span className="rd-cp-date">{relativeTime(checkpoint.savedAt)}</span>
                </span>
              ))
            )}
          </div>
        ) : null}
      </section>

      {/* ── Request-changes composer: evidence chips → drafted body → your edit ── */}
      <Modal
        open={changesOpen}
        onClose={() => setChangesOpen(false)}
        dismissOnEscape={busy == null}
        breadcrumb={["Review Deck", "Request changes"]}
        wide
        footerPills={
          facts ? (
            <>
              <span className="ui-pill">REQUEST_CHANGES</span>
              <span className="ui-pill">
                posts to {facts.repo}#{facts.number}
              </span>
            </>
          ) : null
        }
        footerActions={
          <>
            <button type="button" className="rd-btn focus-ring" onClick={() => setChangesOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--changes focus-ring"
              disabled={busy != null || !note.trim()}
              onClick={() => void sendChangeRequest()}
            >
              <Icon name="ph:arrow-bend-up-left" width={14} height={14} aria-hidden />
              Send request
            </button>
          </>
        }
      >
        <div className="rd-composer">
          <div className="rd-composer-evidence">
            <div className="rd-card-head">
              <span className="rd-eyebrow">Evidence from GitHub</span>
              <span className="rd-spacer" />
              {evidence.length > EVIDENCE_PREVIEW ? (
                <button
                  type="button"
                  className="rd-composer-more focus-ring"
                  aria-expanded={evidenceExpanded}
                  aria-controls="rd-evidence"
                  onClick={() => setEvidenceExpanded((open) => !open)}
                >
                  <Icon
                    name={evidenceExpanded ? "ph:caret-down" : "ph:caret-right"}
                    width={10}
                    height={10}
                    aria-hidden
                  />
                  {evidenceExpanded ? "Show less" : `Show all ${evidence.length}`}
                </button>
              ) : null}
              <span className="rd-checked">
                {evidence.length > 0 ? `${keptEvidence.length} of ${evidence.length} cited` : "nothing blocking"}
              </span>
            </div>
            <div
              id="rd-evidence"
              className="rd-evidence-chips"
              data-expanded={evidenceExpanded ? "true" : undefined}
              role="group"
              aria-label="Evidence to include"
            >
              {evidence.map((item) => {
                const on = !evidenceOff[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="rd-evidence-chip focus-ring"
                    data-tone={item.tone}
                    data-off={on ? undefined : "true"}
                    aria-pressed={on}
                    title={item.title}
                    onClick={() => setEvidenceOff((prev) => ({ ...prev, [item.key]: on }))}
                  >
                    <Icon name={on ? item.icon : "ph:circle-dashed"} width={11} height={11} aria-hidden />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <p className="rd-hint">
              Deselect anything you don&rsquo;t want cited. Nothing here is invented — every item is a failing check, an
              unresolved thread, or a mergeability fact read from this pull request.
            </p>
          </div>

          <div className="rd-composer-actions">
            <button type="button" className="rd-draft-btn focus-ring" onClick={draft}>
              <Icon name="ph:pencil-simple" width={13} height={13} aria-hidden />
              {note ? "Redraft from evidence" : "Draft from evidence"}
            </button>
            <button type="button" className="rd-btn focus-ring" onClick={() => setNote("")}>
              Clear
            </button>
            <span className="rd-spacer" />
            <span className="rd-draft-hint">Your words in the end — the draft is a starting point.</span>
          </div>

          <div className="rd-composer-body">
            <label className="rd-eyebrow" htmlFor="rd-rc-body">
              Review body
            </label>
            <p id="rd-rc-help" className="rd-hint">
              Posted to GitHub as the REQUEST_CHANGES review body and shown to the familiar in its session. Required —
              edit the draft until it says what you mean.
            </p>
            <textarea
              id="rd-rc-body"
              ref={composerRef}
              className="rd-composer-textarea"
              placeholder="Describe what has to change…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-describedby="rd-rc-help"
              aria-invalid={noteError ? true : undefined}
            />
            {noteError ? (
              <span className="rd-error" role="alert">
                {noteError}
              </span>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* ── Squash & merge confirmation ── */}
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        dismissOnEscape={busy == null}
        breadcrumb={["Review Deck", "Squash & merge"]}
        footerPills={
          facts ? (
            <>
              <span className="ui-pill">squash</span>
              <span className="ui-pill">{facts.commits} commits → 1</span>
              <span className="ui-pill">into {facts.baseRef}</span>
            </>
          ) : null
        }
        footerActions={
          <>
            <button type="button" className="rd-btn focus-ring" onClick={() => setMergeOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rd-btn rd-btn--merge focus-ring"
              disabled={!ready || busy != null}
              onClick={() => void confirmMerge()}
            >
              <Icon name="ph:git-merge" width={14} height={14} aria-hidden />
              Squash &amp; merge
            </button>
          </>
        }
      >
        <div className="rd-merge-confirm">
          <div className="rd-merge-subject">
            <span className="rd-merge-ref">{facts ? `${facts.repo}#${facts.number}` : ""}</span>
            <span className="rd-merge-title">{selected?.session.title ?? ""}</span>
          </div>
          <div className="rd-merge-checklist">
            <span className="rd-eyebrow">Pre-merge checklist</span>
            {mergeChecklist(facts).map((row) => (
              <div key={row.label} className="rd-merge-row" data-ok={row.ok ? "true" : undefined}>
                <Icon name={row.ok ? "ph:check-circle-fill" : "ph:x-circle-fill"} width={13} height={13} aria-hidden />
                <span className="rd-merge-row-body">
                  <span className="rd-merge-row-label">{row.label}</span>
                  <span className="rd-merge-row-detail">{row.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="rd-hint">
            This squash-merges on GitHub and closes the pull request. It never touches your working tree. The deck
            re-reads GitHub state afterwards.
          </p>
        </div>
      </Modal>
    </div>
  );
}

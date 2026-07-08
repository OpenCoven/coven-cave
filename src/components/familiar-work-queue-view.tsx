"use client";

import "@/styles/familiar-work-queue.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import { useMinuteTick } from "@/lib/use-minute-tick";
import { relativeTime } from "@/lib/relative-time";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  buildWorkQueue,
  hasVerificationEvidence,
  type AttentionItem,
  type ReadyBead,
  type MergedPrRef,
  type WorkQueue,
  type WorkQueueItem,
  type WorkQueueLaneKey,
} from "@/lib/beads-work-queue";
import type { PullRequestSummary } from "@/lib/beads-pr-management";

type Props = {
  familiars?: ResolvedFamiliar[];
  onOpenUrl?: (url: string) => void;
};

const LANE_ICON: Record<WorkQueueLaneKey, IconName> = {
  "checks-failing": "ph:warning-circle",
  "changes-requested": "ph:chat-circle-dots",
  "needs-review": "ph:magnifying-glass",
  "ready-to-merge": "ph:git-merge",
  waiting: "ph:hourglass",
  "no-open-PR": "ph:git-branch",
  "post-merge-cleanup": "ph:sparkle",
};

// Lanes whose accent reads as "act now" get a warm tint; waiting stays quiet.
const LANE_TONE: Record<WorkQueueLaneKey, "urgent" | "ready" | "neutral" | "quiet"> = {
  "checks-failing": "urgent",
  "changes-requested": "urgent",
  "needs-review": "neutral",
  "ready-to-merge": "ready",
  waiting: "quiet",
  "no-open-PR": "neutral",
  "post-merge-cleanup": "ready",
};

type FetchedQueue = {
  queue: WorkQueue;
  /** False when the beads adapter failed and the queue is PRs-only. */
  beadsOk: boolean;
};

// The PR bridge is the queue's spine — its failure fails the load. The beads
// adapter instead DEGRADES the queue to PRs-only (the no-open-PR and
// post-merge-cleanup lanes need the ready set), but the degradation is
// reported via `beadsOk` so the surface can say so rather than silently
// rendering fewer lanes.
async function fetchQueue(signal: AbortSignal): Promise<FetchedQueue> {
  const [beadsSettled, prsSettled] = await Promise.allSettled([
    fetch("/api/beads?mode=ready", { cache: "no-store", signal }).then((res) => res.json()),
    fetch("/api/beads/prs", { cache: "no-store", signal }).then((res) => res.json()),
  ]);
  if (prsSettled.status === "rejected") throw prsSettled.reason;
  const prsJson = prsSettled.value;
  if (!prsJson.ok) throw new Error(prsJson.error || "PR bridge unavailable");

  let readyBeads: ReadyBead[] = [];
  let beadsOk = false;
  if (beadsSettled.status === "fulfilled" && beadsSettled.value.ok && Array.isArray(beadsSettled.value.data)) {
    readyBeads = beadsSettled.value.data;
    beadsOk = true;
  }
  const open: PullRequestSummary[] = Array.isArray(prsJson.open) ? prsJson.open : [];
  const merged: MergedPrRef[] = Array.isArray(prsJson.merged) ? prsJson.merged : [];
  return { queue: buildWorkQueue(readyBeads, open, merged, { nowMs: Date.now() }), beadsOk };
}

// Content equality for the poll: the queue is a plain, deterministically-built
// object graph, so serialized comparison is exact. Keeping the previous state
// identity on a no-change poll stops the 30s tick from re-rendering every
// lane/card (and resetting nothing) for an identical picture.
function sameQueue(a: WorkQueue, b: WorkQueue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FamiliarWorkQueueView({ familiars = [], onOpenUrl }: Props) {
  const { announce } = useAnnouncer();
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [beadsDegraded, setBeadsDegraded] = useState(false);
  // ISO timestamp of the last successful load — the header's truthfulness
  // signal. If quiet polls fail, this readout ages instead of lying "fresh".
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [familiarFilter, setFamiliarFilter] = useState<string | null>(null);
  // Beads that got a handoff note THIS session — Close unlocks immediately
  // without waiting for the poll to re-read comment_count (cave-hlv.2).
  const [evidenceAdded, setEvidenceAdded] = useState<Set<string>>(() => new Set());
  const loadSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // Re-render ~once a minute so the header freshness and per-card ages stay
  // truthful between polls (the equality guard below keeps queue state stable,
  // so nothing else would tick them).
  useMinuteTick();

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { queue: next, beadsOk } = await fetchQueue(ctrl.signal);
      if (seq !== loadSeq.current) return; // a newer load won
      setQueue((prev) => (prev && sameQueue(prev, next) ? prev : next));
      setBeadsDegraded(!beadsOk);
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      if (ctrl.signal.aborted || seq !== loadSeq.current) return;
      // Keep whatever data is on screen — the render picks between the
      // full-surface empty state (no data yet) and the inline refresh banner.
      setError(err instanceof Error ? err.message : "Failed to load the work queue");
    } finally {
      if (seq === loadSeq.current) setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Announce the actionable count once the first load settles.
  const announcedRef = useRef(false);
  useEffect(() => {
    if (!hasLoaded || announcedRef.current || !queue) return;
    announcedRef.current = true;
    announce(
      queue.total === 0
        ? "Work queue is clear — no open PRs or ready beads."
        : `Work queue loaded: ${queue.actionable} actionable of ${queue.total}.`,
    );
  }, [hasLoaded, queue, announce]);

  usePausablePoll(() => void load(), 30_000, { pauseWhileInputActive: true });

  const familiarName = useCallback(
    (key: string) => {
      if (key === "unassigned") return "Unassigned";
      const match = familiars.find((f) => f.id === key || f.display_name?.toLowerCase() === key);
      return match?.display_name ?? key.charAt(0).toUpperCase() + key.slice(1);
    },
    [familiars],
  );

  const runAction = useCallback(
    async (item: WorkQueueItem, action: "claim" | "close") => {
      const id = item.bead?.id;
      if (!id) return;
      setBusyId(item.key);
      try {
        const body: Record<string, string> = { action, id };
        if (action === "close") body.reason = item.merged ? `Merged in PR #${item.merged.number}` : "Completed";
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || `${action} failed`);
        announce(action === "claim" ? `Claimed ${id}.` : `Closed ${id}.`);
        await load();
      } catch (err) {
        announce(err instanceof Error ? err.message : `Could not ${action} ${id}`, "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load],
  );

  // Handoff note: appends a comment to the bead (the recorded verification
  // evidence that unlocks Close). Returns whether it landed so the card's inline
  // composer can stay open on failure. cave-hlv.2.
  const runComment = useCallback(
    async (item: WorkQueueItem, text: string): Promise<boolean> => {
      const id = item.bead?.id;
      const comment = text.trim();
      if (!id || !comment) return false;
      setBusyId(item.key);
      try {
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "comment", id, comment }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "comment failed");
        setEvidenceAdded((prev) => new Set(prev).add(id.toLowerCase()));
        announce(`Handoff note added to ${id}.`);
        await load();
        return true;
      } catch (err) {
        announce(err instanceof Error ? err.message : `Could not add a note to ${id}`, "assertive");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [announce, load],
  );

  const visibleLanes = useMemo(() => {
    if (!queue) return [];
    if (!familiarFilter) return queue.lanes;
    return queue.lanes
      .map((lane) => ({ ...lane, items: lane.items.filter((i) => i.familiar === familiarFilter) }))
      .filter((lane) => lane.items.length > 0);
  }, [queue, familiarFilter]);

  if (!hasLoaded) {
    return (
      <div className="fwq" aria-busy>
        <header className="surface-compact-header">
          <h1 className="surface-compact-title">Work Queue</h1>
        </header>
        <div className="fwq-body">
          <SkeletonRows count={6} />
        </div>
      </div>
    );
  }

  if (error && !queue) {
    return (
      <div className="fwq">
        <div className="fwq-body">
          <EmptyState
            icon="ph:warning-circle"
            headline="Couldn't load the work queue"
            subtitle={error}
            actions={
              <Button variant="secondary" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
                Retry
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const q = queue!;

  return (
    <div className="fwq">
      {/* Compact header — the shared .surface-compact band (GitHub / Schedules /
          Marketplace / Tasks / Grimoire): small title, live summary inline
          (with a truthful "updated Xm ago" readout), Refresh on the right. */}
      <header className="surface-compact-header">
        <h1 className="surface-compact-title">Work Queue</h1>
        <p className="surface-compact-summary">
          {q.total === 0
            ? "No open PRs or ready beads."
            : `${q.actionable} actionable · ${q.total} total${q.stale ? ` · ${q.stale} stale` : ""}`}
          {lastUpdated ? <span className="fwq-updated"> · updated {relativeTime(lastUpdated)}</span> : null}
        </p>
        <div className="surface-compact-actions">
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:arrow-clockwise"
            onClick={() => void load()}
            aria-label="Refresh work queue"
          >
            Refresh
          </Button>
        </div>
      </header>

      {q.byFamiliar.length > 0 ? (
        <div className="fwq-familiars" role="group" aria-label="Filter by familiar">
          <button
            type="button"
            className={`fwq-chip${familiarFilter === null ? " is-active" : ""}`}
            aria-pressed={familiarFilter === null}
            onClick={() => setFamiliarFilter(null)}
          >
            All <span className="fwq-chip-count">{q.total}</span>
          </button>
          {q.byFamiliar.map((r) => (
            <button
              key={r.familiar}
              type="button"
              className={`fwq-chip${familiarFilter === r.familiar ? " is-active" : ""}`}
              aria-pressed={familiarFilter === r.familiar}
              onClick={() => setFamiliarFilter((cur) => (cur === r.familiar ? null : r.familiar))}
              title={`${r.actionable} actionable of ${r.total}`}
            >
              {familiarName(r.familiar)}
              <span className="fwq-chip-count">{r.actionable}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* Truthful-degradation banners. Text is static (only the tooltip carries
          the raw error) so role=alert doesn't re-announce every failing poll. */}
      {error ? (
        <div className="fwq-banner fwq-banner--danger" role="alert" title={error}>
          <Icon name="ph:warning-circle" width={14} aria-hidden />
          <span className="fwq-banner-text">Couldn&apos;t refresh the queue — showing earlier data.</span>
          <Button variant="ghost" size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}
      {beadsDegraded ? (
        <div className="fwq-banner fwq-banner--warn" role="status">
          <Icon name="ph:plugs" width={14} aria-hidden />
          <span className="fwq-banner-text">
            Beads adapter unavailable — showing PRs only; ready beads and post-merge cleanup are hidden.
          </span>
        </div>
      ) : null}

      {q.attention.length > 0 ? <AttentionStrip items={q.attention} onOpenUrl={onOpenUrl} /> : null}

      <div className="fwq-body">
        {q.total === 0 ? (
          <EmptyState
            icon="ph:check-circle"
            headline="Queue is clear"
            subtitle={
              beadsDegraded
                ? "No open PRs need attention. Bead lanes are unavailable right now."
                : "No open PRs need attention and no ready beads are waiting to ship."
            }
          />
        ) : visibleLanes.length === 0 ? (
          <EmptyState
            icon="ph:funnel"
            headline={`Nothing for ${familiarName(familiarFilter ?? "")}`}
            subtitle="Clear the filter to see the whole queue."
            actions={
              <Button variant="secondary" onClick={() => setFamiliarFilter(null)}>
                Show all
              </Button>
            }
          />
        ) : (
          visibleLanes.map((lane) => (
            <section key={lane.key} className={`fwq-lane fwq-lane--${LANE_TONE[lane.key]}`} aria-label={lane.title}>
              <header className="fwq-lane-head">
                <Icon name={LANE_ICON[lane.key]} width={15} aria-hidden />
                <span className="fwq-lane-title">{lane.title}</span>
                <span className="fwq-lane-count">{lane.items.length}</span>
              </header>
              <ul className="fwq-cards">
                {lane.items.map((item) => (
                  <WorkQueueCard
                    key={item.key}
                    item={item}
                    familiarLabel={familiarName(item.familiar)}
                    busy={busyId === item.key}
                    hasEvidence={
                      !!item.bead &&
                      (hasVerificationEvidence(item.bead) || evidenceAdded.has(item.bead.id.toLowerCase()))
                    }
                    onOpenUrl={onOpenUrl}
                    onClaim={() => void runAction(item, "claim")}
                    onClose={() => void runAction(item, "close")}
                    onComment={(text) => runComment(item, text)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Repo-wide housekeeping callout for the two gaps the CLI patrol flags: open
 * PRs with no linked bead (invisible to the queue) and/or gone stale. Global —
 * NOT filtered by the familiar chips, since an unlinked PR has no familiar and
 * this is repo hygiene, not one familiar's queue.
 */
function AttentionStrip({
  items,
  onOpenUrl,
}: {
  items: AttentionItem[];
  onOpenUrl?: (url: string) => void;
}) {
  const unlinkedCount = items.filter((i) => i.unlinked).length;
  const staleCount = items.filter((i) => i.stale).length;
  const summary = [
    unlinkedCount ? `${unlinkedCount} unlinked` : null,
    staleCount ? `${staleCount} stale` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="fwq-attention" aria-label="PRs needing attention">
      <header className="fwq-attention-head">
        <Icon name="ph:warning-circle" width={14} aria-hidden />
        <span className="fwq-attention-title">Needs attention</span>
        <span className="fwq-attention-summary">{summary}</span>
      </header>
      <ul className="fwq-attention-list">
        {items.map(({ pr, unlinked, stale }) => (
          <li key={pr.number} className="fwq-attention-item">
            <div className="fwq-attention-main">
              <span className="fwq-pr-num">#{pr.number}</span>
              <span className="fwq-attention-name">{pr.title}</span>
            </div>
            <div className="fwq-attention-tags">
              {unlinked ? (
                <span className="fwq-tag fwq-tag--unlinked" title="No linked bead — invisible to the queue">
                  no bead
                </span>
              ) : null}
              {stale ? <span className="fwq-tag fwq-tag--stale">stale</span> : null}
            </div>
            <Button
              variant="ghost"
              size="xs"
              trailingIcon="ph:arrow-square-out"
              onClick={() => onOpenUrl?.(pr.url)}
              disabled={!onOpenUrl}
            >
              Open PR
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WorkQueueCard({
  item,
  familiarLabel,
  busy,
  hasEvidence,
  onOpenUrl,
  onClaim,
  onClose,
  onComment,
}: {
  item: WorkQueueItem;
  familiarLabel: string;
  busy: boolean;
  hasEvidence: boolean;
  onOpenUrl?: (url: string) => void;
  onClaim: () => void;
  onClose: () => void;
  onComment: (text: string) => Promise<boolean>;
}) {
  const beadId = item.bead?.id ?? null;
  const title = item.pr?.title ?? item.merged?.title ?? item.bead?.title ?? "Untitled";
  const prNumber = item.pr?.number ?? item.merged?.number ?? null;
  const url = item.pr?.url ?? item.merged?.url ?? null;
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const noteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const noteButtonRef = useRef<HTMLButtonElement | null>(null);
  const isCleanup = item.lane === "post-merge-cleanup";
  // Close is exposed on the cleanup lane, but only once verification evidence
  // (a handoff note) is on record — the operator adds one via the composer.
  const closeBlocked = isCleanup && !hasEvidence;

  // Keyboard/AT flow for the inline composer: focus lands in the textarea when
  // it opens, and returns to the Note toggle whenever it closes (submit,
  // Cancel, Escape) — otherwise focus drops to <body> on unmount.
  useEffect(() => {
    if (composing) noteInputRef.current?.focus();
  }, [composing]);

  const closeComposer = (opts?: { clearDraft?: boolean }) => {
    if (opts?.clearDraft) setDraft("");
    setComposing(false);
    noteButtonRef.current?.focus();
  };

  const submitNote = async () => {
    if (!draft.trim()) return;
    const ok = await onComment(draft);
    if (ok) closeComposer({ clearDraft: true });
  };

  return (
    <li className={`fwq-card${item.stale ? " is-stale" : ""}`}>
      <div className="fwq-card-main">
        <div className="fwq-card-title">
          {prNumber != null ? <span className="fwq-pr-num">#{prNumber}</span> : null}
          <span className="fwq-card-name">{title}</span>
        </div>
        <div className="fwq-card-meta">
          <span className="fwq-tag fwq-tag--familiar">{familiarLabel}</span>
          {item.surface ? <span className="fwq-tag">{item.surface}</span> : null}
          {beadId ? <span className="fwq-tag fwq-tag--bead">{beadId}</span> : null}
          {item.bead && !item.pr && !item.merged ? (
            <span className="fwq-tag">P{item.bead.priority}</span>
          ) : null}
          {item.pr ? (
            <>
              <span className={`fwq-tag fwq-tag--check-${item.pr.checkStatus ?? "unknown"}`}>
                checks {item.pr.checkStatus ?? "unknown"}
              </span>
              {item.pr.reviewDecision && item.pr.reviewDecision !== "UNKNOWN" ? (
                <span className="fwq-tag">{item.pr.reviewDecision.toLowerCase().replace(/_/g, " ")}</span>
              ) : null}
              {item.lane === "ready-to-merge" ? <span className="fwq-tag fwq-tag--ready">merge eligible</span> : null}
            </>
          ) : null}
          {item.stale ? <span className="fwq-tag fwq-tag--stale">stale</span> : null}
          {item.pr?.updatedAt ? (
            <span className="fwq-card-time" title={new Date(item.pr.updatedAt).toLocaleString()}>
              updated {relativeTime(item.pr.updatedAt)}
            </span>
          ) : null}
          {item.merged?.mergedAt ? (
            <span className="fwq-card-time" title={new Date(item.merged.mergedAt).toLocaleString()}>
              merged {relativeTime(item.merged.mergedAt)}
            </span>
          ) : null}
        </div>
      </div>
      <div className="fwq-card-actions">
        {url ? (
          <Button
            variant="ghost"
            size="xs"
            trailingIcon="ph:arrow-square-out"
            onClick={() => onOpenUrl?.(url)}
            disabled={!onOpenUrl}
          >
            {item.merged ? "Merged PR" : "Open PR"}
          </Button>
        ) : null}
        {beadId ? (
          <Button
            ref={noteButtonRef}
            variant="ghost"
            size="xs"
            leadingIcon="ph:note-pencil"
            onClick={() => setComposing((v) => !v)}
            aria-expanded={composing}
            aria-label={`Add a handoff note to ${beadId}`}
          >
            Note
          </Button>
        ) : null}
        {item.lane === "no-open-PR" && beadId ? (
          <Button variant="secondary" size="xs" loading={busy} leadingIcon="ph:hand" onClick={onClaim}>
            Claim
          </Button>
        ) : null}
        {isCleanup && beadId ? (
          <Button
            variant="secondary"
            size="xs"
            loading={busy}
            leadingIcon="ph:check"
            onClick={onClose}
            disabled={closeBlocked}
            title={closeBlocked ? "Add a handoff note to record verification before closing" : undefined}
          >
            Close bead
          </Button>
        ) : null}
      </div>
      {closeBlocked && !composing ? (
        <p className="fwq-card-hint">Add a handoff note to record verification before closing.</p>
      ) : null}
      {composing && beadId ? (
        <div className="fwq-note">
          <textarea
            ref={noteInputRef}
            className="fwq-note-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Handoff note for ${beadId} — what you verified…`}
            aria-label={`Handoff note for ${beadId}`}
            rows={2}
            disabled={busy}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitNote();
              }
              // Escape closes but keeps the draft — an accidental Escape must
              // not destroy typed verification text (Cancel is the clear).
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeComposer();
              }
            }}
          />
          <div className="fwq-note-actions">
            <Button variant="ghost" size="xs" onClick={() => closeComposer({ clearDraft: true })} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="xs"
              loading={busy}
              leadingIcon="ph:plus"
              onClick={() => void submitNote()}
              disabled={!draft.trim() || busy}
            >
              Add note
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

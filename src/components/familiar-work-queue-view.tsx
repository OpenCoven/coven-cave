"use client";

import "@/styles/familiar-work-queue.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { useAnnouncer } from "@/components/ui/live-region";
import { usePausablePoll } from "@/lib/use-pausable-poll";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import {
  buildWorkQueue,
  hasVerificationEvidence,
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

async function fetchQueue(signal: AbortSignal): Promise<WorkQueue> {
  const [beadsRes, prsRes] = await Promise.all([
    fetch("/api/beads?mode=ready", { cache: "no-store", signal }),
    fetch("/api/beads/prs", { cache: "no-store", signal }),
  ]);
  const beadsJson = await beadsRes.json();
  const prsJson = await prsRes.json();
  if (!prsJson.ok) throw new Error(prsJson.error || "PR bridge unavailable");
  const readyBeads: ReadyBead[] = beadsJson.ok && Array.isArray(beadsJson.data) ? beadsJson.data : [];
  const open: PullRequestSummary[] = Array.isArray(prsJson.open) ? prsJson.open : [];
  const merged: MergedPrRef[] = Array.isArray(prsJson.merged) ? prsJson.merged : [];
  return buildWorkQueue(readyBeads, open, merged, { nowMs: Date.now() });
}

export function FamiliarWorkQueueView({ familiars = [], onOpenUrl }: Props) {
  const { announce } = useAnnouncer();
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [familiarFilter, setFamiliarFilter] = useState<string | null>(null);
  // Beads that got a handoff note THIS session — Close unlocks immediately
  // without waiting for the poll to re-read comment_count (cave-hlv.2).
  const [evidenceAdded, setEvidenceAdded] = useState<Set<string>>(() => new Set());
  const loadSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet === true;
      const seq = ++loadSeq.current;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const next = await fetchQueue(ctrl.signal);
        if (seq !== loadSeq.current) return; // a newer load won
        setQueue(next);
        setError(null);
      } catch (err) {
        if (ctrl.signal.aborted || seq !== loadSeq.current) return;
        if (!quiet) setError(err instanceof Error ? err.message : "Failed to load the work queue");
      } finally {
        if (seq === loadSeq.current) setHasLoaded(true);
      }
    },
    [],
  );

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

  usePausablePoll(() => void load({ quiet: true }), 30_000, { pauseWhileInputActive: true });

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
        await load({ quiet: true });
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
        await load({ quiet: true });
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
        <div className="fwq-head">
          <h2 className="fwq-title">Familiar Work Queue</h2>
        </div>
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
      <div className="fwq-head">
        <div className="fwq-head-main">
          <h2 className="fwq-title">Familiar Work Queue</h2>
          <p className="fwq-sub">
            {q.total === 0
              ? "No open PRs or ready beads."
              : `${q.actionable} actionable · ${q.total} total${q.stale ? ` · ${q.stale} stale` : ""}`}
          </p>
        </div>
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

      <div className="fwq-body">
        {q.total === 0 ? (
          <EmptyState
            icon="ph:check-circle"
            headline="Queue is clear"
            subtitle="No open PRs need attention and no ready beads are waiting to ship."
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
  const isCleanup = item.lane === "post-merge-cleanup";
  // Close is exposed on the cleanup lane, but only once verification evidence
  // (a handoff note) is on record — the operator adds one via the composer.
  const closeBlocked = isCleanup && !hasEvidence;

  const submitNote = async () => {
    if (!draft.trim()) return;
    const ok = await onComment(draft);
    if (ok) {
      setDraft("");
      setComposing(false);
    }
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
            }}
          />
          <div className="fwq-note-actions">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setDraft("");
                setComposing(false);
              }}
              disabled={busy}
            >
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

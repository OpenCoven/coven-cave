"use client";

import "@/styles/familiar-work-queue.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/ui/search-input";
import { Modal } from "@/components/ui/modal";
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
import { AsanaQueueStrip } from "@/components/asana-queue-strip";

type Props = {
  /** Rendered inside the Tasks page's Work-queue tab (cave-oa1z): the tab
   *  band provides the surface name, so the view's own h1 stays out. */
  embedded?: boolean;
  familiars?: ResolvedFamiliar[];
  onOpenUrl?: (url: string) => void;
  /** The workspace's active familiar scope. When set, the Asana strip shows
   *  only that agent's assigned tasks; null/undefined = the whole connected
   *  user (the "All familiars" scope). */
  activeFamiliarId?: string | null;
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

/** Long lanes mount this many cards until the operator asks for the rest —
 *  the triage view stays scannable (and cheap) at N-many beads (cave-19jy). */
const LANE_VISIBLE_CAP = 8;

const COLLAPSED_LANES_KEY = "cave:fwq:collapsed:v1";

/** Lanes collapsed on first run — `waiting` is explicitly non-actionable. */
const DEFAULT_COLLAPSED: readonly WorkQueueLaneKey[] = ["waiting"];

function readCollapsedLanes(): Set<WorkQueueLaneKey> {
  if (typeof window === "undefined") return new Set(DEFAULT_COLLAPSED);
  try {
    const raw = window.localStorage.getItem(COLLAPSED_LANES_KEY);
    if (!raw) return new Set(DEFAULT_COLLAPSED);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_COLLAPSED);
    return new Set(parsed.filter((k): k is WorkQueueLaneKey => typeof k === "string" && k in LANE_TITLES_GUARD));
  } catch {
    return new Set(DEFAULT_COLLAPSED);
  }
}

function writeCollapsedLanes(keys: Set<WorkQueueLaneKey>): void {
  try {
    window.localStorage.setItem(COLLAPSED_LANES_KEY, JSON.stringify([...keys]));
  } catch {
    /* storage unavailable — collapse state stays session-local */
  }
}

// Key-guard for the storage parse above (LANE_ICON covers every lane key).
const LANE_TITLES_GUARD = LANE_ICON;

type FetchedQueue = {
  queue: WorkQueue;
  /** False when the beads adapter failed and the queue is PRs-only. */
  beadsOk: boolean;
  /** False when the PR bridge failed and the queue is beads-only. */
  prsOk: boolean;
  /** The PR bridge's error, kept for the degradation banner's tooltip. */
  prsError: string | null;
};

// Either source alone still renders a useful queue, so a single failing
// adapter DEGRADES the surface (with a truthful banner) instead of failing the
// whole load: beads-only when the gh PR bridge is down, PRs-only when the
// beads adapter is down. Only both failing rejects — then there is genuinely
// nothing to show.
async function fetchQueue(signal: AbortSignal): Promise<FetchedQueue> {
  const [beadsSettled, prsSettled] = await Promise.allSettled([
    fetch("/api/beads?mode=ready", { cache: "no-store", signal }).then((res) => res.json()),
    fetch("/api/beads/prs", { cache: "no-store", signal }).then((res) => res.json()),
  ]);

  let readyBeads: ReadyBead[] = [];
  let beadsOk = false;
  if (beadsSettled.status === "fulfilled" && beadsSettled.value.ok && Array.isArray(beadsSettled.value.data)) {
    readyBeads = beadsSettled.value.data;
    beadsOk = true;
  }

  let open: PullRequestSummary[] = [];
  let merged: MergedPrRef[] = [];
  let prsOk = false;
  let prsError: string | null = null;
  if (prsSettled.status === "fulfilled" && prsSettled.value.ok) {
    open = Array.isArray(prsSettled.value.open) ? prsSettled.value.open : [];
    merged = Array.isArray(prsSettled.value.merged) ? prsSettled.value.merged : [];
    prsOk = true;
  } else {
    prsError =
      prsSettled.status === "rejected"
        ? prsSettled.reason instanceof Error
          ? prsSettled.reason.message
          : String(prsSettled.reason)
        : prsSettled.value.error || "PR bridge unavailable";
  }

  if (!beadsOk && !prsOk) throw new Error(prsError || "queue sources unavailable");

  return { queue: buildWorkQueue(readyBeads, open, merged, { nowMs: Date.now() }), beadsOk, prsOk, prsError };
}

// Content equality for the poll: the queue is a plain, deterministically-built
// object graph, so serialized comparison is exact. Keeping the previous state
// identity on a no-change poll stops the 30s tick from re-rendering every
// lane/card (and resetting nothing) for an identical picture.
function sameQueue(a: WorkQueue, b: WorkQueue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function FamiliarWorkQueueView({ familiars = [], onOpenUrl, embedded = false, activeFamiliarId }: Props) {
  const { announce } = useAnnouncer();
  const [queue, setQueue] = useState<WorkQueue | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [beadsDegraded, setBeadsDegraded] = useState(false);
  const [prsDegraded, setPrsDegraded] = useState<string | null>(null);
  // ISO timestamp of the last successful load — the header's truthfulness
  // signal. If quiet polls fail, this readout ages instead of lying "fresh".
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [familiarFilter, setFamiliarFilter] = useState<string | null>(null);
  // Triage tools (cave-u2p1): text search over title/bead-id/PR number, a
  // priority band filter, and an in-lane sort toggle. All client-side over
  // the already-fetched queue.
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<"all" | "p0" | "p1" | "p2plus">("all");
  const [sortMode, setSortMode] = useState<"priority" | "recent">("priority");
  // Bead detail drawer — the id being inspected, null = closed.
  const [detailId, setDetailId] = useState<string | null>(null);
  // Per-lane disclosure + show-all state. Collapse persists across sessions;
  // "show all" is per-visit intent and resets on reload (cave-19jy).
  const [collapsedLanes, setCollapsedLanes] = useState<Set<WorkQueueLaneKey>>(() => new Set(DEFAULT_COLLAPSED));
  const [expandedLanes, setExpandedLanes] = useState<Set<WorkQueueLaneKey>>(() => new Set());
  // Beads that got a handoff note THIS session — Close unlocks immediately
  // without waiting for the poll to re-read comment_count (cave-hlv.2).
  const [evidenceAdded, setEvidenceAdded] = useState<Set<string>>(() => new Set());
  const loadSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  // True once a load has landed WITH PR-bridge data. A later bridge failure is
  // then a refresh failure (keep the richer on-screen picture + inline retry
  // banner) rather than a degradation (which would silently drop PR lanes).
  const hadPrDataRef = useRef(false);
  // Re-render ~once a minute so the header freshness and per-card ages stay
  // truthful between polls (the equality guard below keeps queue state stable,
  // so nothing else would tick them).
  useMinuteTick();

  // Collapse state hydrates after mount so SSR and the first client render
  // agree (same idiom as the chat sidebar's organize view).
  useEffect(() => {
    setCollapsedLanes(readCollapsedLanes());
  }, []);

  const toggleLane = useCallback((key: WorkQueueLaneKey) => {
    setCollapsedLanes((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsedLanes(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { queue: next, beadsOk, prsOk, prsError } = await fetchQueue(ctrl.signal);
      if (seq !== loadSeq.current) return; // a newer load won
      if (!prsOk && hadPrDataRef.current) {
        // The bridge worked before and just failed — keep earlier data on
        // screen with the retry banner instead of swapping in a poorer,
        // beads-only queue.
        setError(prsError || "PR bridge unavailable");
        return;
      }
      setQueue((prev) => (prev && sameQueue(prev, next) ? prev : next));
      setBeadsDegraded(!beadsOk);
      setPrsDegraded(prsOk ? null : prsError || "PR bridge unavailable");
      if (prsOk) hadPrDataRef.current = true;
      setError(null);
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      if (ctrl.signal.aborted || seq !== loadSeq.current) return;
      // Keep whatever data is on screen — the render picks between the
      // full-surface empty state (no data yet) and the inline refresh banner.
      setError(err instanceof Error ? err.message : "Failed to load the queue");
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
        ? "Queue is clear — no open PRs or ready beads."
        : `Queue loaded: ${queue.actionable} actionable of ${queue.total}.`,
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

  // Search matches title, bead id, and PR number; priority bands map P2+
  // together (protocol priorities rarely exceed 2 in practice).
  const visibleLanes = useMemo(() => {
    if (!queue) return [];
    const q = search.trim().toLowerCase();
    const matchesSearch = (item: WorkQueueItem): boolean => {
      if (!q) return true;
      const title = item.pr?.title ?? item.merged?.title ?? item.bead?.title ?? "";
      const prNumber = item.pr?.number ?? item.merged?.number ?? null;
      return (
        title.toLowerCase().includes(q) ||
        (item.bead?.id.toLowerCase().includes(q) ?? false) ||
        (prNumber != null && (`#${prNumber}`.includes(q) || String(prNumber).includes(q)))
      );
    };
    const matchesPriority = (item: WorkQueueItem): boolean => {
      if (priorityFilter === "all") return true;
      const p = item.bead?.priority;
      if (p == null) return false;
      if (priorityFilter === "p0") return p === 0;
      if (priorityFilter === "p1") return p === 1;
      return p >= 2;
    };
    const recency = (item: WorkQueueItem): number =>
      Date.parse(item.pr?.updatedAt ?? item.merged?.mergedAt ?? item.bead?.updated_at ?? "") || 0;
    return queue.lanes
      .map((lane) => {
        let items = lane.items.filter(
          (i) => (!familiarFilter || i.familiar === familiarFilter) && matchesSearch(i) && matchesPriority(i),
        );
        // "priority" keeps buildWorkQueue's deterministic triage order;
        // "recent" re-sorts the filtered copy without touching queue state
        // (sameQueue identity across polls stays stable).
        if (sortMode === "recent") items = [...items].sort((a, b) => recency(b) - recency(a));
        return { ...lane, items };
      })
      .filter((lane) => lane.items.length > 0);
  }, [queue, familiarFilter, search, priorityFilter, sortMode]);

  if (!hasLoaded) {
    return (
      <div className="fwq" aria-busy>
        <header className="surface-compact-header">
          {embedded ? null : <h1 className="surface-compact-title">Queue</h1>}
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
            headline="Couldn't load the queue"
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
        {embedded ? null : <h1 className="surface-compact-title">Queue</h1>}
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
            aria-label="Refresh queue"
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

      {/* Triage toolbar (cave-u2p1): search · priority bands · sort. */}
      <div className="fwq-toolbar" role="group" aria-label="Queue triage tools">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          onClear={() => setSearch("")}
          placeholder="Search title, bead id, PR #…"
          aria-label="Search the queue"
          containerClassName="fwq-toolbar-search"
        />
        <div className="fwq-toolbar-group" role="group" aria-label="Filter by priority">
          {(
            [
              ["all", "All"],
              ["p0", "P0"],
              ["p1", "P1"],
              ["p2plus", "P2+"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`fwq-chip${priorityFilter === value ? " is-active" : ""}`}
              aria-pressed={priorityFilter === value}
              onClick={() => setPriorityFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="fwq-chip fwq-toolbar-sort"
          aria-pressed={sortMode === "recent"}
          onClick={() => setSortMode((cur) => (cur === "priority" ? "recent" : "priority"))}
          title={sortMode === "priority" ? "Sort by recently updated" : "Sort by priority and oldest"}
        >
          <Icon name={sortMode === "priority" ? "ph:sort-ascending" : "ph:clock"} width={13} aria-hidden />
          {sortMode === "priority" ? "Priority · oldest" : "Recently updated"}
        </button>
      </div>

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
      {prsDegraded ? (
        <div className="fwq-banner fwq-banner--warn" role="status" title={prsDegraded}>
          <Icon name="ph:plugs" width={14} aria-hidden />
          <span className="fwq-banner-text">
            GitHub PR bridge unavailable — showing ready beads only; PR lanes are hidden.
          </span>
        </div>
      ) : null}

      {q.attention.length > 0 ? <AttentionStrip items={q.attention} onOpenUrl={onOpenUrl} /> : null}

      <AsanaQueueStrip onOpenUrl={onOpenUrl} onFiledBead={() => void load()} familiarId={activeFamiliarId} />

      <div className="fwq-body">
        {q.total === 0 ? (
          <EmptyState
            icon="ph:check-circle"
            headline="Queue is clear"
            subtitle={
              beadsDegraded
                ? "No open PRs need attention. Bead lanes (beads are the queue's tracked tasks) are unavailable right now."
                : "No open PRs need attention and no ready beads — the queue's tracked tasks — are waiting to ship."
            }
          />
        ) : visibleLanes.length === 0 ? (
          <EmptyState
            icon="ph:funnel"
            headline="Nothing matches the current filters"
            subtitle={
              search.trim()
                ? `No queue item matches “${search.trim()}”.`
                : "Clear the filters to see the whole queue."
            }
            actions={
              <Button
                variant="secondary"
                onClick={() => {
                  setFamiliarFilter(null);
                  setSearch("");
                  setPriorityFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          visibleLanes.map((lane) => {
            const collapsed = collapsedLanes.has(lane.key);
            const showAll = expandedLanes.has(lane.key);
            const capped = !showAll && lane.items.length > LANE_VISIBLE_CAP;
            const visibleItems = capped ? lane.items.slice(0, LANE_VISIBLE_CAP) : lane.items;
            return (
              <section key={lane.key} className={`fwq-lane fwq-lane--${LANE_TONE[lane.key]}`} aria-label={lane.title}>
                <header className="fwq-lane-head">
                  <button
                    type="button"
                    className="fwq-lane-toggle focus-ring-inset"
                    aria-expanded={!collapsed}
                    onClick={() => toggleLane(lane.key)}
                  >
                    <Icon
                      name="ph:caret-right-bold"
                      width={11}
                      className={`fwq-lane-caret${collapsed ? "" : " is-open"}`}
                      aria-hidden
                    />
                    <Icon name={LANE_ICON[lane.key]} width={15} aria-hidden />
                    <span className="fwq-lane-title">{lane.title}</span>
                    <span className="fwq-lane-count">{lane.items.length}</span>
                  </button>
                </header>
                {collapsed ? null : (
                  <>
                    <ul className="fwq-cards">
                      {visibleItems.map((item) => (
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
                          onInspect={item.bead ? () => setDetailId(item.bead!.id) : undefined}
                        />
                      ))}
                    </ul>
                    {lane.items.length > LANE_VISIBLE_CAP ? (
                      <button
                        type="button"
                        className="fwq-lane-more focus-ring-inset"
                        aria-expanded={showAll}
                        onClick={() =>
                          setExpandedLanes((cur) => {
                            const next = new Set(cur);
                            if (next.has(lane.key)) next.delete(lane.key);
                            else next.add(lane.key);
                            return next;
                          })
                        }
                      >
                        {showAll
                          ? `Show top ${LANE_VISIBLE_CAP}`
                          : `Show all ${lane.items.length}`}
                      </button>
                    ) : null}
                  </>
                )}
              </section>
            );
          })
        )}
      </div>

      {detailId ? (
        <BeadDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onClaim={() => {
            const item = q.lanes.flatMap((l) => l.items).find((i) => i.bead?.id === detailId);
            if (item) void runAction(item, "claim");
            setDetailId(null);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Bead inspector (cave-u2p1) — the queue row names the work; this shows the
 * work itself. Reads `bd show --json` through the existing (previously
 * unused) GET /api/beads?mode=show contract. Read-mostly: Claim + copy-id
 * ride along; notes stay on the card's composer.
 */
function BeadDetailModal({
  id,
  onClose,
  onClaim,
}: {
  id: string;
  onClose: () => void;
  onClaim: () => void;
}) {
  type BeadDetail = {
    id?: string;
    title?: string;
    description?: string | null;
    status?: string;
    priority?: number;
    assignee?: string | null;
    owner?: string | null;
    labels?: string[] | null;
    created_at?: string | null;
    updated_at?: string | null;
    dependencies?: unknown[] | null;
    comment_count?: number | null;
  };
  const [detail, setDetail] = useState<BeadDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const { announce } = useAnnouncer();

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setDetailError(null);
    fetch(`/api/beads?mode=show&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (!json.ok) throw new Error(json.error || "bead unavailable");
        // bd show --json returns the bead object (or a one-element array).
        const data = Array.isArray(json.data) ? json.data[0] : json.data;
        setDetail((data ?? {}) as BeadDetail);
      })
      .catch((err) => {
        if (alive) setDetailError(err instanceof Error ? err.message : "bead unavailable");
      });
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <Modal open onClose={onClose} breadcrumb={["Queue", id]} ariaLabel={`Bead ${id}`}>
      <div className="fwq-detail">
        {detailError ? (
          <p className="fwq-detail-error" role="alert">{detailError}</p>
        ) : !detail ? (
          <SkeletonRows count={4} />
        ) : (
          <>
            <h2 className="fwq-detail-title">{detail.title ?? id}</h2>
            <div className="fwq-card-meta">
              {detail.status ? <span className="fwq-tag">{detail.status}</span> : null}
              {detail.priority != null ? (
                <span className={`fwq-tag fwq-tag--p${Math.min(detail.priority, 3)}`}>P{detail.priority}</span>
              ) : null}
              {detail.assignee ? <span className="fwq-tag fwq-tag--familiar">{detail.assignee}</span> : null}
              {(detail.labels ?? []).map((label) => (
                <span key={label} className="fwq-tag">{label}</span>
              ))}
              {detail.updated_at ? (
                <span className="fwq-card-time" title={new Date(detail.updated_at).toLocaleString()}>
                  updated {relativeTime(detail.updated_at)}
                </span>
              ) : null}
            </div>
            {detail.description ? (
              <pre className="fwq-detail-desc">{detail.description}</pre>
            ) : (
              <p className="fwq-detail-empty">No description on this bead.</p>
            )}
            {Array.isArray(detail.dependencies) && detail.dependencies.length > 0 ? (
              <p className="fwq-detail-deps">
                {detail.dependencies.length} dependenc{detail.dependencies.length === 1 ? "y" : "ies"}
                {detail.comment_count ? ` · ${detail.comment_count} comment${detail.comment_count === 1 ? "" : "s"}` : ""}
              </p>
            ) : detail.comment_count ? (
              <p className="fwq-detail-deps">
                {detail.comment_count} comment{detail.comment_count === 1 ? "" : "s"}
              </p>
            ) : null}
            <div className="fwq-detail-actions">
              <Button
                variant="ghost"
                size="xs"
                leadingIcon="ph:copy"
                onClick={() => {
                  void import("@/lib/clipboard").then(async ({ copyText }) => {
                    announce((await copyText(id)) ? `Copied ${id}.` : "Copy failed.", "polite");
                  });
                }}
              >
                Copy id
              </Button>
              {detail.status === "open" || detail.status === "ready" ? (
                <Button variant="secondary" size="xs" leadingIcon="ph:hand" onClick={onClaim}>
                  Claim
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Modal>
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
  onInspect,
}: {
  item: WorkQueueItem;
  familiarLabel: string;
  busy: boolean;
  hasEvidence: boolean;
  onOpenUrl?: (url: string) => void;
  onClaim: () => void;
  onClose: () => void;
  onComment: (text: string) => Promise<boolean>;
  /** Opens the bead inspector; absent on rows with no bead. */
  onInspect?: () => void;
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
          {onInspect ? (
            <button
              type="button"
              className="fwq-card-name fwq-card-name--link focus-ring-inset"
              title={`Inspect ${beadId}`}
              onClick={onInspect}
            >
              {title}
            </button>
          ) : (
            <span className="fwq-card-name">{title}</span>
          )}
        </div>
        <div className="fwq-card-meta">
          <span className="fwq-tag fwq-tag--familiar">{familiarLabel}</span>
          {item.surface ? <span className="fwq-tag">{item.surface}</span> : null}
          {beadId ? <span className="fwq-tag fwq-tag--bead">{beadId}</span> : null}
          {item.bead && !item.pr && !item.merged ? (
            <span className={`fwq-tag fwq-tag--p${Math.min(item.bead.priority, 3)}`}>P{item.bead.priority}</span>
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
          {!item.pr && !item.merged && item.bead?.updated_at ? (
            <span className="fwq-card-time" title={new Date(item.bead.updated_at).toLocaleString()}>
              updated {relativeTime(item.bead.updated_at)}
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
          <Button
            variant="secondary"
            size="xs"
            loading={busy}
            leadingIcon="ph:hand"
            onClick={onClaim}
            title="Take this work item (bead) — marks it in progress under your name"
          >
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
            title={
              closeBlocked
                ? "Add a handoff note to record verification before closing"
                : "Mark this work item (bead) complete — it leaves the queue"
            }
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

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
import { subscribeToQueueProjectSelection, type QueueProjectSelection } from "@/lib/queue-project-selection";
import { QueueProjectSetup } from "@/components/queue-project-setup";
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
import {
  AttentionStrip,
  BeadDetailModal,
  WorkQueueCard,
} from "@/components/familiar-work-queue-sections";

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

type QueueSource = { ok?: boolean; data?: ReadyBead[]; open?: PullRequestSummary[]; merged?: MergedPrRef[]; error?: string };
type QueueReadiness = {
  ok: boolean;
  code?: string;
  message: string;
  canGenerate: boolean;
  project: { id: string; name: string; root: string } | null;
};

// Either source alone still renders a useful queue, so a single failing
// adapter DEGRADES the surface (with a truthful banner) instead of failing the
// whole load: beads-only when the gh PR bridge is down, PRs-only when the
// beads adapter is down. Only both failing rejects — then there is genuinely
// nothing to show.
async function fetchQueue(projectRoot: string, signal: AbortSignal): Promise<FetchedQueue> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const query = `projectRoot=${encodeURIComponent(projectRoot)}`;
  const readJson = async (url: string): Promise<QueueSource> => {
    const response = await fetch(url, { cache: "no-store", signal });
    return response.json() as Promise<QueueSource>;
  };
  // The Queue always supplies its explicitly selected project. In particular,
  // do not let a packaged desktop sidecar substitute its application-resource
  // cwd for the user's repository.
  const data = await Promise.allSettled([
    readJson(`/api/beads?mode=ready&${query}`),
    readJson(`/api/beads/prs?${query}`),
  ]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const [beadsSettled, prsSettled] = data;

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
  const [readiness, setReadiness] = useState<QueueReadiness | null>(null);
  const [readinessFailure, setReadinessFailure] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
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
  // Scope segment (queue redesign): All vs. Unassigned. "Unassigned" narrows to
  // work no familiar has picked up yet (the fastest thing to claim); it composes
  // with — does not replace — the per-familiar rollup chips below it.
  const [scope, setScope] = useState<"all" | "unassigned">("all");
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
  const queueSurfaceRef = useRef<HTMLDivElement | null>(null);
  const restoreQueueFocusRef = useRef(false);
  const announcedRef = useRef(false);
  // True once a load has landed WITH PR-bridge data. A later bridge failure is
  // then a refresh failure (keep the richer on-screen picture + inline retry
  // banner) rather than a degradation (which would silently drop PR lanes).
  const hadPrDataRef = useRef(false);
  const activeProjectRootRef = useRef<string | null>(null);

  const resetForProject = useCallback((project: QueueProjectSelection | null) => {
    const surface = queueSurfaceRef.current;
    const focusedQueueControl = surface?.contains(document.activeElement) ?? false;
    activeProjectRootRef.current = project?.root ?? null;
    hadPrDataRef.current = false;
    announcedRef.current = false;
    setQueue(null);
    setReadiness(null);
    setReadinessFailure(null);
    setError(null);
    setBeadsDegraded(false);
    setPrsDegraded(null);
    setLastUpdated(null);
    setBusyId(null);
    setDetailId(null);
    setEvidenceAdded(new Set());
    if (focusedQueueControl) {
      restoreQueueFocusRef.current = true;
      surface?.focus({ preventScroll: true });
    }
  }, []);
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

  const load = useCallback(async (force = false) => {
    const seq = ++loadSeq.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let readinessResolved = false;
    try {
      const readinessResponse = await fetch("/api/queue/readiness", { cache: "no-store", signal: ctrl.signal });
      const readinessJson = (await readinessResponse.json()) as { ok?: boolean; readiness?: QueueReadiness; error?: string };
      const nextReadiness = readinessJson.readiness;
      if (!readinessResponse.ok || !readinessJson.ok || !nextReadiness) {
        throw new Error(readinessJson.error || "Couldn't check the Queue project");
      }
      if (seq !== loadSeq.current) return;
      setReadinessFailure(null);
      readinessResolved = true;
      const nextRoot = nextReadiness.project?.root ?? null;
      if (activeProjectRootRef.current !== nextRoot) {
        // A selected repository is an isolation boundary. Do not retain cards,
        // failure state, detail selection, or evidence from the prior project.
        resetForProject(nextReadiness.project);
      }
      setReadiness(nextReadiness);
      if (!nextReadiness.ok || !nextReadiness.project) {
        setQueue(null);
        setError(nextReadiness.message);
        return;
      }
      const { queue: next, beadsOk, prsOk, prsError } = await fetchQueue(nextReadiness.project.root, ctrl.signal);
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
      if (!readinessResolved) setReadinessFailure(err instanceof Error ? err.message : "Couldn't check the Queue project");
    } finally {
      if (seq === loadSeq.current) setHasLoaded(true);
    }
  }, [resetForProject]);

  const generateQueue = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const response = await fetch("/api/queue/readiness", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate", projectId: readiness?.project?.id }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; readiness?: QueueReadiness } | null;
      if (!response.ok || !json?.ok) {
        // Another Cave window can change the persisted selection while this
        // Generate request is in flight. The route returns that newer
        // readiness on 409: adopt it immediately so a retry targets B, not
        // the stale A button the user originally pressed.
        if (response.status === 409 && json?.readiness) {
          resetForProject(json.readiness.project);
          setReadiness(json.readiness);
          setError(json.error || json.readiness.message);
          void load(true);
          return;
        }
        throw new Error(json?.error || "Couldn't generate the Queue workspace");
      }
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate the Queue workspace");
    } finally {
      setGenerating(false);
    }
  }, [generating, load, readiness?.project?.id, resetForProject]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    return subscribeToQueueProjectSelection((project) => {
      // Selection is an isolation boundary even if its readiness request is
      // unavailable. Clear all prior-project controls synchronously so a
      // transient B failure cannot leave actionable cards from A on screen.
      resetForProject(project);
      void load(true);
    });
  }, [load, resetForProject]);

  // Announce the actionable count once the first load settles.
  useEffect(() => {
    if (!hasLoaded || announcedRef.current || !queue) return;
    announcedRef.current = true;
    announce(
      queue.total === 0
        ? "Queue is clear — no open PRs or ready beads."
        : `Queue loaded: ${queue.actionable} actionable of ${queue.total}.`,
    );
  }, [hasLoaded, queue, announce]);

  // The selected project can replace the focused row action with a loading
  // state. Keep keyboard focus on the Queue surface, then restore it there
  // after the new project settles instead of dropping users onto document body.
  useEffect(() => {
    if (!restoreQueueFocusRef.current || !hasLoaded || (!queue && !error)) return;
    restoreQueueFocusRef.current = false;
    queueSurfaceRef.current?.focus({ preventScroll: true });
  }, [hasLoaded, queue, error]);

  usePausablePoll(() => void load(true), 30_000, { pauseWhileInputActive: true });

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
      const projectRoot = readiness?.project?.root;
      if (!id || !projectRoot) return;
      setBusyId(item.key);
      try {
        const body: Record<string, string> = { action, id, projectRoot };
        if (action === "close") body.reason = item.merged ? `Merged in PR #${item.merged.number}` : "Completed";
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || `${action} failed`);
        announce(action === "claim" ? `Claimed ${id}.` : `Closed ${id}.`);
        await load(true);
      } catch (err) {
        announce(err instanceof Error ? err.message : `Could not ${action} ${id}`, "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, readiness?.project?.root],
  );

  // Handoff note: appends a comment to the bead (the recorded verification
  // evidence that unlocks Close). Returns whether it landed so the card's inline
  // composer can stay open on failure. cave-hlv.2.
  const runComment = useCallback(
    async (item: WorkQueueItem, text: string): Promise<boolean> => {
      const id = item.bead?.id;
      const comment = text.trim();
      const projectRoot = readiness?.project?.root;
      if (!id || !comment || !projectRoot) return false;
      setBusyId(item.key);
      try {
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "comment", id, comment, projectRoot }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "comment failed");
        // A comment can complete after the user selects a different Queue
        // project. Its evidence belongs only to the root that initiated it;
        // otherwise an equal bead id in the new project could unlock Close.
        if (activeProjectRootRef.current !== projectRoot) return false;
        setEvidenceAdded((prev) => new Set(prev).add(id.toLowerCase()));
        announce(`Handoff note added to ${id}.`);
        await load(true);
        return true;
      } catch (err) {
        announce(err instanceof Error ? err.message : `Could not add a note to ${id}`, "assertive");
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, readiness?.project?.root],
  );

  // Claim-for-familiar: same claim action, but the bead lands on the picked
  // familiar (the API turns assignee into --assignee/--status flags) instead
  // of the connected user (cave-p63a).
  const runClaimFor = useCallback(
    async (item: WorkQueueItem, familiar: ResolvedFamiliar) => {
      const id = item.bead?.id;
      const projectRoot = readiness?.project?.root;
      if (!id || !projectRoot) return;
      setBusyId(item.key);
      try {
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "claim", id, assignee: familiar.id, projectRoot }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "claim failed");
        announce(`Claimed ${id} for ${familiar.display_name}.`);
        await load(true);
      } catch (err) {
        announce(err instanceof Error ? err.message : `Could not claim ${id}`, "assertive");
      } finally {
        setBusyId(null);
      }
    },
    [announce, load, readiness?.project?.root],
  );

  // File a bead for an unlinked attention-strip PR: bd create with the PR's
  // title, a description carrying the PR URL (the queue's ref join reads it —
  // ready output has no external_ref), and externalRef gh-<n> for the
  // visibility layer. Returns whether it landed so the strip's per-row button
  // can drop its busy state truthfully (cave-p63a).
  const runFileBead = useCallback(
    async (pr: PullRequestSummary): Promise<boolean> => {
      const projectRoot = readiness?.project?.root;
      if (!projectRoot) return false;
      try {
        const res = await fetch("/api/beads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            title: pr.title,
            description: `Filed from unlinked PR #${pr.number} — ${pr.url}`,
            externalRef: `gh-${pr.number}`,
            labels: ["from-pr"],
            projectRoot,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "create failed");
        const beadId = (json.data as { id?: string } | null)?.id;
        announce(beadId ? `Filed ${beadId} for PR #${pr.number}.` : `Filed a bead for PR #${pr.number}.`);
        await load(true);
        return true;
      } catch (err) {
        announce(
          err instanceof Error ? err.message : `Could not file a bead for PR #${pr.number}`,
          "assertive",
        );
        return false;
      }
    },
    [announce, load, readiness?.project?.root],
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
    const matchesScope = (item: WorkQueueItem): boolean =>
      scope === "all" || item.familiar === "unassigned";
    return queue.lanes
      .map((lane) => {
        let items = lane.items.filter(
          (i) =>
            (!familiarFilter || i.familiar === familiarFilter) &&
            matchesScope(i) &&
            matchesSearch(i) &&
            matchesPriority(i),
        );
        // "priority" keeps buildWorkQueue's deterministic triage order;
        // "recent" re-sorts the filtered copy without touching queue state
        // (sameQueue identity across polls stays stable).
        if (sortMode === "recent") items = [...items].sort((a, b) => recency(b) - recency(a));
        return { ...lane, items };
      })
      .filter((lane) => lane.items.length > 0);
  }, [queue, familiarFilter, scope, search, priorityFilter, sortMode]);

  // Scope counts for the segment (unfiltered by search/priority/familiar — the
  // segment shows the whole-queue split, like the meta row's totals).
  const scopeCounts = useMemo(() => {
    if (!queue) return { all: 0, unassigned: 0 };
    let unassigned = 0;
    for (const lane of queue.lanes) {
      for (const item of lane.items) if (item.familiar === "unassigned") unassigned += 1;
    }
    return { all: queue.total, unassigned };
  }, [queue]);

  // A project-selection event intentionally clears the prior Queue before the
  // next readiness response arrives. Render a short loading state during that
  // gap rather than dereferencing the removed Queue or retaining its controls.
  if (!hasLoaded || (!queue && !error)) {
    return (
      <div ref={queueSurfaceRef} className="fwq" tabIndex={-1} aria-busy>
        <header className="surface-compact-header">
          {embedded ? null : <h1 className="surface-compact-title">Queue</h1>}
        </header>
        <div className="fwq-body">
          <p role="status" aria-live="polite" className="sr-only">Loading the selected Queue project…</p>
          <SkeletonRows count={6} />
        </div>
      </div>
    );
  }

  if (error && !queue) {
    const canGenerate = readiness?.canGenerate === true;
    const readinessUnavailable = readinessFailure !== null;
    const sourcesUnavailable = !readinessUnavailable && readiness?.ok === true && readiness.project !== null;
    const selectionRemediable = readiness?.code === "no-project"
      || readiness?.code === "project-missing"
      || readiness?.code === "project-not-allowed"
      || readiness?.code === "not-git-repository"
      || readiness?.code === "project-not-git-root"
      || readiness?.code === "project-storage-error";
    const projectUnavailable = !readinessUnavailable && !sourcesUnavailable && !canGenerate && !selectionRemediable && readiness?.project !== null;
    return (
      <div ref={queueSurfaceRef} className="fwq" tabIndex={-1}>
        <div className="fwq-body">
          <EmptyState
            icon="ph:warning-circle"
            headline={readinessUnavailable ? "Queue check unavailable" : sourcesUnavailable ? "Queue sources unavailable" : canGenerate ? "Generate your Queue" : projectUnavailable ? "Queue project needs attention" : "Queue needs a project"}
            subtitle={readinessUnavailable ? readinessFailure : error}
            actions={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {readinessUnavailable || sourcesUnavailable || projectUnavailable ? null : canGenerate ? (
                  <Button variant="primary" leadingIcon="ph:magic-wand-fill" loading={generating} onClick={() => void generateQueue()}>
                    Generate
                  </Button>
                ) : (
                  // Queue setup happens here, on the tab itself — selection
                  // publishes, the subscription resets state, and load(true)
                  // re-reads readiness for the newly chosen repository.
                  <QueueProjectSetup selectedProjectId={readiness?.project?.id ?? null} />
                )}
                <Button variant="secondary" leadingIcon="ph:arrow-clockwise" onClick={() => void load(true)}>
                  Retry
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const q = queue!;

  return (
    <div ref={queueSurfaceRef} className="fwq" tabIndex={-1}>
      {/* Meta row (queue redesign) — the live summary with a truthful
          "updated Xm ago" readout, Refresh on the right. The surface title +
          Tasks/Queue tabs live in the hosting board header (embedded). */}
      <header className="fwq-meta">
        {embedded ? null : <h1 className="fwq-meta-title">Queue</h1>}
        <p className="fwq-meta-summary">
          {q.total === 0 ? (
            "No open PRs or ready beads."
          ) : (
            <>
              <span className="fwq-meta-strong">{q.actionable}</span> actionable
              <span className="fwq-meta-sep">·</span>
              <span className="fwq-meta-count">{q.total}</span> total
              {q.stale ? (
                <>
                  <span className="fwq-meta-sep">·</span>
                  {q.stale} stale
                </>
              ) : null}
            </>
          )}
          {lastUpdated ? (
            <>
              <span className="fwq-meta-sep">·</span>updated {relativeTime(lastUpdated)}
            </>
          ) : null}
        </p>
        <button
          type="button"
          className="fwq-refresh"
          onClick={() => void load(true)}
          aria-label="Refresh queue"
        >
          <Icon name="ph:arrow-clockwise" width={14} className="fwq-refresh-icon" aria-hidden />
          Refresh
        </button>
      </header>

      {/* Scope segment — All vs. Unassigned (whole-queue split, unfiltered). */}
      <div className="fwq-scope-row">
        <div className="fwq-seg" role="group" aria-label="Filter by scope">
          {(
            [
              ["all", "All", scopeCounts.all],
              ["unassigned", "Unassigned", scopeCounts.unassigned],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              className={`fwq-seg-btn${scope === value ? " is-active" : ""}`}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              <span>{label}</span>
              <span className="fwq-seg-count">{count}</span>
            </button>
          ))}
        </div>
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
        <div className="fwq-seg" role="group" aria-label="Filter by priority">
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
              className={`fwq-seg-btn fwq-seg-btn--sm${priorityFilter === value ? " is-active" : ""}`}
              aria-pressed={priorityFilter === value}
              onClick={() => setPriorityFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="fwq-sort"
          aria-pressed={sortMode === "recent"}
          onClick={() => setSortMode((cur) => (cur === "priority" ? "recent" : "priority"))}
          title={sortMode === "priority" ? "Sort by recently updated" : "Sort by priority and oldest"}
        >
          <Icon name={sortMode === "priority" ? "ph:sort-ascending" : "ph:clock"} width={14} aria-hidden />
          {sortMode === "priority" ? "Priority · oldest" : "Recently updated"}
        </button>
      </div>

      {/* Truthful-degradation banners. Text is static (only the tooltip carries
          the raw error) so role=alert doesn't re-announce every failing poll. */}
      {error ? (
        <div className="fwq-banner fwq-banner--danger" role="alert" title={error}>
          <Icon name="ph:warning-circle" width={14} aria-hidden />
          <span className="fwq-banner-text">Couldn&apos;t refresh the queue — showing earlier data.</span>
          <Button variant="ghost" size="xs" leadingIcon="ph:arrow-clockwise" onClick={() => void load(true)}>
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

      {q.attention.length > 0 ? (
        <AttentionStrip items={q.attention} onOpenUrl={onOpenUrl} onFileBead={runFileBead} />
      ) : null}

      <AsanaQueueStrip
        onOpenUrl={onOpenUrl}
        onFiledBead={() => void load(true)}
        familiarId={activeFamiliarId}
        projectRoot={readiness?.project?.root}
      />

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
                  setScope("all");
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
                    <Icon name={LANE_ICON[lane.key]} width={14} className="fwq-lane-icon" aria-hidden />
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
                          familiars={familiars}
                          busy={busyId === item.key}
                          hasEvidence={
                            !!item.bead &&
                            (hasVerificationEvidence(item.bead) || evidenceAdded.has(item.bead.id.toLowerCase()))
                          }
                          onOpenUrl={onOpenUrl}
                          onClaim={() => void runAction(item, "claim")}
                          onClaimFor={(familiar) => void runClaimFor(item, familiar)}
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
          projectRoot={readiness?.project?.root ?? ""}
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

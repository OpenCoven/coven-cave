// Familiar Work Queue model (cave-hlv.4) — the pure join that fuses ready
// beads with the PR bridge's classified open PRs into a per-familiar,
// per-surface control tower. All PR truth comes from the bridge summaries
// (src/lib/beads-pr-management.ts); this module only groups and labels — it
// never re-derives lane/check/review state itself.
import { isStalePr } from "./beads-pr-patrol.ts";
import type { PullRequestSummary } from "./beads-pr-management.ts";

/** Subset of a `bd ready --json` row the queue reads. */
export type ReadyBead = {
  id: string;
  title: string;
  priority: number;
  status: string;
  assignee?: string | null;
  issue_type?: string | null;
  labels?: string[] | null;
  updated_at?: string | null;
  /** Number of comments on the bead (`bd ready --json` includes this). Used as
   *  the verification-evidence signal: a recorded handoff/verification comment
   *  must exist before the queue exposes Close (cave-hlv.2). */
  comment_count?: number | null;
};

/**
 * True when a bead carries recorded verification evidence — i.e. at least one
 * comment (a handoff/verification note). Deliberately NOT satisfied by `notes`
 * (frequently auto-populated planning text) or by a merged PR alone (green CI
 * is not a substitute for a recorded verification per the familiar PR
 * protocol): the operator must add a handoff note, which the queue's inline
 * composer writes as a comment. Gates the Close affordance on the
 * post-merge-cleanup lane.
 */
export function hasVerificationEvidence(bead: ReadyBead | undefined | null): boolean {
  return (bead?.comment_count ?? 0) > 0;
}

/** A recently-merged PR, reduced to what the cleanup lane needs. */
export type MergedPrRef = {
  number: number;
  title: string;
  url: string;
  beadIds: string[];
  mergedAt: string | null;
};

// The named lanes the epic's acceptance requires the surface to be able to
// show, plus a truthful `waiting` bucket for draft/pending/blocked PRs (shown
// but never counted as actionable).
export type WorkQueueLaneKey =
  | "checks-failing"
  | "changes-requested"
  | "needs-review"
  | "ready-to-merge"
  | "waiting"
  | "no-open-PR"
  | "post-merge-cleanup";

export type WorkQueueItem = {
  key: string;
  lane: WorkQueueLaneKey;
  /** familiar:<x> label, or "unassigned". */
  familiar: string;
  /** surface:<y> label, or null. */
  surface: string | null;
  pr?: PullRequestSummary;
  bead?: ReadyBead;
  merged?: MergedPrRef;
  /** PR-backed items only: no activity within the stale window. */
  stale?: boolean;
};

export type WorkQueueLane = {
  key: WorkQueueLaneKey;
  title: string;
  items: WorkQueueItem[];
};

export type FamiliarRollup = {
  familiar: string;
  total: number;
  actionable: number;
  laneCounts: Partial<Record<WorkQueueLaneKey, number>>;
};

/**
 * An open PR that needs housekeeping attention regardless of lane — the two
 * gaps the CLI patrol flags: no linked bead (invisible to the queue) and/or no
 * activity within the stale window. A PR can be both.
 */
export type AttentionItem = {
  pr: PullRequestSummary;
  unlinked: boolean;
  stale: boolean;
};

export type WorkQueue = {
  lanes: WorkQueueLane[];
  byFamiliar: FamiliarRollup[];
  total: number;
  actionable: number;
  stale: number;
  /** Open PRs mentioning no bead — invisible to the queue join. */
  unlinked: number[];
  /** Open PRs that are unlinked and/or stale, with the PR summary for display. */
  attention: AttentionItem[];
};

const LANE_TITLES: Record<WorkQueueLaneKey, string> = {
  "checks-failing": "Checks failing",
  "changes-requested": "Changes requested",
  "needs-review": "Needs review",
  "ready-to-merge": "Ready to merge",
  waiting: "Waiting — draft, pending checks, blocked",
  "no-open-PR": "No open PR",
  "post-merge-cleanup": "Post-merge cleanup",
};

// Render/scan order: fix first, then land, then review, then the bead-driven
// lanes, then waiting last.
const LANE_ORDER: WorkQueueLaneKey[] = [
  "checks-failing",
  "changes-requested",
  "needs-review",
  "ready-to-merge",
  "no-open-PR",
  "post-merge-cleanup",
  "waiting",
];

// Every lane except `waiting` is something a familiar can act on right now.
const ACTIONABLE_LANES: ReadonlySet<WorkQueueLaneKey> = new Set(
  LANE_ORDER.filter((lane) => lane !== "waiting"),
);

function prLaneToQueueLane(prLane: PullRequestSummary["lane"]): WorkQueueLaneKey {
  switch (prLane) {
    case "checks-failing":
      return "checks-failing";
    case "changes-requested":
      return "changes-requested";
    case "needs-review":
      return "needs-review";
    case "ready-to-merge":
      return "ready-to-merge";
    // draft, checks-pending, blocked
    default:
      return "waiting";
  }
}

function labelValue(labels: string[] | null | undefined, prefix: string): string | null {
  for (const label of labels ?? []) {
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  }
  return null;
}

function familiarOf(bead: ReadyBead | undefined): string {
  if (!bead) return "unassigned";
  return labelValue(bead.labels, "familiar:") ?? (bead.assignee?.toLowerCase() || "unassigned");
}

function surfaceOf(bead: ReadyBead | undefined): string | null {
  return labelValue(bead?.labels, "surface:");
}

export function buildWorkQueue(
  readyBeads: ReadyBead[],
  openPrs: PullRequestSummary[],
  mergedPrs: MergedPrRef[],
  opts: { nowMs: number; staleAfterHours?: number },
): WorkQueue {
  const staleAfterHours = opts.staleAfterHours ?? 24;
  const beadById = new Map<string, ReadyBead>();
  for (const bead of readyBeads) beadById.set(bead.id.toLowerCase(), bead);

  const items: WorkQueueItem[] = [];
  let staleCount = 0;
  const unlinked: number[] = [];
  const attention: AttentionItem[] = [];
  const beadIdsWithOpenPr = new Set<string>();

  // 1. Open PRs → their lane, joined to a ready bead when one is referenced.
  for (const pr of openPrs) {
    const isUnlinked = pr.beadIds.length === 0;
    if (isUnlinked) unlinked.push(pr.number);
    const bead = pr.beadIds.map((id) => beadById.get(id)).find(Boolean);
    for (const id of pr.beadIds) beadIdsWithOpenPr.add(id);
    const stale = isStalePr(pr, opts.nowMs, staleAfterHours);
    if (stale) staleCount += 1;
    if (isUnlinked || stale) attention.push({ pr, unlinked: isUnlinked, stale });
    items.push({
      key: `pr:${pr.number}`,
      lane: prLaneToQueueLane(pr.lane),
      familiar: familiarOf(bead),
      surface: surfaceOf(bead),
      pr,
      bead,
      stale,
    });
  }

  // 2. Recently-merged PRs whose bead is still open (present in the ready set)
  //    → the merge landed but the bead wasn't closed. Truthful with the data
  //    on hand; a claimed-but-unclosed bead that dropped out of `ready` won't
  //    appear here (documented limitation — worktree/branch cleanup stays CLI).
  //    Runs before the no-open-PR pass so a bead awaiting cleanup is not ALSO
  //    listed as "needs a PR".
  const beadIdsInCleanup = new Set<string>();
  for (const merged of mergedPrs) {
    const bead = merged.beadIds.map((id) => beadById.get(id)).find(Boolean);
    if (!bead) continue;
    const beadId = bead.id.toLowerCase();
    // A bead whose follow-up PR is still open is not ready to close — it
    // already appears in that PR's lane, and prompting Close while work is in
    // flight would be premature. Likewise a bead landed across several merged
    // PRs is ONE cleanup, not competing Close prompts (first ref wins — `gh`
    // lists most-recently-merged first, so the freshest PR names the close).
    if (beadIdsWithOpenPr.has(beadId) || beadIdsInCleanup.has(beadId)) continue;
    beadIdsInCleanup.add(beadId);
    items.push({
      key: `merged:${merged.number}`,
      lane: "post-merge-cleanup",
      familiar: familiarOf(bead),
      surface: surfaceOf(bead),
      merged,
      bead,
    });
  }

  // 3. Ready beads with no PR (open or awaiting cleanup) referencing them →
  //    work still waiting to ship.
  for (const bead of readyBeads) {
    const id = bead.id.toLowerCase();
    if (beadIdsWithOpenPr.has(id) || beadIdsInCleanup.has(id)) continue;
    if (bead.issue_type === "epic") continue; // epics are containers, not queue work
    items.push({
      key: `bead:${bead.id}`,
      lane: "no-open-PR",
      familiar: familiarOf(bead),
      surface: surfaceOf(bead),
      bead,
    });
  }

  const lanes: WorkQueueLane[] = LANE_ORDER.map((key) => ({
    key,
    title: LANE_TITLES[key],
    items: items
      .filter((item) => item.lane === key)
      .sort((a, b) => itemSortKey(a).localeCompare(itemSortKey(b))),
  })).filter((lane) => lane.items.length > 0);

  const actionable = items.filter((item) => ACTIONABLE_LANES.has(item.lane)).length;

  return {
    lanes,
    byFamiliar: rollupByFamiliar(items),
    total: items.length,
    actionable,
    stale: staleCount,
    unlinked: unlinked.sort((a, b) => a - b),
    attention: attention.sort((a, b) => a.pr.number - b.pr.number),
  };
}

// Stable, deterministic ordering within a lane: PRs by number, beads by
// priority then id — no wall-clock, so the render is reproducible.
function itemSortKey(item: WorkQueueItem): string {
  if (item.pr) return `0:${String(item.pr.number).padStart(8, "0")}`;
  if (item.merged) return `0:${String(item.merged.number).padStart(8, "0")}`;
  if (item.bead) return `1:${item.bead.priority}:${item.bead.id}`;
  return `2:${item.key}`;
}

function rollupByFamiliar(items: WorkQueueItem[]): FamiliarRollup[] {
  const map = new Map<string, FamiliarRollup>();
  for (const item of items) {
    let rollup = map.get(item.familiar);
    if (!rollup) {
      rollup = { familiar: item.familiar, total: 0, actionable: 0, laneCounts: {} };
      map.set(item.familiar, rollup);
    }
    rollup.total += 1;
    if (ACTIONABLE_LANES.has(item.lane)) rollup.actionable += 1;
    rollup.laneCounts[item.lane] = (rollup.laneCounts[item.lane] ?? 0) + 1;
  }
  // "unassigned" trails; otherwise most-actionable first, then by name.
  return [...map.values()].sort((a, b) => {
    if (a.familiar === "unassigned") return 1;
    if (b.familiar === "unassigned") return -1;
    return b.actionable - a.actionable || a.familiar.localeCompare(b.familiar);
  });
}

export function laneTitle(key: WorkQueueLaneKey): string {
  return LANE_TITLES[key];
}

export function isActionableLane(key: WorkQueueLaneKey): boolean {
  return ACTIONABLE_LANES.has(key);
}

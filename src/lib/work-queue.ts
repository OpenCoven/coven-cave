// Familiar Work Queue model (cave-hlv.4) — the pure join that fuses ready
// GitHub issues with the PR bridge's classified open PRs into a per-familiar,
// per-surface control tower. All PR truth comes from the bridge summaries
// (src/lib/pr-management.ts); this module only groups and labels — it
// never re-derives lane/check/review state itself.
import { isStalePr } from "./pr-management.ts";
import { resolveQueueLane } from "./stage-model.ts";
import type { PullRequestSummary } from "./pr-management.ts";

/** Subset of a ready issue (`GET /api/queue/issues?mode=ready`) the queue reads. */
export type ReadyIssue = {
  id: string;
  title: string;
  /** 0 (Critical) … 4 (Backlog) from a `P<n>` label; null when unranked. */
  priority: number | null;
  status: string;
  assignee?: string | null;
  issue_type?: string | null;
  labels?: string[] | null;
  updated_at?: string | null;
  /** Number of comments on the issue. Used as the verification-evidence
   *  signal: a recorded handoff/verification comment must exist before the
   *  queue exposes Close (cave-hlv.2). */
  comment_count?: number | null;
  /** Issue body. The File-issue flow writes the source PR URL here, so the
   *  PR join works from the ready list alone. */
  description?: string | null;
};

// Description fallback for the ref join, anchored to what the queue's
// File-issue flow actually writes: the PR's own URL (repo-qualified), or the
// `Filed from unlinked PR #<n>` signature. A casual mention — "Follow-up to
// PR #88", a foreign repo's /pull/88 URL — must NOT consume the issue as PR
// 88's link (cave-opld; review of #3426). Digit-boundary-guarded so PR 123
// never matches PR 1234's URL or token.
function issueDescriptionMatchesPr(
  description: string | null | undefined,
  pr: Pick<PullRequestSummary, "number" | "url">,
): boolean {
  if (!description) return false;
  const url = pr.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`${url}(?!\\d)`).test(description) ||
    new RegExp(`\\bFiled from unlinked PR #${pr.number}(?!\\d)`).test(description)
  );
}

// An issue filed from a PR carries that PR in its description.
function issueMatchesPr(issue: ReadyIssue, pr: Pick<PullRequestSummary, "number" | "url">): boolean {
  return issueDescriptionMatchesPr(issue.description, pr);
}

/**
 * True when an issue carries recorded verification evidence — i.e. at least one
 * comment (a handoff/verification note). Deliberately NOT satisfied by `notes`
 * (frequently auto-populated planning text) or by a merged PR alone (green CI
 * is not a substitute for a recorded verification per the familiar PR
 * protocol): the operator must add a handoff note, which the queue's inline
 * composer writes as a comment. Gates the Close affordance on the
 * post-merge-cleanup lane.
 */
export function hasVerificationEvidence(issue: ReadyIssue | undefined | null): boolean {
  return (issue?.comment_count ?? 0) > 0;
}

/** A recently-merged PR, reduced to what the cleanup lane needs. */
export type MergedPrRef = {
  number: number;
  title: string;
  url: string;
  issueIds: string[];
  mergedAt: string | null;
  /** Head branch, when the bridge captured it — lets the chat stage header
   *  resolve a session branch's merged PR without an issue link. */
  headRefName?: string | null;
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
  issue?: ReadyIssue;
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
 * gaps the CLI patrol flags: no linked issue (invisible to the queue) and/or no
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
  /** Open PRs mentioning no issue — invisible to the queue join. */
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

// Render/scan order: fix first, then land, then review, then the issue-driven
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

// Lane mapping now lives in stage-model.ts (cave-fpqx.10) so the queue and
// the chat stage header resolve lanes identically; this alias keeps existing
// call sites untouched.
const prLaneToQueueLane = resolveQueueLane;

function labelValue(labels: string[] | null | undefined, prefix: string): string | null {
  for (const label of labels ?? []) {
    if (label.startsWith(prefix)) return label.slice(prefix.length);
  }
  return null;
}

function familiarOf(issue: ReadyIssue | undefined): string {
  if (!issue) return "unassigned";
  return labelValue(issue.labels, "familiar:") ?? (issue.assignee?.toLowerCase() || "unassigned");
}

function surfaceOf(issue: ReadyIssue | undefined): string | null {
  return labelValue(issue?.labels, "surface:");
}

export function buildWorkQueue(
  readyIssues: ReadyIssue[],
  openPrs: PullRequestSummary[],
  mergedPrs: MergedPrRef[],
  opts: { nowMs: number; staleAfterHours?: number },
): WorkQueue {
  const staleAfterHours = opts.staleAfterHours ?? 24;
  const issueById = new Map<string, ReadyIssue>();
  for (const issue of readyIssues) issueById.set(issue.id.toLowerCase(), issue);

  const items: WorkQueueItem[] = [];
  let staleCount = 0;
  const unlinked: number[] = [];
  const attention: AttentionItem[] = [];
  const issueIdsWithOpenPr = new Set<string>();

  // 1. Open PRs → their lane, joined to a ready issue when one is referenced.
  for (const pr of openPrs) {
    let issue = pr.issueIds.map((id) => issueById.get(id)).find(Boolean);
    // A PR mentioning no issue may still be claimed by one: an issue filed FROM
    // the PR carries the PR URL in its description
    // (cave-p63a). That ref-join links the PR — familiar/surface/issue chip and
    // all — instead of leaving it flagged unlinked.
    if (pr.issueIds.length === 0 && !issue) {
      issue = readyIssues.find((b) => issueMatchesPr(b, pr));
    }
    const isUnlinked = pr.issueIds.length === 0 && !issue;
    if (isUnlinked) unlinked.push(pr.number);
    for (const id of pr.issueIds) issueIdsWithOpenPr.add(id);
    if (issue) issueIdsWithOpenPr.add(issue.id.toLowerCase());
    const stale = isStalePr(pr, opts.nowMs, staleAfterHours);
    if (stale) staleCount += 1;
    if (isUnlinked || stale) attention.push({ pr, unlinked: isUnlinked, stale });
    items.push({
      key: `pr:${pr.number}`,
      lane: prLaneToQueueLane(pr.lane),
      familiar: familiarOf(issue),
      surface: surfaceOf(issue),
      pr,
      issue,
      stale,
    });
  }

  // 2. Recently-merged PRs whose issue is still open (present in the ready set)
  //    → the merge landed but the issue wasn't closed. Truthful with the data
  //    on hand; a claimed-but-unclosed issue that dropped out of `ready` won't
  //    appear here (documented limitation — worktree/branch cleanup stays CLI).
  //    Runs before the no-open-PR pass so an issue awaiting cleanup is not ALSO
  //    listed as "needs a PR".
  const issueIdsInCleanup = new Set<string>();
  for (const merged of mergedPrs) {
    const issue = merged.issueIds.map((id) => issueById.get(id)).find(Boolean);
    if (!issue) continue;
    const issueId = issue.id.toLowerCase();
    // An issue whose follow-up PR is still open is not ready to close — it
    // already appears in that PR's lane, and prompting Close while work is in
    // flight would be premature. Likewise an issue landed across several merged
    // PRs is ONE cleanup, not competing Close prompts (first ref wins — `gh`
    // lists most-recently-merged first, so the freshest PR names the close).
    if (issueIdsWithOpenPr.has(issueId) || issueIdsInCleanup.has(issueId)) continue;
    issueIdsInCleanup.add(issueId);
    items.push({
      key: `merged:${merged.number}`,
      lane: "post-merge-cleanup",
      familiar: familiarOf(issue),
      surface: surfaceOf(issue),
      merged,
      issue,
    });
  }

  // 3. Ready issues with no PR (open or awaiting cleanup) referencing them →
  //    work still waiting to ship.
  for (const issue of readyIssues) {
    const id = issue.id.toLowerCase();
    if (issueIdsWithOpenPr.has(id) || issueIdsInCleanup.has(id)) continue;
    if (issue.issue_type === "epic") continue; // epics are containers, not queue work
    items.push({
      key: `issue:${issue.id}`,
      lane: "no-open-PR",
      familiar: familiarOf(issue),
      surface: surfaceOf(issue),
      issue,
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

// Stable, deterministic ordering within a lane: PRs by number; issues by
// priority, oldest update, then id. The timestamp comes from the item data,
// not the wall clock, so identical inputs remain reproducible.
function itemSortKey(item: WorkQueueItem): string {
  if (item.pr) return `0:${String(item.pr.number).padStart(8, "0")}`;
  if (item.merged) return `0:${String(item.merged.number).padStart(8, "0")}`;
  // Issues triage priority-first, then OLDEST update first so long-waiting
  // work surfaces above fresh arrivals (cave-19jy). An undated issue can't
  // prove its age, so it sorts after dated peers of the same priority.
  if (item.issue) return `1:${item.issue.priority ?? 9}:${item.issue.updated_at || "9999"}:${item.issue.id}`;
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

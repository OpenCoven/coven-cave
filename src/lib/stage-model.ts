// Stage model (cave-fpqx.10, design docs/chat-github-integration.md §4) — the
// ONE issue ↔ PR ↔ branch stage resolution shared by the Familiar Work Queue
// and the chat stage header, so "what stage is this work at" reads identically
// everywhere. PR truth comes from the bridge's classified summaries
// (pr-management); issue truth from the ready GitHub issues. This module
// only joins and labels — it never re-derives check/review state.
import type { PullRequestSummary } from "./pr-management.ts";
import { issueRefInBranch } from "./pr-management.ts";
import type { MergedPrRef, ReadyIssue, WorkQueueLaneKey } from "./work-queue.ts";

/** PR-bridge lane → queue/stage lane. Extracted from work-queue (which
 *  re-exports its behavior through resolveQueueLane) so the queue and the
 *  header cannot drift. */
export function resolveQueueLane(prLane: PullRequestSummary["lane"]): WorkQueueLaneKey {
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

export type StageStepKey = "issue" | "pr" | "checks" | "review" | "merged";
export type StageStepState = "done" | "active" | "failed" | "pending" | "none";

export type StageStep = {
  key: StageStepKey;
  state: StageStepState;
  /** Short segment label ("cave-x1", "#3170", "checks", …). */
  label: string;
  /** One-line detail for tooltips/popovers. */
  detail: string;
  url?: string;
};

export type StageSnapshot = {
  branch: string;
  pr: PullRequestSummary | null;
  mergedRef: MergedPrRef | null;
  issue: ReadyIssue | null;
  /** Queue lane when an open PR exists; "merged" post-merge; null when only a
   *  issue anchors the stage. */
  lane: WorkQueueLaneKey | "merged" | null;
  steps: StageStep[];
};

/** The issue a branch name carries (e.g. fix/issue-12-slug → #12). Shares the
 *  branch pattern with PR parsing (pr-management.issueRefInBranch). */
export function issueIdsInBranch(branch: string): string[] {
  const ref = issueRefInBranch(branch);
  return ref ? [ref] : [];
}

/**
 * Resolve the stage of ONE branch (a chat session's checkout) against the PR
 * bridge's classified summaries and the ready-issue list. Returns null when
 * nothing anchors a stage — no PR (open or recently merged) and no issue — so
 * plain chat stays clean.
 */
export function resolveStageForBranch(args: {
  branch: string | null | undefined;
  open: PullRequestSummary[];
  merged: MergedPrRef[];
  issues: ReadyIssue[];
}): StageSnapshot | null {
  const branch = args.branch?.trim();
  if (!branch) return null;

  const pr = args.open.find((p) => p.headRefName === branch) ?? null;
  // A reused branch can carry BOTH an open PR and a recently-merged one; when
  // an open PR anchors the stage the old merged ref must not leak in, or the
  // pipeline reads "merged ✓" beside active checks/review (review finding,
  // cave-a3cl). Merged refs only matter for post-merge stages.
  const mergedByBranch = pr ? null : (args.merged.find((m) => m.headRefName === branch) ?? null);
  const issueIds = new Set<string>(
    [...(pr?.issueIds ?? []), ...issueIdsInBranch(branch), ...(mergedByBranch?.issueIds ?? [])].map((s) =>
      s.toLowerCase(),
    ),
  );
  const issue = args.issues.find((b) => issueIds.has(b.id.toLowerCase())) ?? null;
  const mergedRef =
    mergedByBranch ??
    (!pr ? (args.merged.find((m) => m.issueIds.some((id) => issueIds.has(id.toLowerCase()))) ?? null) : null);

  if (!pr && !mergedRef && !issue) return null;

  const lane: StageSnapshot["lane"] = pr ? resolveQueueLane(pr.lane) : mergedRef ? "merged" : null;

  const steps: StageStep[] = [];

  // issue
  steps.push(
    issue
      ? {
          key: "issue",
          state: issue.status === "in_progress" ? "active" : "done",
          label: issue.id,
          detail: `${issue.id} · ${issue.status}${issue.assignee ? ` · ${issue.assignee}` : ""}`,
        }
      : { key: "issue", state: "none", label: "no issue", detail: "No linked issue" },
  );

  // pr
  if (pr) {
    steps.push({
      key: "pr",
      state: "done",
      label: `#${pr.number}`,
      detail: `PR #${pr.number} open · ${pr.title}`,
      url: pr.url,
    });
  } else if (mergedRef) {
    steps.push({
      key: "pr",
      state: "done",
      label: `#${mergedRef.number}`,
      detail: `PR #${mergedRef.number} merged · ${mergedRef.title}`,
      url: mergedRef.url,
    });
  } else {
    steps.push({ key: "pr", state: "active", label: "no PR", detail: `No PR for ${branch} yet` });
  }

  // checks — only meaningful with an open PR; merged implies they passed.
  if (pr) {
    const check = pr.checkStatus;
    steps.push({
      key: "checks",
      state: check === "failing" ? "failed" : check === "passing" ? "done" : check === "pending" ? "active" : "pending",
      label: "checks",
      detail:
        check === "failing"
          ? "Checks failing"
          : check === "passing"
            ? "Checks passing"
            : check === "pending"
              ? "Checks running"
              : "No CI signal yet",
      url: pr.url,
    });
  } else {
    steps.push({
      key: "checks",
      state: mergedRef ? "done" : "pending",
      label: "checks",
      detail: mergedRef ? "Checks passed before merge" : "Checks run once a PR opens",
    });
  }

  // review
  if (pr) {
    const decision = (pr.reviewDecision || "").toUpperCase();
    steps.push({
      key: "review",
      state:
        decision === "APPROVED"
          ? "done"
          : decision === "CHANGES_REQUESTED"
            ? "failed"
            : pr.lane === "needs-review"
              ? "active"
              : "pending",
      label: "review",
      detail:
        decision === "APPROVED"
          ? "Review approved"
          : decision === "CHANGES_REQUESTED"
            ? "Changes requested"
            : pr.lane === "needs-review"
              ? "Awaiting review"
              : "Review pending",
      url: pr.url,
    });
  } else {
    steps.push({
      key: "review",
      state: mergedRef ? "done" : "pending",
      label: "review",
      detail: mergedRef ? "Reviewed before merge" : "Review starts once a PR opens",
    });
  }

  // merged
  steps.push({
    key: "merged",
    state: mergedRef ? "done" : pr && resolveQueueLane(pr.lane) === "ready-to-merge" ? "active" : "pending",
    label: "merged",
    detail: mergedRef
      ? `Merged${mergedRef.mergedAt ? ` ${mergedRef.mergedAt}` : ""}`
      : pr
        ? "Merge when checks and review are green"
        : "Merge comes last",
    url: mergedRef?.url,
  });

  return { branch, pr, mergedRef, issue, lane, steps };
}

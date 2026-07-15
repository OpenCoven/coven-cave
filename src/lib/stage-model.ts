// Stage model (cave-fpqx.10, design docs/chat-github-integration.md §4) — the
// ONE bead ↔ PR ↔ branch stage resolution shared by the Familiar Work Queue
// and the chat stage header, so "what stage is this work at" reads identically
// everywhere. PR truth comes from the bridge's classified summaries
// (beads-pr-management); bead truth from `bd ready --json` rows. This module
// only joins and labels — it never re-derives check/review state.
import type { PullRequestSummary } from "./beads-pr-management.ts";
import { beadIdsInText } from "./beads-pr-management.ts";
import type { MergedPrRef, ReadyBead, WorkQueueLaneKey } from "./beads-work-queue.ts";

/** PR-bridge lane → queue/stage lane. Extracted from beads-work-queue (which
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

export type StageStepKey = "bead" | "pr" | "checks" | "review" | "merged";
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
  bead: ReadyBead | null;
  /** Queue lane when an open PR exists; "merged" post-merge; null when only a
   *  bead anchors the stage. */
  lane: WorkQueueLaneKey | "merged" | null;
  steps: StageStep[];
};

/** Bead ids a branch name carries (e.g. feat/foo-cave-ab12). Shares the ONE
 *  bead-id pattern with PR parsing (beads-pr-management.beadIdsInText). */
export function beadIdsInBranch(branch: string): string[] {
  return beadIdsInText(branch);
}

/**
 * Resolve the stage of ONE branch (a chat session's checkout) against the PR
 * bridge's classified summaries and the ready-bead list. Returns null when
 * nothing anchors a stage — no PR (open or recently merged) and no bead — so
 * plain chat stays clean.
 */
export function resolveStageForBranch(args: {
  branch: string | null | undefined;
  open: PullRequestSummary[];
  merged: MergedPrRef[];
  beads: ReadyBead[];
}): StageSnapshot | null {
  const branch = args.branch?.trim();
  if (!branch) return null;

  const pr = args.open.find((p) => p.headRefName === branch) ?? null;
  const mergedByBranch = args.merged.find((m) => m.headRefName === branch) ?? null;
  const beadIds = new Set<string>(
    [...(pr?.beadIds ?? []), ...beadIdsInBranch(branch), ...(mergedByBranch?.beadIds ?? [])].map((s) =>
      s.toLowerCase(),
    ),
  );
  const bead = args.beads.find((b) => beadIds.has(b.id.toLowerCase())) ?? null;
  const mergedRef =
    mergedByBranch ??
    (!pr ? (args.merged.find((m) => m.beadIds.some((id) => beadIds.has(id.toLowerCase()))) ?? null) : null);

  if (!pr && !mergedRef && !bead) return null;

  const lane: StageSnapshot["lane"] = pr ? resolveQueueLane(pr.lane) : mergedRef ? "merged" : null;

  const steps: StageStep[] = [];

  // bead
  steps.push(
    bead
      ? {
          key: "bead",
          state: bead.status === "in_progress" ? "active" : "done",
          label: bead.id,
          detail: `${bead.id} · ${bead.status}${bead.assignee ? ` · ${bead.assignee}` : ""}`,
        }
      : { key: "bead", state: "none", label: "no bead", detail: "No linked bead" },
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

  return { branch, pr, mergedRef, bead, lane, steps };
}

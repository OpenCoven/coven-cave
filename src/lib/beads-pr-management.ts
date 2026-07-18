import { summarizeChecks, type CheckSummary } from "./github-checks.ts";

export type PrLane =
  | "draft"
  | "checks-failing"
  | "changes-requested"
  | "blocked"
  | "checks-pending"
  | "needs-review"
  | "ready-to-merge";

export type GitHubPullRequestInput = {
  number: number;
  title: string;
  url: string;
  isDraft?: boolean | null;
  headRefName?: string | null;
  mergeStateStatus?: string | null;
  reviewDecision?: string | null;
  statusCheckRollup?: GitHubStatusCheckInput[] | null;
  updatedAt?: string | null;
  body?: string | null;
  labels?: Array<{ name?: string | null } | string> | null;
};

export type GitHubStatusCheckInput = {
  name?: string | null;
  status?: string | null;
  conclusion?: string | null;
};

export type PullRequestSummary = {
  number: number;
  title: string;
  url: string;
  lane: PrLane;
  beadIds: string[];
  checkStatus: CheckSummary;
  reviewDecision: string;
  mergeStateStatus: string;
  headRefName: string | null;
  updatedAt: string;
};

const BEAD_ID_RE = /\bcave-[a-z0-9]+(?:\.\d+)?\b/gi;
const CLEAN_MERGE_STATES = new Set(["CLEAN", "HAS_HOOKS", "UNSTABLE"]);
const BLOCKED_MERGE_STATES = new Set(["BEHIND", "BLOCKED", "DIRTY", "UNKNOWN"]);

function normalizeCheck(check: GitHubStatusCheckInput) {
  return {
    status: check.status?.toLowerCase() ?? null,
    conclusion: check.conclusion?.toLowerCase() ?? null,
  };
}

export function pullRequestCheckStatus(pr: GitHubPullRequestInput): CheckSummary {
  return summarizeChecks((pr.statusCheckRollup ?? []).map(normalizeCheck));
}

export function classifyPullRequest(pr: GitHubPullRequestInput): PrLane {
  if (pr.isDraft) return "draft";

  const checkStatus = pullRequestCheckStatus(pr);
  if (checkStatus === "failing") return "checks-failing";

  const reviewDecision = (pr.reviewDecision ?? "").toUpperCase();
  if (reviewDecision === "CHANGES_REQUESTED") return "changes-requested";

  const mergeState = (pr.mergeStateStatus ?? "").toUpperCase();
  if (BLOCKED_MERGE_STATES.has(mergeState)) return "blocked";

  if (checkStatus === "pending") return "checks-pending";
  if (reviewDecision !== "APPROVED") return "needs-review";
  if (checkStatus === "passing" && CLEAN_MERGE_STATES.has(mergeState)) return "ready-to-merge";

  return "needs-review";
}

/** Bead ids mentioned in any text (lowercased, deduped, sorted). The ONE
 *  bead-id pattern — branch parsing (stage-model) and PR parsing share it so
 *  they cannot drift. */
export function beadIdsInText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(BEAD_ID_RE)) ids.add(match[0].toLowerCase());
  return [...ids].sort();
}

export function extractBeadIds(pr: GitHubPullRequestInput): string[] {
  const chunks = [
    pr.title,
    pr.body ?? "",
    pr.headRefName ?? "",
    ...(pr.labels ?? []).map((label) => (typeof label === "string" ? label : label.name ?? "")),
  ];
  const ids = new Set<string>();
  for (const chunk of chunks) {
    for (const id of beadIdsInText(chunk)) ids.add(id);
  }
  return [...ids].sort();
}

export function summarizePullRequest(pr: GitHubPullRequestInput): PullRequestSummary {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    lane: classifyPullRequest(pr),
    beadIds: extractBeadIds(pr),
    checkStatus: pullRequestCheckStatus(pr),
    reviewDecision: (pr.reviewDecision ?? "UNKNOWN").toUpperCase(),
    mergeStateStatus: (pr.mergeStateStatus ?? "UNKNOWN").toUpperCase(),
    headRefName: pr.headRefName ?? null,
    updatedAt: pr.updatedAt ?? new Date(0).toISOString(),
  };
}

export function prStateNote(summary: PullRequestSummary): string {
  return [
    `GitHub PR #${summary.number}: ${summary.lane}`,
    `checks=${summary.checkStatus ?? "unknown"}`,
    `review=${summary.reviewDecision}`,
    `merge=${summary.mergeStateStatus}`,
    summary.url,
    `updated=${summary.updatedAt}`,
  ].join("; ");
}

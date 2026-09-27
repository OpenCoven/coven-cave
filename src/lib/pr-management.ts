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
  issueIds: string[];
  checkStatus: CheckSummary;
  reviewDecision: string;
  mergeStateStatus: string;
  headRefName: string | null;
  updatedAt: string;
};

// "Fixes #12", "closes: #12, #13", "Refs #12 and #14" — GitHub's closing
// keywords plus the reference forms this repository's PRs use. A bare "#12"
// is not a link: PR bodies mention unrelated issues and PRs all the time.
const ISSUE_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references|part of|towards?)\b[:\s]+((?:#\d+(?:\s*(?:,|and)\s*)?)+)/gi;
const ISSUE_NUMBER_RE = /#(\d+)/g;
// `fix/issue-12-short-slug`, `issue-12`, `feat/issue_12`.
const ISSUE_BRANCH_RE = /(?:^|[/_-])issue[-_](\d+)(?=$|[/_-])/i;
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

/** Issues a PR body or title links with a closing or reference keyword, as
 *  `#<n>` (deduped, ascending). Branch parsing (stage-model) and PR parsing
 *  share these patterns so they cannot drift. */
export function issueRefsInText(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(ISSUE_KEYWORD_RE)) {
    for (const number of match[1].matchAll(ISSUE_NUMBER_RE)) ids.add(`#${Number(number[1])}`);
  }
  return [...ids].sort(compareIssueRefs);
}

/** The issue a branch is named for (`fix/issue-12-slug` → `#12`), if any. */
export function issueRefInBranch(branch: string | null | undefined): string | null {
  const match = branch ? ISSUE_BRANCH_RE.exec(branch) : null;
  return match ? `#${Number(match[1])}` : null;
}

function compareIssueRefs(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}

export function extractIssueRefs(pr: GitHubPullRequestInput): string[] {
  const ids = new Set<string>([...issueRefsInText(pr.title), ...issueRefsInText(pr.body ?? "")]);
  const branch = issueRefInBranch(pr.headRefName);
  if (branch) ids.add(branch);
  return [...ids].sort(compareIssueRefs);
}

export function summarizePullRequest(pr: GitHubPullRequestInput): PullRequestSummary {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    lane: classifyPullRequest(pr),
    issueIds: extractIssueRefs(pr),
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

/** A PR with no activity for longer than `staleAfterHours` (unknown activity reads as stale). */
export function isStalePr(
  summary: PullRequestSummary,
  nowMs: number,
  staleAfterHours: number,
): boolean {
  const updated = Date.parse(summary.updatedAt);
  if (!Number.isFinite(updated)) return true;
  return nowMs - updated > staleAfterHours * 3_600_000;
}

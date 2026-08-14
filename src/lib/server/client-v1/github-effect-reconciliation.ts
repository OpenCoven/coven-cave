import { resolveGitHubToken } from "@/lib/github-token";

import type { GitHubActionExecutionResult, GitHubActionInput } from "./action-service.ts";
import type { GitHubEffectFailureReason, GitHubEffectFailureSnapshot } from "./github-effect-store.ts";

const GH = "https://api.github.com";
const RECONCILIATION_CLOCK_SKEW_MS = 5 * 60_000;

type GitHubViewer = { login: string };
type GitHubIssueComment = {
  id: string;
  body: string;
  createdAt: string | null;
  url: string | null;
  authorLogin: string | null;
};
type GitHubPullReview = {
  id: string;
  state: string;
  body: string;
  submittedAt: string | null;
  url: string | null;
  authorLogin: string | null;
};
type GitHubMergeProbe = {
  merged: boolean;
  mergeCommitSha: string | null;
};

export type ReconcileGitHubActionEffectResult =
  | {
      kind: "success";
      result: GitHubActionExecutionResult;
    }
  | {
      kind: "manual_reconciliation";
      failure: GitHubEffectFailureSnapshot;
    };

type ReconcileOptions = {
  action: GitHubActionInput;
  pendingSince: string;
  rootReason: Extract<GitHubEffectFailureReason, "crash_window" | "network_ambiguous" | "upstream_ambiguous">;
};

function failure(
  reason: GitHubEffectFailureReason,
  status: number,
  message: string | null,
): ReconcileGitHubActionEffectResult {
  return {
    kind: "manual_reconciliation",
    failure: {
      code: "conflict",
      status,
      retryable: false,
      reason,
      message,
    },
  };
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson<T>(path: string, token: string): Promise<{ ok: true; value: T } | { ok: false; status: number; message: string | null }> {
  try {
    const response = await fetch(`${GH}${path}`, {
      headers: headers(token),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | unknown[] | null;
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.message === "string"
          ? payload.message
          : `github error (${response.status})`,
      };
    }
    return { ok: true, value: payload as T };
  } catch (error) {
    return {
      ok: false,
      status: 409,
      message: error instanceof Error ? error.message : "GitHub reconciliation failed",
    };
  }
}

async function fetchViewer(token: string): Promise<GitHubViewer | null> {
  const response = await githubJson<Record<string, unknown>>("/user", token);
  if (!response.ok) return null;
  const login = typeof response.value.login === "string" ? response.value.login.trim() : "";
  return login ? { login } : null;
}

function parseIsoMs(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function afterPendingSince(createdAt: string | null, pendingSince: string): boolean {
  const pendingMs = parseIsoMs(pendingSince);
  const createdMs = parseIsoMs(createdAt);
  if (pendingMs === null || createdMs === null) return false;
  return createdMs >= pendingMs - RECONCILIATION_CLOCK_SKEW_MS;
}

async function fetchIssueComments(
  repo: string,
  number: number,
  token: string,
): Promise<{ ok: true; comments: GitHubIssueComment[] } | { ok: false; status: number; message: string | null }> {
  const response = await githubJson<unknown[]>(`/repos/${repo}/issues/${number}/comments?per_page=100&sort=created&direction=desc`, token);
  if (!response.ok) return response;
  if (!Array.isArray(response.value)) return { ok: false, status: 409, message: "GitHub comments response was invalid." };
  const comments: GitHubIssueComment[] = [];
  for (const item of response.value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const user = record.user && typeof record.user === "object" && !Array.isArray(record.user)
      ? record.user as Record<string, unknown>
      : null;
    comments.push({
      id: String(record.id ?? ""),
      body: typeof record.body === "string" ? record.body : "",
      createdAt: typeof record.created_at === "string" ? record.created_at : null,
      url: typeof record.html_url === "string" ? record.html_url : null,
      authorLogin: typeof user?.login === "string" ? user.login : null,
    });
  }
  return { ok: true, comments };
}

async function fetchPullReviews(
  repo: string,
  number: number,
  token: string,
): Promise<{ ok: true; reviews: GitHubPullReview[] } | { ok: false; status: number; message: string | null }> {
  const response = await githubJson<unknown[]>(`/repos/${repo}/pulls/${number}/reviews?per_page=100`, token);
  if (!response.ok) return response;
  if (!Array.isArray(response.value)) return { ok: false, status: 409, message: "GitHub reviews response was invalid." };
  const reviews: GitHubPullReview[] = [];
  for (const item of response.value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const user = record.user && typeof record.user === "object" && !Array.isArray(record.user)
      ? record.user as Record<string, unknown>
      : null;
    reviews.push({
      id: String(record.id ?? ""),
      state: typeof record.state === "string" ? record.state : "",
      body: typeof record.body === "string" ? record.body : "",
      submittedAt: typeof record.submitted_at === "string" ? record.submitted_at : null,
      url: typeof record.html_url === "string" ? record.html_url : null,
      authorLogin: typeof user?.login === "string" ? user.login : null,
    });
  }
  return { ok: true, reviews };
}

async function fetchMergeProbe(
  repo: string,
  number: number,
  token: string,
): Promise<{ ok: true; probe: GitHubMergeProbe } | { ok: false; status: number; message: string | null }> {
  const response = await githubJson<Record<string, unknown>>(`/repos/${repo}/pulls/${number}`, token);
  if (!response.ok) return response;
  return {
    ok: true,
    probe: {
      merged: response.value.merged === true,
      mergeCommitSha: typeof response.value.merge_commit_sha === "string" ? response.value.merge_commit_sha : null,
    },
  };
}

function expectedReviewState(event: Extract<GitHubActionInput, { kind: "review" }>["event"]): string {
  switch (event) {
    case "APPROVE":
      return "APPROVED";
    case "REQUEST_CHANGES":
      return "CHANGES_REQUESTED";
    default:
      return "COMMENTED";
  }
}

async function reconcileComment(
  action: Extract<GitHubActionInput, { kind: "comment" }>,
  pendingSince: string,
  token: string,
): Promise<ReconcileGitHubActionEffectResult> {
  const viewer = await fetchViewer(token);
  if (!viewer) return failure("reconciliation_unavailable", 409, "GitHub viewer identity is unavailable.");
  const response = await fetchIssueComments(action.repo, action.number, token);
  if (!response.ok) return failure("reconciliation_unavailable", 409, response.message);
  const matches = response.comments.filter((comment) =>
    comment.authorLogin?.toLowerCase() === viewer.login.toLowerCase()
    && comment.body === action.body
    && afterPendingSince(comment.createdAt, pendingSince)
  );
  if (matches.length === 1) {
    const [comment] = matches;
    return {
      kind: "success",
      result: {
        kind: "comment",
        commentId: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        url: comment.url,
      },
    };
  }
  return matches.length === 0
    ? failure("comment_not_found", 409, "No matching GitHub comment could be verified.")
    : failure("comment_ambiguous", 409, "Multiple matching GitHub comments were found.");
}

async function reconcileReview(
  action: Extract<GitHubActionInput, { kind: "review" }>,
  pendingSince: string,
  token: string,
): Promise<ReconcileGitHubActionEffectResult> {
  const viewer = await fetchViewer(token);
  if (!viewer) return failure("reconciliation_unavailable", 409, "GitHub viewer identity is unavailable.");
  const response = await fetchPullReviews(action.repo, action.number, token);
  if (!response.ok) return failure("reconciliation_unavailable", 409, response.message);
  const body = action.body ?? "";
  const state = expectedReviewState(action.event);
  const matches = response.reviews.filter((review) =>
    review.authorLogin?.toLowerCase() === viewer.login.toLowerCase()
    && review.state.toUpperCase() === state
    && review.body === body
    && afterPendingSince(review.submittedAt, pendingSince)
  );
  if (matches.length === 1) {
    const [review] = matches;
    return {
      kind: "success",
      result: {
        kind: "review",
        reviewId: review.id,
        state: review.state,
        url: review.url,
      },
    };
  }
  return matches.length === 0
    ? failure("review_not_found", 409, "No matching GitHub review could be verified.")
    : failure("review_ambiguous", 409, "Multiple matching GitHub reviews were found.");
}

async function reconcileMerge(
  action: Extract<GitHubActionInput, { kind: "merge" }>,
  token: string,
): Promise<ReconcileGitHubActionEffectResult> {
  const response = await fetchMergeProbe(action.repo, action.number, token);
  if (!response.ok) return failure("reconciliation_unavailable", 409, response.message);
  if (!response.probe.merged) {
    return failure("merge_unverified", 409, "GitHub does not show this pull request as merged.");
  }
  return {
    kind: "success",
    result: {
      kind: "merge",
      merged: true,
      sha: response.probe.mergeCommitSha,
      branchDeleted: false,
      branchDeleteError: null,
    },
  };
}

export async function reconcileGitHubActionEffect(
  options: ReconcileOptions,
): Promise<ReconcileGitHubActionEffectResult> {
  const token = resolveGitHubToken();
  if (!token) {
    return failure("reconciliation_unavailable", 409, "GitHub access is not configured.");
  }
  switch (options.action.kind) {
    case "comment":
      return reconcileComment(options.action, options.pendingSince, token);
    case "review":
      return reconcileReview(options.action, options.pendingSince, token);
    case "merge":
      return reconcileMerge(options.action, token);
    case "rerun":
    case "dispatch":
      return failure(
        options.rootReason,
        409,
        "This GitHub action must be verified and recovered manually before it is retried.",
      );
  }
}

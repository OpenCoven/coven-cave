import { sanitizeGithubObjectSha } from "./research-github-repo.ts";

export type GitHubPullRevision = {
  repo: string;
  number: number;
  baseRef: string;
  baseSha: string;
  headSha: string;
};

export type GitHubDiffRevision = GitHubPullRevision & { mergeBaseSha: string };

export function parseGitHubDiffRevision(value: unknown): GitHubDiffRevision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const revision = value as Record<string, unknown>;
  const sha = (value: unknown) => typeof value === "string" ? sanitizeGithubObjectSha(value) : null;
  const baseSha = sha(revision.baseSha);
  const headSha = sha(revision.headSha);
  const mergeBaseSha = sha(revision.mergeBaseSha);
  if (typeof revision.repo !== "string" || !revision.repo ||
      typeof revision.number !== "number" || !Number.isSafeInteger(revision.number) || revision.number <= 0 ||
      typeof revision.baseRef !== "string" || !revision.baseRef ||
      !baseSha || !headSha || !mergeBaseSha) return null;
  return { repo: revision.repo, number: revision.number, baseRef: revision.baseRef, baseSha, headSha, mergeBaseSha };
}

export function sameGitHubPullRevision(
  displayed: GitHubPullRevision | null | undefined,
  current: GitHubPullRevision | null | undefined,
): boolean {
  return Boolean(displayed && current &&
    displayed.repo.toLowerCase() === current.repo.toLowerCase() &&
    displayed.number === current.number && displayed.baseRef === current.baseRef &&
    displayed.baseSha === current.baseSha && displayed.headSha === current.headSha);
}

/** Cave-owned ceiling for a pull-request review body before GitHub dispatch. */
export const GITHUB_REVIEW_BODY_MAX_LENGTH = 5_000;

export type GitHubReviewBodyValidation =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Normalize and validate the body before it can reach the GitHub API. */
export function validateGitHubReviewBody(value: unknown): GitHubReviewBodyValidation {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > GITHUB_REVIEW_BODY_MAX_LENGTH) {
    return {
      ok: false,
      error: `review body must be at most ${GITHUB_REVIEW_BODY_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, value: text };
}

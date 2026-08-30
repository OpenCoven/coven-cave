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

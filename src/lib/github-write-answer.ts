/** Shown when Cave's reply to a GitHub write can't be read. */
export const UNREADABLE_GITHUB_WRITE_ANSWER = "Cave’s answer was cut off, so this may have gone through.";

/**
 * Whether a GitHub write may have landed despite this answer (#6369). A 4xx,
 * or a readable `ok: false` without `ambiguous-write`, is a definite failure.
 * Anything else unreadable arrived after the request left, so a blind re-send
 * could post twice. Status 0 means the connection to Cave dropped.
 */
export function isUncertainGitHubWrite(status: number, data: unknown): boolean {
  if (status === 0) return true;
  const answer = (typeof data === "object" && data !== null ? data : {}) as { ok?: unknown; code?: unknown };
  if (answer.code === "ambiguous-write") return true;
  if (status >= 400 && status < 500) return false;
  return typeof answer.ok !== "boolean";
}

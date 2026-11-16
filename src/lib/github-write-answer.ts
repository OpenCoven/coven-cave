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

/** Validate Cave's envelope before its fields become error UI or write confirmation. */
export type GitHubWriteAnswer = { ok: boolean; error?: string; code?: string } & Record<string, unknown>;

export async function readGitHubWriteAnswer(response: Response): Promise<GitHubWriteAnswer | null> {
  const value: unknown = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.ok !== "boolean") return null;
  if (data.error !== undefined && typeof data.error !== "string") return null;
  if (data.code !== undefined && typeof data.code !== "string") return null;
  return data as GitHubWriteAnswer;
}

import {
  sameGitHubPullRevision,
  type GitHubDiffRevision,
  type GitHubPullRevision,
} from "../github-review";
import { sanitizeGithubObjectSha } from "../github-object-sha";
import { upstreamFailureAnswer } from "./upstream-answer";
import { upstreamFetch } from "./upstream-fetch";

export class GitHubRevisionError extends Error {
  readonly status: number;
  /** A revoked token or rate limit stays named through the route's catch (#6371). */
  readonly fields: Record<string, unknown>;
  readonly headers: Record<string, string>;
  constructor(message: string, status: number, fields: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.headers = headers;
  }
}

export async function readGitHubPullRevision(
  repo: string, number: number, token: string | null,
): Promise<GitHubPullRevision> {
  const response = await upstreamFetch("github", `https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const { body, headers } = upstreamFailureAnswer(
      response,
      "GitHub",
      response.status === 404 ? "not_found" : `github error (${response.status})`,
    );
    const { ok: _ok, error, ...fields } = body;
    throw new GitHubRevisionError(error, response.status === 404 || response.status === 403 ? response.status : 502, fields, headers);
  }
  // A body that fails or stalls after its headers falls through to the same
  // "unavailable" answer as one that arrives with no revision.
  const data = await response.json().catch(() => null) as {
    head?: { sha?: unknown }; base?: { sha?: unknown; ref?: unknown };
  } | null;
  const headSha = sanitizeGithubObjectSha(typeof data?.head?.sha === "string" ? data.head.sha : null);
  const baseSha = sanitizeGithubObjectSha(typeof data?.base?.sha === "string" ? data.base.sha : null);
  const baseRef = data?.base?.ref;
  if (!headSha || !baseSha || typeof baseRef !== "string" || !baseRef) {
    throw new GitHubRevisionError("Pull request revision is unavailable.", 502);
  }
  return { repo, number, headSha, baseSha, baseRef };
}

/** Keep the fresh-head check in addition to GitHub's commit_id / atomic merge SHA. */
export async function assertCurrentGitHubRevision(
  repo: string, number: number, token: string,
  headSha: string | null, reviewedRevision: GitHubDiffRevision | null,
): Promise<void> {
  if (!headSha) return; // Other existing callers do not submit revision-bound verdicts.
  const current = await readGitHubPullRevision(repo, number, token);
  if (current.headSha !== headSha ||
      (reviewedRevision && !sameGitHubPullRevision(reviewedRevision, current))) {
    throw new GitHubRevisionError("Pull request revision changed. Refresh and review the current diff before submitting.", 409);
  }
}

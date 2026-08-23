/**
 * github-repo-link.ts
 *
 * Client-safe helpers for tying a Cave project to a GitHub repository.
 * A project's `repoUrl` is always stored in the one canonical form
 * `https://github.com/{owner}/{repo}` — every accepted spelling (bare
 * `owner/repo` slug, `github.com/…`, `www.`, http, a trailing `.git`, or the
 * `git@github.com:owner/repo.git` SSH remote) normalizes to it, and anything
 * else (other hosts, malformed owners, opaque schemes) is rejected with null
 * so an unvetted string can never be persisted or rendered as a link.
 */

// GitHub owner: 1-39 alphanumerics/hyphens, no leading/trailing hyphen.
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
// GitHub repo: word chars, dots and hyphens (".", ".." excluded below).
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

function ownerRepoFrom(rest: string, opts: { allowExtraPath: boolean }): { owner: string; repo: string } | null {
  const segments = rest.split(/[/?#]/).filter(Boolean);
  if (segments.length < 2) return null;
  // A bare slug is exactly owner/repo; URL/SSH forms may carry a deeper path
  // (a PR or file link) which still identifies the repository, so it's dropped.
  if (segments.length > 2 && !opts.allowExtraPath) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, "");
  if (repo === "." || repo === "..") return null;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
  return { owner, repo };
}

function parseOwnerRepo(input: string): { owner: string; repo: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const ssh = /^git@github\.com:(.+)$/i.exec(trimmed);
  if (ssh) return ownerRepoFrom(ssh[1], { allowExtraPath: true });

  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(trimmed)) {
    // URL forms must be http(s) at github.com — every other scheme/host is out.
    if (!/^https?:\/\//i.test(trimmed)) return null;
    const host = trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    if (!/^github\.com\//i.test(host)) return null;
    return ownerRepoFrom(host.slice("github.com/".length), { allowExtraPath: true });
  }

  if (/^(?:www\.)?github\.com\//i.test(trimmed)) {
    const host = trimmed.replace(/^www\./i, "");
    return ownerRepoFrom(host.slice("github.com/".length), { allowExtraPath: true });
  }

  // Bare "owner/repo" slug.
  if (trimmed.includes("/")) return ownerRepoFrom(trimmed, { allowExtraPath: false });
  return null;
}

/**
 * Normalize any accepted GitHub repository spelling to the canonical
 * `https://github.com/{owner}/{repo}` link, or null when the input is not a
 * valid GitHub repository reference.
 */
export function normalizeGitHubRepoUrl(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const parsed = parseOwnerRepo(input);
  return parsed ? `https://github.com/${parsed.owner}/${parsed.repo}` : null;
}

/** `owner/repo` display slug for a stored (canonical) repo link. */
export function gitHubRepoSlug(repoUrl: string | null | undefined): string | null {
  if (typeof repoUrl !== "string") return null;
  const parsed = parseOwnerRepo(repoUrl);
  return parsed ? `${parsed.owner}/${parsed.repo}` : null;
}

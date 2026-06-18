/**
 * issue-worktree — deterministic naming + planning for per-issue git worktrees.
 *
 * When more than one GitHub issue/PR is worked at once on the same repository,
 * running every agent session in the shared checkout invites collisions: two
 * sessions stage each other's files, rebase over each other, and squash the
 * wrong tree. The fix is the same one humans use here (see CLAUDE.md): give
 * each issue its own `git worktree` on its own branch.
 *
 * This module is the PURE half — slug/branch/path derivation and the
 * "should we isolate?" decision. The actual `git worktree add` lives in the
 * server route (`/api/github/worktree`) and in the board-chat session flow,
 * which call into here for the names. Keeping naming pure makes it unit-testable
 * and guarantees the UI, the route, and the session flow agree on where a given
 * issue's worktree lives.
 */

export type IssueWorktreeKind = "pr" | "issue" | "review_request" | "notification";

export type IssueWorktreeRef = {
  kind: IssueWorktreeKind;
  /** GitHub issue/PR number; falsy for unnumbered items (notifications). */
  number?: number | null;
  /** Issue/PR title — used only to make the slug human-readable. */
  title?: string | null;
};

/** PRs and review requests both live on a pull request → `pr` prefix. */
function prefixFor(kind: IssueWorktreeKind): string {
  return kind === "pr" || kind === "review_request" ? "pr" : "issue";
}

/**
 * Lowercase, hyphenate, and clamp a title into a filesystem- and branch-safe
 * slug. The output is restricted to `[a-z0-9-]`, which is what makes the
 * derived directory and branch names safe to interpolate into a `git worktree`
 * argv without traversal risk.
 */
export function slugifyIssueTitle(title: string | null | undefined, maxLen = 32): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug;
}

/** Stable base name for an issue's worktree, e.g. `issue-267-attach-cfd-tokens`. */
export function issueWorktreeSlug(item: IssueWorktreeRef): string {
  const prefix = prefixFor(item.kind);
  const num = Number.isFinite(item.number) && item.number ? Math.trunc(item.number) : null;
  const slug = slugifyIssueTitle(item.title);
  const head = num != null ? `${prefix}-${num}` : prefix;
  return slug ? `${head}-${slug}` : head;
}

/**
 * Repo-relative worktree directory for an issue. Always under `.worktrees/`,
 * matching the convention the rest of the repo uses. Returns a POSIX-style
 * relative path; callers resolve it against the repo root.
 */
export function issueWorktreeDir(item: IssueWorktreeRef): string {
  return `.worktrees/${issueWorktreeSlug(item)}`;
}

/** Branch name for an issue's worktree, e.g. `cave/issue-267-attach-cfd-tokens`. */
export function issueWorktreeBranch(item: IssueWorktreeRef): string {
  return `cave/${issueWorktreeSlug(item)}`;
}

/**
 * Decide whether a new session for `item` should run in an isolated worktree
 * rather than the shared checkout.
 *
 * The rule is "isolate only when it earns its keep": a single issue in flight
 * can safely use the main checkout, but the moment a *second, different* issue
 * is already running in the same repo root, every further issue gets its own
 * worktree so the concurrent sessions can't trample each other.
 *
 * @param activeIssueKeys keys (e.g. "repo#number") of issues that already have
 *   a live session anchored at the same repo root.
 * @param thisKey the key of the issue we're about to start.
 */
export function shouldIsolateInWorktree(
  activeIssueKeys: readonly string[],
  thisKey: string,
): boolean {
  // Other distinct issues already running here → isolate to avoid conflicts.
  return activeIssueKeys.some((k) => k && k !== thisKey);
}

/** Canonical "repo#number" key for contention bookkeeping. */
export function issueContentionKey(repo: string, number?: number | null): string {
  const n = Number.isFinite(number) && number ? Math.trunc(number as number) : 0;
  return `${repo.trim().toLowerCase()}#${n}`;
}

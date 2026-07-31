// Pure model for the new-session launcher's Reviews group (Chat.dc.html 2b).
//
// The fourth place work already lives in the Cave: pull requests waiting on
// you. A review is a good way to START a session — you arrive with the diff
// already chosen — so the launcher offers them beside board cards, threads and
// parked follow-ups.
//
// Only review REQUESTS qualify. /api/github/assigned also returns your own
// open PRs and your assigned issues; neither is "waiting on you to review",
// and offering them here would quietly redefine the group.

import type { GitHubItem } from "./github-tasks.ts";

export type ReviewRequest = {
  id: string;
  /** "terminal-ui #54 — sync README with components" */
  title: string;
  repo: string;
  number?: number;
  url: string;
  /** Short state token for the row's badge: "draft" or "open". */
  badge: string;
  /** What the PR needs from you — "needs review", or "blocked" while draft. */
  need: string;
  updatedAt: string;
};

/** A draft PR can't be reviewed yet, so it reads as blocked rather than as
 *  work you're holding up. Everything else is waiting on your review. */
function describe(item: GitHubItem): { badge: string; need: string } {
  if (item.draft) return { badge: "draft", need: "blocked" };
  return { badge: item.state?.trim() || "open", need: "needs review" };
}

/** Repo tail only — "OpenCoven/coven-cave" reads as "coven-cave" in a row
 *  that already sits inside the Cave. */
export function repoLabel(repo: string): string {
  const trimmed = repo.trim();
  if (!trimmed) return "";
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) || trimmed : trimmed;
}

/** Reviews waiting on you, freshest first. */
export function reviewRequests(
  items: readonly GitHubItem[],
  opts: { cap?: number } = {},
): ReviewRequest[] {
  const rows = items
    .filter((item) => item.kind === "review_request")
    .filter((item) => (item.state ?? "open").toLowerCase() !== "closed")
    .map((item) => {
      const { badge, need } = describe(item);
      const repo = repoLabel(item.repo);
      const number = item.number;
      const lead = number != null ? `${repo || "PR"} #${number}` : repo;
      return {
        id: item.id,
        title: lead ? `${lead} — ${item.title}` : item.title,
        repo,
        number,
        url: item.url,
        badge,
        need,
        updatedAt: item.updatedAt,
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const cap = opts.cap;
  return cap != null && cap >= 0 ? rows.slice(0, cap) : rows;
}

/** Accessible name — the repo, the state and what it needs are the meaning of
 *  the row, not decoration. */
export function reviewRequestLabel(row: ReviewRequest): string {
  return `Review '${row.title}' — ${row.need}`;
}

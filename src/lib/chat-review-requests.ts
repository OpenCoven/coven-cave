// Pure model for the new-session launcher's Reviews group (Chat.dc.html 2b).
//
// The fourth place work already lives in the Cave: pull requests waiting on
// you. A review is a good way to START a session — you arrive with the diff
// already chosen — so the launcher offers them beside board cards, threads and
// parked follow-ups.
//
// Two kinds of row qualify. Review REQUESTS always do. Since #5930 your own
// open pull requests do too, while "Include my pull requests in Reviews" is on
// (`includeOwn`, default on): Val asked to review her own PRs from here. They
// are marked as yours and sort after the requests, so a review someone is
// waiting on is never buried under your own work. Assigned issues, and PRs
// someone else wrote that merely list you as assignee, still never qualify:
// neither is waiting on your review.

import type { GitHubItem } from "./github-tasks.ts";

export type ReviewRequest = {
  id: string;
  /** "terminal-ui #54 — sync README with components" */
  title: string;
  repo: string;
  number?: number;
  url: string;
  /** Short state token for the row's badge: "draft", "open", or "yours". */
  badge: string;
  /** What the PR needs: "needs review", "self-review", "blocked", or
   *  "reviews when ready" for your draft while automatic review is on. */
  need: string;
  /** You wrote this pull request (#5930). */
  own: boolean;
  draft: boolean;
  updatedAt: string;
};

export type ReviewRequestOptions = {
  cap?: number;
  /** Also offer your own open pull requests (#5930). */
  includeOwn?: boolean;
  /** Automatic review of your PRs is on: your draft reads "reviews when
   *  ready" instead of "blocked". Not passed by the launcher until the
   *  automatic-review watcher ships (#5930 part 2). */
  autoReview?: boolean;
};

/** A draft PR can't be reviewed yet, so it reads as blocked rather than as
 *  work you're holding up. Everything else is waiting on your review. Your own
 *  PR is always badged "yours"; its draft reads "reviews when ready" while
 *  automatic review is on, because the familiar picks it up then. */
function describe(item: GitHubItem, own: boolean, autoReview: boolean): { badge: string; need: string } {
  if (own) {
    if (item.draft) return { badge: "yours", need: autoReview ? "reviews when ready" : "blocked" };
    return { badge: "yours", need: "self-review" };
  }
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

function isOpen(item: GitHubItem): boolean {
  const state = (item.state ?? "open").toLowerCase();
  return state !== "closed" && state !== "merged";
}

/** Your own open PR — only the `authored` flag from /api/github/assigned
 *  says so; an assigned PR someone else wrote does not qualify. */
function isOwnPr(item: GitHubItem): boolean {
  return item.kind === "pr" && item.authored === true;
}

/** Reviews waiting on you, freshest first, then your own PRs when
 *  `includeOwn` is on, freshest first. */
export function reviewRequests(
  items: readonly GitHubItem[],
  opts: ReviewRequestOptions = {},
): ReviewRequest[] {
  const includeOwn = opts.includeOwn === true;
  const autoReview = opts.autoReview === true;
  const toRow = (item: GitHubItem, own: boolean): ReviewRequest => {
    const { badge, need } = describe(item, own, autoReview);
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
      own,
      draft: item.draft === true,
      updatedAt: item.updatedAt,
    };
  };
  const freshestFirst = (a: ReviewRequest, b: ReviewRequest) => b.updatedAt.localeCompare(a.updatedAt);
  const open = items.filter(isOpen);
  const requested = open
    .filter((item) => item.kind === "review_request")
    .map((item) => toRow(item, false))
    .sort(freshestFirst);
  const own = includeOwn
    ? open
        .filter(isOwnPr)
        .map((item) => toRow(item, true))
        .sort(freshestFirst)
    : [];
  const rows = [...requested, ...own];
  const cap = opts.cap;
  return cap != null && cap >= 0 ? rows.slice(0, cap) : rows;
}

/** The row's quiet second line: what it needs, led by "draft" for your own
 *  draft (its badge already says "yours"). */
export function reviewRequestSub(row: ReviewRequest): string[] {
  return row.own && row.draft ? ["draft", row.need] : [row.need];
}

/** Accessible name — the repo, the state and what it needs are the meaning of
 *  the row, not decoration. */
export function reviewRequestLabel(row: ReviewRequest): string {
  if (row.own) {
    const need = reviewRequestSub(row).join(", ");
    return `Review your pull request '${row.title}' — ${need}`;
  }
  return `Review '${row.title}' — ${row.need}`;
}

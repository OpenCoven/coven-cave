// Convo-thread PR status signal: one pure mapping from a session's attached
// pull-request context (SessionRow.pullRequest) to the GitHub-style icon the
// chat list renders in place of the plain status dot. Mirrors GitHub's own
// vocabulary — open / draft / merged / closed — so the thread list reads like
// a PR list where a chat's work has reached GitHub. Pure so it pins/tests
// without a DOM.

import type { SessionPullRequestContext } from "@/lib/types";
import type { IconName } from "@/lib/icon";

export type SessionPrStatusKey = "open" | "draft" | "merged" | "closed" | "unknown";

export type SessionPrStatus = {
  key: SessionPrStatusKey;
  icon: IconName;
  /** e.g. "PR #42 · merged" — the badge's title/aria text. States outside
   *  GitHub's own vocabulary claim only the link ("PR #42"), never a state. */
  label: string;
  /** Always resolvable: falls back to the canonical github.com PR URL. */
  url: string;
};

/** Lowercased PR states that mean the PR is no longer open. */
const MERGED = new Set(["merged"]);
const CLOSED = new Set(["closed"]);

function statusKey(pr: SessionPullRequestContext): SessionPrStatusKey {
  const state = (pr.state ?? "").toLowerCase();
  if (MERGED.has(state)) return "merged";
  if (CLOSED.has(state)) return "closed";
  if (pr.draft || state === "draft") return "draft";
  if (state === "open") return "open";
  // Anything else — a GitHub-task lifecycle word like "running"/"review"/
  // "done", or no state at all — still means "there's a PR here", but the
  // GitHub state is unverified: a "done" task's PR has likely merged, so
  // painting it as an open PR would be a guess. Claim the link, not the state.
  return "unknown";
}

/**
 * The PR-status badge for a session, or null when the session has no usable
 * PR context (no PR attached, or not enough to link anywhere).
 */
export function sessionPrStatus(
  pr: SessionPullRequestContext | null | undefined,
): SessionPrStatus | null {
  if (!pr) return null;
  const url =
    pr.url ??
    (pr.repo && typeof pr.number === "number"
      ? `https://github.com/${pr.repo}/pull/${pr.number}`
      : null);
  if (!url) return null;

  const key = statusKey(pr);
  const icon: IconName = key === "merged" ? "ph:git-merge" : "ph:git-pull-request";
  const number = typeof pr.number === "number" ? ` #${pr.number}` : "";
  const label = key === "unknown" ? `PR${number}` : `PR${number} · ${key}`;
  return { key, icon, label, url };
}

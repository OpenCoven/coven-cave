// Transcript-derived PR link for a conversation (cave-u9wl).
//
// Familiar chats do their implementation work in agent worktrees, so the
// chat's own cwd never sits on the PR branch and branch-based PR attribution
// (chat-work-branch.ts → branch-pr-context.ts) yields nothing for them. The
// one reliable per-chat signal is the chat itself: when a familiar lands
// work it reports the PR URL in its assistant reply. This module extracts
// that URL so the send route can snapshot it at turn-save (alongside the
// work-branch capture) — the LAST PR URL in the reply wins, matching how
// familiars summarize ("merged as PR #N" at the end of a task).
//
// Pure and dependency-light so it pins/tests without a route or DOM.

import { parseGitHubItemUrl } from "./github-item-url.ts";

const GITHUB_URL_RE = /https?:\/\/(?:www\.)?github\.com\/[^\s)\]>"'`]+/g;

/**
 * The canonical URL of the last github.com pull-request link in `text`, or
 * null when the text mentions no PR. Trailing paths/fragments/queries on the
 * matched link (`/files`, `#issuecomment-…`) are normalized away so the URL
 * is stable as a cache key.
 */
export function latestPrUrlFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  let last: string | null = null;
  for (const match of text.matchAll(GITHUB_URL_RE)) {
    const target = parseGitHubItemUrl(match[0]);
    if (target?.kind === "pr") {
      last = `https://github.com/${target.repo}/pull/${target.number}`;
    }
  }
  return last;
}
